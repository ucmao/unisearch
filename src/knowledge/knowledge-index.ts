import { createHash } from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';
import { DocumentEngine } from '../document/document-engine';

const EMBEDDING_MODEL = 'unisearch-hash-embedding-v1';
const EMBEDDING_DIMENSIONS = 256;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function chunks(text: string, maxLength = 800, overlap = 120): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n\n+/);
  const result: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if ((current ? current.length + 2 : 0) + paragraph.length <= maxLength) {
      current += `${current ? '\n\n' : ''}${paragraph}`;
      continue;
    }
    if (current) result.push(current);
    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }
    for (let start = 0; start < paragraph.length; start += maxLength - overlap) {
      result.push(paragraph.slice(start, start + maxLength));
    }
    current = '';
  }
  if (current) result.push(current);
  return result;
}

function tokens(text: string): string[] {
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const words = normalized.match(/[a-z0-9_]+|[\u3400-\u9fff]/g) || [];
  const grams: string[] = [...words];
  for (let index = 0; index < words.length - 1; index++) grams.push(`${words[index]}${words[index + 1]}`);
  return grams;
}

export function localEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const token of tokens(text)) {
    const digest = createHash('sha256').update(token).digest();
    const index = digest.readUInt16BE(0) % EMBEDDING_DIMENSIONS;
    vector[index] += digest[2] % 2 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function cosine(left: number[], right: number[]): number {
  let score = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index++) score += left[index] * right[index];
  return score;
}

export interface KnowledgeSearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  sourceUrl?: string;
  source: string;
  score: number;
}

export class KnowledgeIndex {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  indexDocument(documentId: string): number {
    const document = new DocumentEngine(this.databaseProvider).get(documentId);
    if (!document) return 0;
    const parts = chunks(document.markdown || document.title);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM document_chunks_fts WHERE document_id=?').run(documentId);
      this.db.prepare('DELETE FROM document_chunks WHERE document_id=?').run(documentId);
      const insertChunk = this.db.prepare(`
        INSERT INTO document_chunks
          (chunk_id, document_id, ordinal, title, content, content_hash, token_count, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
      `);
      const insertFts = this.db.prepare(`
        INSERT INTO document_chunks_fts (chunk_id, document_id, title, content) VALUES (?, ?, ?, ?)
      `);
      const insertEmbedding = this.db.prepare(`
        INSERT INTO document_chunk_embeddings
          (chunk_id, model, dimensions, vector_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      parts.forEach((content, ordinal) => {
        const chunkId = hash(`${documentId}:${ordinal}:${content}`);
        insertChunk.run(chunkId, documentId, ordinal, document.title, content, hash(content), tokens(content).length, now, now);
        insertFts.run(chunkId, documentId, document.title, content);
        insertEmbedding.run(chunkId, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, JSON.stringify(localEmbedding(`${document.title}\n${content}`)), now);
      });
    })();
    return parts.length;
  }

  rebuild(options?: { workflowId?: string; threadId?: string } | string): { documents: number; chunks: number } {
    const workflowId = typeof options === 'string' ? options : options?.workflowId;
    const threadId = typeof options === 'object' ? options?.threadId : undefined;
    let documentIds: string[] = [];
    if (workflowId) {
      documentIds = (this.db.prepare(`
        SELECT DISTINCT ds.document_id
        FROM document_sources ds JOIN crawl_runs r ON r.run_id=ds.run_id
        WHERE r.workflow_id=?
      `).all(workflowId) as Array<{ document_id: string }>).map((row) => row.document_id);
    } else if (threadId) {
      documentIds = (this.db.prepare(`
        SELECT DISTINCT ds.document_id
        FROM document_sources ds JOIN crawl_runs r ON r.run_id=ds.run_id
        WHERE r.thread_id=?
      `).all(threadId) as Array<{ document_id: string }>).map((row) => row.document_id);
    } else {
      documentIds = (this.db.prepare('SELECT document_id FROM documents').all() as Array<{ document_id: string }>).map((row) => row.document_id);
    }
    let chunkCount = 0;
    for (const documentId of documentIds) chunkCount += this.indexDocument(documentId);
    return { documents: documentIds.length, chunks: chunkCount };
  }

  search(query: string, limit = 8, workflowId?: string, threadId?: string): KnowledgeSearchResult[] {
    const value = query.trim();
    if (!value) return [];
    const boundedLimit = Math.max(1, Math.min(50, limit));
    let scopeSql = '';
    const scopeParams: any[] = [];
    if (workflowId) {
      scopeSql = `AND EXISTS (
        SELECT 1 FROM document_sources ds JOIN crawl_runs r ON r.run_id=ds.run_id
        WHERE ds.document_id=c.document_id AND r.workflow_id=?
      )`;
      scopeParams.push(workflowId);
    } else if (threadId) {
      scopeSql = `AND EXISTS (
        SELECT 1 FROM document_sources ds JOIN crawl_runs r ON r.run_id=ds.run_id
        WHERE ds.document_id=c.document_id AND r.thread_id=?
      )`;
      scopeParams.push(threadId);
    }
    let lexical: any[] = [];
    try {
      lexical = this.db.prepare(`
        SELECT c.chunk_id, bm25(document_chunks_fts) AS rank
        FROM document_chunks_fts
        JOIN document_chunks c ON c.chunk_id=document_chunks_fts.chunk_id
        WHERE document_chunks_fts MATCH ? ${scopeSql}
        ORDER BY rank LIMIT ?
      `).all(`"${value.replace(/"/g, '""')}"`, ...scopeParams, boundedLimit * 4) as any[];
    } catch {
      lexical = [];
    }
    const embedding = localEmbedding(value);
    const candidates = this.db.prepare(`
      SELECT c.chunk_id, e.vector_json
      FROM document_chunks c
      JOIN document_chunk_embeddings e ON e.chunk_id=c.chunk_id AND e.model=?
      WHERE 1=1 ${scopeSql}
      LIMIT 5000
    `).all(EMBEDDING_MODEL, ...scopeParams) as any[];
    const semantic = candidates
      .map((row) => ({ chunk_id: row.chunk_id, score: cosine(embedding, JSON.parse(row.vector_json)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, boundedLimit * 4);
    const scores = new Map<string, number>();
    lexical.forEach((row, index) => scores.set(row.chunk_id, (scores.get(row.chunk_id) || 0) + 0.55 / (60 + index + 1)));
    semantic.forEach((row, index) => scores.set(row.chunk_id, (scores.get(row.chunk_id) || 0) + 0.45 / (60 + index + 1)));
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, boundedLimit);
    const get = this.db.prepare(`
      SELECT c.*, d.source_url,
        COALESCE((SELECT source FROM document_sources WHERE document_id=d.document_id ORDER BY fetched_at DESC LIMIT 1), 'unknown') AS source
      FROM document_chunks c JOIN documents d ON d.document_id=c.document_id WHERE c.chunk_id=?
    `);
    return ranked.flatMap(([chunkId, score]) => {
      const row = get.get(chunkId) as any;
      return row ? [{
        chunkId,
        documentId: row.document_id,
        title: row.title,
        content: row.content,
        sourceUrl: row.source_url || undefined,
        source: row.source,
        score,
      }] : [];
    });
  }
}

export const knowledgeIndex = new KnowledgeIndex();
