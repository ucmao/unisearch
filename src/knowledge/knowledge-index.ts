import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';
import { DocumentEngine } from '../document/document-engine';
import {
  knowledgeFtsTokens,
  knowledgeProjector,
  knowledgeTokens,
  type KnowledgeProjectionMetadata,
} from './knowledge-projector';
import { retrievalService, type RetrievalService } from './retrieval-service';

function vectorBuffer(vector: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT));
  return buffer;
}

function vectorFromBuffer(value: Buffer): number[] {
  const vector = new Array<number>(Math.floor(value.byteLength / Float32Array.BYTES_PER_ELEMENT));
  for (let index = 0; index < vector.length; index++) {
    vector[index] = value.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
  }
  return vector;
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / ((Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) || 1);
}

function ftsQuery(value: string): string {
  const tokens = knowledgeTokens(value)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .slice(0, 32);
  const unique = [...new Set(tokens.length ? tokens : [value.trim()])];
  return unique.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
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
    breadcrumbs?: string[];
    retrievalText?: string;
  };
  score: number;
}

export type KnowledgeRetrievalMode = 'lexical' | 'semantic' | 'hybrid' | 'hybrid_reranked';

export interface KnowledgeSearchResponse {
  items: KnowledgeSearchResult[];
  mode: KnowledgeRetrievalMode;
  warning?: string;
}

function scope(options: KnowledgeSearchOptions): { sql: string; params: unknown[] } {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (options.workflowId) {
    filters.push(`EXISTS (
      SELECT 1 FROM document_sources ds
      JOIN crawl_runs r ON r.run_id=ds.run_id
      JOIN workflow_runs w ON w.workflow_id=r.workflow_id
      JOIN documents d ON d.document_id=ds.document_id
      JOIN document_versions dv ON dv.version_id=ds.document_version_id
      WHERE ds.document_id=c.document_id AND r.workflow_id=?
        AND (w.incremental_since IS NULL OR d.created_at > w.incremental_since OR dv.created_at > w.incremental_since)
    )`);
    params.push(options.workflowId);
  } else if (options.threadId) {
    filters.push(`EXISTS (
      SELECT 1 FROM document_sources ds JOIN crawl_runs r ON r.run_id=ds.run_id
      WHERE ds.document_id=c.document_id AND r.thread_id=?
    )`);
    params.push(options.threadId);
  }
  for (const [jsonPath, filter] of [
    ['$.platform', options.platform],
    ['$.kind', options.kind],
    ['$.subject.type', options.subjectType],
    ['$.keyword', options.keyword],
  ] as const) {
    if (!filter) continue;
    filters.push(`json_extract(c.metadata_json, '${jsonPath}')=?`);
    params.push(filter);
  }
  return { sql: filters.length ? `AND ${filters.join(' AND ')}` : '', params };
}

export class KnowledgeIndex {
  constructor(
    private readonly databaseProvider: () => Database = getDb,
    private readonly retrieval: Pick<RetrievalService, 'getProfile' | 'embed' | 'rerank'> = retrievalService,
  ) {}

  private get db(): Database { return this.databaseProvider(); }

  clearEmbeddings(): number {
    return this.db.prepare('DELETE FROM document_chunk_embeddings').run().changes;
  }

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
        insertFts.run(
          chunk.chunkId,
          chunk.documentId,
          knowledgeFtsTokens(chunk.title),
          knowledgeFtsTokens(chunk.retrievalText || chunk.content),
        );
      }
    })();
    return chunks.length;
  }

  rebuild(options: { workflowId?: string; threadId?: string } = {}): { documents: number; chunks: number } {
    let documentIds: string[];
    if (options.workflowId) {
      documentIds = (this.db.prepare(`
        SELECT DISTINCT ds.document_id
        FROM document_sources ds
        JOIN crawl_runs r ON r.run_id=ds.run_id
        JOIN workflow_runs w ON w.workflow_id=r.workflow_id
        JOIN documents d ON d.document_id=ds.document_id
        JOIN document_versions dv ON dv.version_id=ds.document_version_id
        WHERE r.workflow_id=? AND (w.incremental_since IS NULL OR d.created_at > w.incremental_since OR dv.created_at > w.incremental_since)
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

  async rebuildWithEmbeddings(options: { workflowId?: string; threadId?: string } = {}): Promise<{
    documents: number;
    chunks: number;
    embedded: number;
    warning?: string;
  }> {
    const rebuilt = this.rebuild(options);
    const embedded = await this.embedMissing(options);
    return { ...rebuilt, ...embedded };
  }

  async embedMissing(options: KnowledgeSearchOptions = {}): Promise<{ embedded: number; warning?: string }> {
    const profile = this.retrieval.getProfile(false);
    if (!profile.apiKeyConfigured) {
      return { embedded: 0, warning: '未配置知识检索 API Key，已建立本地关键词索引' };
    }
    const scoped = scope(options);
    let embedded = 0;
    try {
      while (true) {
        const rows = this.db.prepare(`
          SELECT c.chunk_id, c.title, c.content, c.metadata_json
          FROM document_chunks c
          LEFT JOIN document_chunk_embeddings e
            ON e.chunk_id=c.chunk_id AND e.provider=? AND e.model=?
          WHERE e.chunk_id IS NULL ${scoped.sql}
          ORDER BY c.document_id, c.ordinal
          LIMIT 32
        `).all(profile.provider, profile.embeddingModel, ...scoped.params) as Array<{
          chunk_id: string;
          title: string;
          content: string;
          metadata_json: string;
        }>;
        if (!rows.length) break;
        const texts = rows.map((row) => {
          try {
            const meta = JSON.parse(row.metadata_json);
            if (meta?.retrievalText) return meta.retrievalText;
          } catch {}
          return `${row.title}\n${row.content}`;
        });
        const vectors = await this.retrieval.embed(texts);
        const now = new Date().toISOString();
        this.db.transaction(() => {
          const save = this.db.prepare(`
            INSERT INTO document_chunk_embeddings
              (chunk_id, provider, model, dimensions, vector_blob, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(chunk_id) DO UPDATE SET
              provider=excluded.provider,
              model=excluded.model,
              dimensions=excluded.dimensions,
              vector_blob=excluded.vector_blob,
              created_at=excluded.created_at
          `);
          rows.forEach((row, index) => {
            save.run(row.chunk_id, profile.provider, profile.embeddingModel, vectors[index].length, vectorBuffer(vectors[index]), now);
          });
        })();
        embedded += rows.length;
      }
      return { embedded };
    } catch (error: any) {
      return { embedded, warning: `语义索引生成失败，已降级为关键词检索：${error.message}` };
    }
  }

  private lexicalRanks(value: string, options: KnowledgeSearchOptions, limit: number): Array<{ chunkId: string; score: number }> {
    const scoped = scope(options);
    try {
      const rows = this.db.prepare(`
        SELECT c.chunk_id, bm25(document_chunks_fts) AS rank
        FROM document_chunks_fts
        JOIN document_chunks c ON c.chunk_id=document_chunks_fts.chunk_id
        WHERE document_chunks_fts MATCH ? ${scoped.sql}
        ORDER BY rank LIMIT ?
      `).all(ftsQuery(value), ...scoped.params, limit) as Array<{ chunk_id: string; rank: number }>;
      return rows.map((row) => ({ chunkId: row.chunk_id, score: row.rank }));
    } catch {
      return [];
    }
  }

  private result(chunkId: string, score: number): KnowledgeSearchResult | null {
    const row = this.db.prepare('SELECT * FROM document_chunks WHERE chunk_id=?').get(chunkId) as any;
    if (!row) return null;
    const metadata = JSON.parse(row.metadata_json) as KnowledgeSearchResult['metadata'];
    return {
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
    };
  }

  getAdjacentChunks(chunkId: string, window = 1): KnowledgeSearchResult[] {
    const current = this.db.prepare('SELECT document_id, ordinal FROM document_chunks WHERE chunk_id=?').get(chunkId) as any;
    if (!current) return [];
    const rows = this.db.prepare(`
      SELECT chunk_id FROM document_chunks
      WHERE document_id=? AND ordinal BETWEEN ? AND ?
      ORDER BY ordinal
    `).all(current.document_id, Math.max(0, current.ordinal - window), current.ordinal + window) as Array<{ chunk_id: string }>;
    return rows.map((r) => this.result(r.chunk_id, 1)).filter(Boolean) as KnowledgeSearchResult[];
  }

  async searchDetailed(query: string, options: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchResponse> {
    const value = query.trim();
    if (!value) return { items: [], mode: 'lexical' };
    const boundedLimit = Math.max(1, Math.min(50, options.limit || 8));
    const candidateLimit = Math.min(100, Math.max(20, boundedLimit * 4));
    const lexical = this.lexicalRanks(value, options, candidateLimit);
    const profile = this.retrieval.getProfile(false);
    if (!profile.apiKeyConfigured) {
      return {
        items: lexical.slice(0, boundedLimit).map((item, index) => this.result(item.chunkId, 1 / (index + 1))).filter(Boolean) as KnowledgeSearchResult[],
        mode: 'lexical',
        warning: '未配置知识检索 API Key，当前使用本地分词检索兜底。',
      };
    }

    const indexState = await this.embedMissing(options);
    if (indexState.warning) {
      return {
        items: lexical.slice(0, boundedLimit).map((item, index) => this.result(item.chunkId, 1 / (index + 1))).filter(Boolean) as KnowledgeSearchResult[],
        mode: 'lexical',
        warning: indexState.warning,
      };
    }

    try {
      const queryVector = (await this.retrieval.embed([value]))[0];
      const scoped = scope(options);

      const lexicalChunkIds = lexical.map((item) => item.chunkId);
      let lexicalFilter = '';
      const queryParams: unknown[] = [profile.provider, profile.embeddingModel, ...scoped.params];
      if (lexicalChunkIds.length > 0) {
        const placeholders = lexicalChunkIds.map(() => '?').join(',');
        lexicalFilter = `OR c.chunk_id IN (${placeholders})`;
        queryParams.push(...lexicalChunkIds);
      }

      const candidates = this.db.prepare(`
        SELECT c.chunk_id, e.vector_blob
        FROM document_chunks c
        JOIN document_chunk_embeddings e
          ON e.chunk_id=c.chunk_id AND e.provider=? AND e.model=?
        WHERE (1=1 ${scoped.sql}) ${lexicalFilter}
        ORDER BY c.created_at DESC, c.document_id, c.ordinal
        LIMIT 5000
      `).all(...queryParams) as Array<{ chunk_id: string; vector_blob: Buffer }>;

      const semantic = candidates
        .map((row) => ({ chunkId: row.chunk_id, score: cosine(queryVector, vectorFromBuffer(row.vector_blob)) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, candidateLimit);
      const scores = new Map<string, number>();
      lexical.forEach((row, index) => scores.set(row.chunkId, (scores.get(row.chunkId) || 0) + 0.55 / (60 + index + 1)));
      semantic.forEach((row, index) => scores.set(row.chunkId, (scores.get(row.chunkId) || 0) + 0.45 / (60 + index + 1)));
      const fused = [...scores.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, candidateLimit)
        .map(([chunkId, score]) => this.result(chunkId, score))
        .filter(Boolean) as KnowledgeSearchResult[];
      const mode: KnowledgeRetrievalMode = lexical.length ? 'hybrid' : 'semantic';
      if (!profile.rerankerModel.trim() || fused.length < 2) {
        return { items: fused.slice(0, boundedLimit), mode };
      }
      try {
        const ranked = await this.retrieval.rerank(
          value,
          fused.map((item) => {
            const retrievalText = item.metadata?.retrievalText;
            return retrievalText || `${item.title}\n${item.content}`;
          }),
          boundedLimit,
        );
        return {
          items: ranked.map((rank) => ({ ...fused[rank.index], score: rank.score })),
          mode: 'hybrid_reranked',
        };
      } catch (error: any) {
        return {
          items: fused.slice(0, boundedLimit),
          mode,
          warning: `重排服务不可用，已保留混合检索排序：${error.message}`,
        };
      }
    } catch (error: any) {
      return {
        items: lexical.slice(0, boundedLimit).map((item, index) => this.result(item.chunkId, 1 / (index + 1))).filter(Boolean) as KnowledgeSearchResult[],
        mode: 'lexical',
        warning: `语义检索不可用，已降级为关键词检索：${error.message}`,
      };
    }
  }

  async search(query: string, options: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchResult[]> {
    return (await this.searchDetailed(query, options)).items;
  }
}

export const knowledgeIndex = new KnowledgeIndex();
