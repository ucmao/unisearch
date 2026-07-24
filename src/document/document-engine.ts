import { createHash } from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';
import {
  DOCUMENT_SCHEMA_VERSION,
  artifactSchema,
  documentSchema,
  type Artifact,
  type Asset,
  type Document,
} from '../core/documents/types';
import type { RawItem } from '../core/contracts/raw-item';
import { DEFAULT_INGESTION_PROCESSORS, documentProcessorRegistry } from './processor-registry';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function inferAssetKind(url: string): Asset['kind'] {
  const value = url.toLowerCase().split('?')[0];
  if (/\.(?:png|jpe?g|gif|webp|avif|bmp)$/.test(value)) return 'image';
  if (/\.(?:mp4|mov|m4v|webm|mkv|avi)$/.test(value)) return 'video';
  if (/\.(?:mp3|wav|m4a|aac|flac|ogg)$/.test(value)) return 'audio';
  return 'unknown';
}

function rawItemToDocument(item: RawItem, runId?: string): Document {
  const now = new Date().toISOString();
  const canonicalKey = item.sourceUrl || (
    item.sourceItemId
      ? `${item.source}:${item.kind}:${item.sourceItemId}`
      : `${item.source}:raw:${item.id}`
  );
  const documentId = hash(canonicalKey);
  const markdown = item.hints.text || item.hints.title || '';
  const assets = (item.hints.mediaUrls || []).map((url) => ({
    assetId: hash(`${documentId}:${url}`),
    documentId,
    kind: inferAssetKind(url),
    url,
    metadata: {},
  }));

  return documentSchema.parse({
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    documentId,
    canonicalKey,
    kind: item.kind,
    title: item.hints.title || '',
    markdown,
    author: item.hints.author || '',
    publishedAt: item.hints.publishedAt,
    sourceUrl: item.sourceUrl,
    language: 'und',
    contentHash: hash(markdown),
    metadata: {
      source: item.source,
      sourceItemId: item.sourceItemId,
      parentId: item.parentId,
    },
    provenance: {
      source: item.source,
      sourceItemId: item.sourceItemId,
      sourceUrl: item.sourceUrl,
      rawItemId: item.id,
      runId,
      fetchedAt: item.fetchedAt,
    },
    assets,
    createdAt: now,
    updatedAt: now,
  });
}

export class DocumentEngine {
  constructor(private readonly databaseProvider: () => Database = getDb) {}

  private get db(): Database {
    return this.databaseProvider();
  }

  async ingest(item: RawItem, runId?: string, processorIds = DEFAULT_INGESTION_PROCESSORS): Promise<Document> {
    const initial = rawItemToDocument(item, runId);
    const processed = await documentProcessorRegistry.runPipeline(processorIds, initial, {
      runId,
      now: () => new Date(),
    });
    this.persist(processed.document, item, processed.artifacts || []);
    return processed.document;
  }

  get(documentId: string): Document | null {
    const row = this.db.prepare('SELECT * FROM documents WHERE document_id=?').get(documentId) as any;
    if (!row) return null;
    const source = this.db.prepare(`
      SELECT * FROM document_sources WHERE document_id=? ORDER BY fetched_at DESC LIMIT 1
    `).get(documentId) as any;
    const assets = this.db.prepare('SELECT * FROM document_assets WHERE document_id=? ORDER BY created_at').all(documentId) as any[];
    return documentSchema.parse({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      documentId: row.document_id,
      canonicalKey: row.canonical_key,
      kind: row.kind,
      title: row.title,
      markdown: row.markdown,
      author: row.author,
      publishedAt: row.published_at || undefined,
      sourceUrl: row.source_url || undefined,
      language: row.language,
      contentHash: row.content_hash,
      metadata: JSON.parse(row.metadata_json || '{}'),
      provenance: {
        source: source?.source || 'unknown',
        sourceItemId: source?.source_item_id || undefined,
        sourceUrl: source?.source_url || undefined,
        rawItemId: source?.raw_item_id || `document:${documentId}`,
        runId: source?.run_id || undefined,
        fetchedAt: source?.fetched_at || row.updated_at,
      },
      assets: assets.map((asset) => ({
        assetId: asset.asset_id,
        documentId: asset.document_id,
        kind: asset.kind,
        url: asset.url,
        mimeType: asset.mime_type || undefined,
        localPath: asset.local_path || undefined,
        metadata: JSON.parse(asset.metadata_json || '{}'),
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  listByRun(runId: string, limit = 500): Document[] {
    const ids = this.db.prepare(`
      SELECT DISTINCT document_id FROM document_sources
      WHERE run_id=? ORDER BY fetched_at DESC LIMIT ?
    `).all(runId, Math.max(1, Math.min(limit, 5000))) as Array<{ document_id: string }>;
    return ids.flatMap(({ document_id }) => {
      const document = this.get(document_id);
      return document ? [document] : [];
    });
  }

  list(limit = 100): Document[] {
    const ids = this.db.prepare(`
      SELECT document_id FROM documents ORDER BY updated_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(limit, 1000))) as Array<{ document_id: string }>;
    return ids.flatMap(({ document_id }) => {
      const document = this.get(document_id);
      return document ? [document] : [];
    });
  }

  addArtifact(input: Artifact): Artifact {
    const artifact = artifactSchema.parse(input);
    this.db.prepare(`
      INSERT INTO document_artifacts (
        artifact_id, document_id, type, processor_id, processor_version,
        input_hash, content, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id, type, processor_id, processor_version, input_hash)
      DO UPDATE SET content=excluded.content, metadata_json=excluded.metadata_json
    `).run(
      artifact.artifactId,
      artifact.documentId,
      artifact.type,
      artifact.processorId,
      artifact.processorVersion,
      artifact.inputHash,
      artifact.content,
      JSON.stringify(artifact.metadata),
      artifact.createdAt,
    );
    return artifact;
  }

  private persist(document: Document, rawItem: RawItem, artifacts: Artifact[]): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO documents (
          document_id, canonical_key, kind, title, markdown, author, published_at,
          source_url, language, content_hash, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_key) DO UPDATE SET
          kind=excluded.kind,
          title=excluded.title,
          markdown=excluded.markdown,
          author=excluded.author,
          published_at=excluded.published_at,
          source_url=excluded.source_url,
          language=excluded.language,
          content_hash=excluded.content_hash,
          metadata_json=excluded.metadata_json,
          updated_at=excluded.updated_at
      `).run(
        document.documentId,
        document.canonicalKey,
        document.kind,
        document.title,
        document.markdown,
        document.author,
        document.publishedAt === undefined ? null : String(document.publishedAt),
        document.sourceUrl || null,
        document.language,
        document.contentHash,
        JSON.stringify(document.metadata),
        document.createdAt,
        document.updatedAt,
      );

      const sourceRecordId = hash(`${document.provenance.runId || 'none'}:${rawItem.id}`);
      this.db.prepare(`
        INSERT INTO document_sources (
          source_record_id, document_id, run_id, source, source_item_id, source_url,
          raw_item_id, raw_payload_json, fetched_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_record_id) DO UPDATE SET
          document_id=excluded.document_id,
          raw_payload_json=excluded.raw_payload_json,
          fetched_at=excluded.fetched_at
      `).run(
        sourceRecordId,
        document.documentId,
        document.provenance.runId || null,
        document.provenance.source,
        document.provenance.sourceItemId || null,
        document.provenance.sourceUrl || null,
        document.provenance.rawItemId,
        JSON.stringify(rawItem.payload),
        document.provenance.fetchedAt,
        document.createdAt,
      );

      const assetStatement = this.db.prepare(`
        INSERT INTO document_assets (
          asset_id, document_id, kind, url, mime_type, local_path,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id, url) DO UPDATE SET
          kind=excluded.kind,
          mime_type=excluded.mime_type,
          local_path=COALESCE(excluded.local_path, document_assets.local_path),
          metadata_json=excluded.metadata_json,
          updated_at=excluded.updated_at
      `);
      for (const asset of document.assets) {
        assetStatement.run(
          asset.assetId,
          document.documentId,
          asset.kind,
          asset.url,
          asset.mimeType || null,
          asset.localPath || null,
          JSON.stringify(asset.metadata),
          document.createdAt,
          document.updatedAt,
        );
      }
      for (const artifact of artifacts) this.addArtifact(artifact);

      if (rawItem.parentId) {
        const parent = this.db.prepare(`
          SELECT document_id FROM document_sources
          WHERE source=? AND source_item_id=? ORDER BY fetched_at DESC LIMIT 1
        `).get(rawItem.source, rawItem.parentId) as { document_id: string } | undefined;
        if (parent && parent.document_id !== document.documentId) {
          this.db.prepare(`
            INSERT OR IGNORE INTO document_relations (
              relation_id, from_document_id, to_document_id, relation_type, metadata_json, created_at
            ) VALUES (?, ?, ?, 'comment_of', '{}', ?)
          `).run(hash(`${document.documentId}:${parent.document_id}:comment_of`), document.documentId, parent.document_id, document.createdAt);
        }
      }
    });
    transaction();
  }
}

export const documentEngine = new DocumentEngine();
export { rawItemToDocument };
