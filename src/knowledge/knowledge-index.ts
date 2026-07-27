import { createHash } from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';
import { DocumentEngine } from '../document/document-engine';
import {
  knowledgeProjector,
  knowledgeTokens,
  type KnowledgeProjectionMetadata,
} from './knowledge-projector';

const EMBEDDING_MODEL = 'unisearch-hash-embedding-v2';
const EMBEDDING_DIMENSIONS = 256;

export function localEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const token of knowledgeTokens(text)) {
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

export interface KnowledgeSearchOptions {
  limit?: number;
  workflowId?: string;
  threadId?: string;
  platform?: string;
  kind?: string;
  subjectType?: string;
  keyword?: string;
}

export interface KnowledgeSearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  sourceUrl?: string;
  source: string;
  kind: string;
  keyword?: string;
  subject: KnowledgeProjectionMetadata['subject'];
  citations: KnowledgeProjectionMetadata['citations'];
  metadata: KnowledgeProjectionMetadata & {
    ordinal: number;
    totalChunks: number;
    characterStart: number;
    characterEnd: number;
  };
  score: number;
}

export class KnowledgeIndex {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  indexDocument(documentId: string): number {
    const document = new DocumentEngine(this.databaseProvider).get(documentId);
    if (!document) return 0;
    const chunks = knowledgeProjector.chunks(document);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM document_chunks_fts WHERE document_id=?').run(documentId);
      this.db.prepare('DELETE FROM document_chunks WHERE document_id=?').run(documentId);
      const insertChunk = this.db.prepare(`
        INSERT INTO document_chunks
          (chunk_id, document_id, ordinal, title, content, content_hash, token_count, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = this.db.prepare(`
        INSERT INTO document_chunks_fts (chunk_id, document_id, title, content) VALUES (?, ?, ?, ?)
      `);
      const insertEmbedding = this.db.prepare(`
        INSERT INTO document_chunk_embeddings
          (chunk_id, model, dimensions, vector_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const chunk of chunks) {
        insertChunk.run(
          chunk.chunkId,
          chunk.documentId,
          chunk.ordinal,
          chunk.title,
          chunk.content,
          chunk.contentHash,
          chunk.tokenCount,
          JSON.stringify(chunk.metadata),
          now,
          now,
        );
        insertFts.run(chunk.chunkId, chunk.documentId, chunk.title, chunk.content);
        insertEmbedding.run(
          chunk.chunkId,
          EMBEDDING_MODEL,
          EMBEDDING_DIMENSIONS,
          JSON.stringify(localEmbedding(`${chunk.title}\n${chunk.content}`)),
          now,
        );
      }
    })();
    return chunks.length;
  }

  rebuild(options: { workflowId?: string; threadId?: string } = {}): { documents: number; chunks: number } {
    let documentIds: string[] = [];
    if (options.workflowId) {
      documentIds = (this.db.prepare(`
        SELECT DISTINCT ds.document_id
        FROM document_sources ds JOIN crawl_runs r ON r.run_id=ds.run_id
        WHERE r.workflow_id=?
      `).all(options.workflowId) as Array<{ document_id: string }>).map((row) => row.document_id);
    } else if (options.threadId) {
      documentIds = (this.db.prepare(`
        SELECT DISTINCT ds.document_id
        FROM document_sources ds JOIN crawl_runs r ON r.run_id=ds.run_id
        WHERE r.thread_id=?
      `).all(options.threadId) as Array<{ document_id: string }>).map((row) => row.document_id);
    } else {
      documentIds = (this.db.prepare('SELECT document_id FROM documents').all() as Array<{ document_id: string }>)
        .map((row) => row.document_id);
    }
    let chunkCount = 0;
    for (const documentId of documentIds) chunkCount += this.indexDocument(documentId);
    return { documents: documentIds.length, chunks: chunkCount };
  }

  search(query: string, options: KnowledgeSearchOptions = {}): KnowledgeSearchResult[] {
    const value = query.trim();
    if (!value) return [];
    const boundedLimit = Math.max(1, Math.min(50, options.limit || 8));
    const filters: string[] = [];
    const filterParams: any[] = [];
    if (options.workflowId) {
      filters.push(`EXISTS (
        SELECT 1 FROM document_sources ds JOIN crawl_runs r ON r.run_id=ds.run_id
        WHERE ds.document_id=c.document_id AND r.workflow_id=?
      )`);
      filterParams.push(options.workflowId);
    } else if (options.threadId) {
      filters.push(`EXISTS (
        SELECT 1 FROM document_sources ds JOIN crawl_runs r ON r.run_id=ds.run_id
        WHERE ds.document_id=c.document_id AND r.thread_id=?
      )`);
      filterParams.push(options.threadId);
    }
    for (const [path, filter] of [
      ['$.platform', options.platform],
      ['$.kind', options.kind],
      ['$.subject.type', options.subjectType],
      ['$.keyword', options.keyword],
    ] as const) {
      if (!filter) continue;
      filters.push(`json_extract(c.metadata_json, '${path}')=?`);
      filterParams.push(filter);
    }
    const scopeSql = filters.length ? `AND ${filters.join(' AND ')}` : '';

    let lexical: any[] = [];
    try {
      lexical = this.db.prepare(`
        SELECT c.chunk_id, bm25(document_chunks_fts) AS rank
        FROM document_chunks_fts
        JOIN document_chunks c ON c.chunk_id=document_chunks_fts.chunk_id
        WHERE document_chunks_fts MATCH ? ${scopeSql}
        ORDER BY rank LIMIT ?
      `).all(`"${value.replace(/"/g, '""')}"`, ...filterParams, boundedLimit * 4) as any[];
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
    `).all(EMBEDDING_MODEL, ...filterParams) as any[];
    const semantic = candidates
      .map((row) => ({ chunkId: row.chunk_id, score: cosine(embedding, JSON.parse(row.vector_json)) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, boundedLimit * 4);
    const scores = new Map<string, number>();
    lexical.forEach((row, index) => scores.set(row.chunk_id, (scores.get(row.chunk_id) || 0) + 0.55 / (60 + index + 1)));
    semantic.forEach((row, index) => scores.set(row.chunkId, (scores.get(row.chunkId) || 0) + 0.45 / (60 + index + 1)));
    const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]).slice(0, boundedLimit);
    const get = this.db.prepare('SELECT * FROM document_chunks WHERE chunk_id=?');
    return ranked.flatMap(([chunkId, score]) => {
      const row = get.get(chunkId) as any;
      if (!row) return [];
      const metadata = JSON.parse(row.metadata_json) as KnowledgeSearchResult['metadata'];
      return [{
        chunkId,
        documentId: row.document_id,
        title: row.title,
        content: row.content,
        sourceUrl: metadata.sourceUrl,
        source: metadata.platform,
        kind: metadata.kind,
        keyword: metadata.keyword,
        subject: metadata.subject,
        citations: metadata.citations,
        metadata,
        score,
      }];
    });
  }
}

export const knowledgeIndex = new KnowledgeIndex();
