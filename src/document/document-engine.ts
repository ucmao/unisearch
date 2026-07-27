import { createHash } from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';
import { canonicalDocumentSchema, type CanonicalDocument } from '../core/documents/canonical';
import { artifactSchema, type Artifact } from '../core/documents/types';
import type { RawItem } from '../core/contracts/raw-item';
import { mapRawItemToCanonicalDocument } from '../connectors/mappers/canonical-document-mapper';
import { DEFAULT_INGESTION_PROCESSORS, documentProcessorRegistry } from './processor-registry';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function optional(value: unknown): string | undefined {
  return value === null || value === undefined || value === '' ? undefined : String(value);
}

export class DocumentEngine {
  constructor(private readonly databaseProvider: () => Database = getDb) {}

  private get db(): Database {
    return this.databaseProvider();
  }

  async ingest(
    item: RawItem,
    runId?: string,
    processorIds = DEFAULT_INGESTION_PROCESSORS,
  ): Promise<CanonicalDocument> {
    const canonical = mapRawItemToCanonicalDocument(item, runId);
    const processed = await documentProcessorRegistry.runPipeline(processorIds, canonical, {
      runId,
      now: () => new Date(),
    });
    this.persist(processed.document, item, processed.artifacts || []);
    return processed.document;
  }

  get(documentId: string): CanonicalDocument | null {
    const row = this.db.prepare('SELECT * FROM documents WHERE document_id=?').get(documentId) as any;
    if (!row) return null;
    const source = this.db.prepare(`
      SELECT * FROM document_sources WHERE document_id=? ORDER BY fetched_at DESC LIMIT 1
    `).get(documentId) as any;
    const assets = this.db.prepare(`
      SELECT * FROM document_assets WHERE document_id=? ORDER BY created_at, asset_id
    `).all(documentId) as any[];
    return this.rowToDocument(row, source, assets);
  }

  listByRun(runId: string, limit = 500): CanonicalDocument[] {
    const rows = this.db.prepare(`
      SELECT d.*, s.source_record_id, s.run_id AS provenance_run_id,
             s.platform AS provenance_platform,
             s.source_item_id AS provenance_source_item_id,
             s.parent_source_item_id AS provenance_parent_source_item_id,
             s.source_url AS provenance_source_url,
             s.raw_item_id AS provenance_raw_item_id,
             s.fetched_at AS provenance_fetched_at
      FROM document_sources s
      JOIN documents d ON d.document_id=s.document_id
      WHERE s.run_id=?
      ORDER BY s.fetched_at DESC
      LIMIT ?
    `).all(runId, Math.max(1, Math.min(limit, 5000))) as any[];
    return rows.map((row) => this.rowToDocument(row, {
      run_id: row.provenance_run_id,
      platform: row.provenance_platform,
      source_item_id: row.provenance_source_item_id,
      parent_source_item_id: row.provenance_parent_source_item_id,
      source_url: row.provenance_source_url,
      raw_item_id: row.provenance_raw_item_id,
      fetched_at: row.provenance_fetched_at,
    }, this.loadAssets(row.document_id)));
  }

  list(limit = 100): CanonicalDocument[] {
    const ids = this.db.prepare(`
      SELECT document_id FROM documents ORDER BY updated_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(limit, 1000))) as Array<{ document_id: string }>;
    return ids.flatMap(({ document_id }) => {
      const document = this.get(document_id);
      return document ? [document] : [];
    });
  }

  listVersions(documentId: string): any[] {
    return (this.db.prepare(`
      SELECT version_id, document_id, revision_hash, content_hash, canonical_json, created_at
      FROM document_versions WHERE document_id=? ORDER BY created_at DESC
    `).all(documentId) as any[]).map((row) => ({
      version_id: row.version_id,
      document_id: row.document_id,
      revision_hash: row.revision_hash,
      content_hash: row.content_hash,
      created_at: row.created_at,
      document: canonicalDocumentSchema.parse(JSON.parse(row.canonical_json)),
    }));
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

  saveProcessed(documentInput: CanonicalDocument, artifacts: Artifact[] = []): CanonicalDocument {
    const document = canonicalDocumentSchema.parse(documentInput);
    const transaction = this.db.transaction(() => {
      const result = this.updateDocument(document);
      if (!result.changes) throw new Error(`Document not found: ${document.documentId}`);
      const versionId = this.insertVersion(document);
      this.db.prepare(`
        UPDATE document_sources SET document_version_id=? WHERE document_id=?
      `).run(versionId, document.documentId);
      this.persistAssets(document);
      for (const artifact of artifacts) this.addArtifact(artifact);
    });
    transaction();
    return document;
  }

  private persist(documentInput: CanonicalDocument, rawItem: RawItem, artifacts: Artifact[]): void {
    const document = canonicalDocumentSchema.parse(documentInput);
    const transaction = this.db.transaction(() => {
      this.upsertDocument(document);
      const documentVersionId = this.insertVersion(document);

      const sourceRecordId = hash(`${document.provenance.runId || 'none'}:${rawItem.id}`);
      this.db.prepare(`
        INSERT INTO document_sources (
          source_record_id, document_id, document_version_id, run_id, platform, source_item_id,
          parent_source_item_id, source_url, raw_item_id, raw_payload_json,
          fetched_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_record_id) DO UPDATE SET
          document_id=excluded.document_id,
          document_version_id=excluded.document_version_id,
          platform=excluded.platform,
          source_item_id=excluded.source_item_id,
          parent_source_item_id=excluded.parent_source_item_id,
          source_url=excluded.source_url,
          raw_payload_json=excluded.raw_payload_json,
          fetched_at=excluded.fetched_at
      `).run(
        sourceRecordId,
        document.documentId,
        documentVersionId,
        document.provenance.runId || null,
        document.platform,
        document.sourceItemId || null,
        document.parentSourceItemId || null,
        document.sourceUrl || null,
        document.provenance.rawItemId,
        JSON.stringify(rawItem.payload),
        document.fetchedAt,
        document.createdAt,
      );

      this.persistAssets(document);
      for (const artifact of artifacts) this.addArtifact(artifact);

      if (document.parentSourceItemId) {
        const parent = this.db.prepare(`
          SELECT document_id FROM document_sources
          WHERE platform=? AND source_item_id=?
          ORDER BY fetched_at DESC LIMIT 1
        `).get(document.platform, document.parentSourceItemId) as { document_id: string } | undefined;
        if (parent && parent.document_id !== document.documentId) {
          this.db.prepare(`
            INSERT OR IGNORE INTO document_relations (
              relation_id, from_document_id, to_document_id, relation_type, metadata_json, created_at
            ) VALUES (?, ?, ?, 'comment_of', '{}', ?)
          `).run(
            hash(`${document.documentId}:${parent.document_id}:comment_of`),
            document.documentId,
            parent.document_id,
            document.updatedAt,
          );
        }
      }
    });
    transaction();
  }

  private upsertDocument(document: CanonicalDocument): void {
    this.db.prepare(`
      INSERT INTO documents (
        document_id, canonical_key, kind, platform, original_platform,
        source_item_id, parent_source_item_id, source_url, keyword, rank,
        title, summary, markdown, subject_id, subject_name, subject_type,
        published_at, source_updated_at, fetched_at, language, content_hash,
        metrics_json, attributes_json, citations_json, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(canonical_key) DO UPDATE SET
        kind=excluded.kind,
        platform=excluded.platform,
        original_platform=excluded.original_platform,
        source_item_id=excluded.source_item_id,
        parent_source_item_id=excluded.parent_source_item_id,
        source_url=excluded.source_url,
        keyword=excluded.keyword,
        rank=excluded.rank,
        title=excluded.title,
        summary=excluded.summary,
        markdown=excluded.markdown,
        subject_id=excluded.subject_id,
        subject_name=excluded.subject_name,
        subject_type=excluded.subject_type,
        published_at=excluded.published_at,
        source_updated_at=excluded.source_updated_at,
        fetched_at=excluded.fetched_at,
        language=excluded.language,
        content_hash=excluded.content_hash,
        metrics_json=excluded.metrics_json,
        attributes_json=excluded.attributes_json,
        citations_json=excluded.citations_json,
        updated_at=excluded.updated_at
    `).run(...this.documentValues(document));
  }

  private updateDocument(document: CanonicalDocument): { changes: number } {
    return this.db.prepare(`
      UPDATE documents SET
        canonical_key=?, kind=?, platform=?, original_platform=?, source_item_id=?,
        parent_source_item_id=?, source_url=?, keyword=?, rank=?, title=?, summary=?,
        markdown=?, subject_id=?, subject_name=?, subject_type=?, published_at=?,
        source_updated_at=?, fetched_at=?, language=?, content_hash=?, metrics_json=?,
        attributes_json=?, citations_json=?, updated_at=?
      WHERE document_id=?
    `).run(
      document.canonicalKey,
      document.kind,
      document.platform,
      document.originalPlatform || null,
      document.sourceItemId || null,
      document.parentSourceItemId || null,
      document.sourceUrl || null,
      document.keyword || null,
      document.rank ?? null,
      document.title,
      document.summary,
      document.markdown,
      document.subject.id || null,
      document.subject.name || null,
      document.subject.type,
      document.publishedAt === undefined ? null : String(document.publishedAt),
      document.sourceUpdatedAt === undefined ? null : String(document.sourceUpdatedAt),
      document.fetchedAt,
      document.language,
      document.contentHash,
      JSON.stringify(document.metrics),
      JSON.stringify(document.attributes),
      JSON.stringify(document.citations),
      document.updatedAt,
      document.documentId,
    );
  }

  private documentValues(document: CanonicalDocument): unknown[] {
    return [
      document.documentId,
      document.canonicalKey,
      document.kind,
      document.platform,
      document.originalPlatform || null,
      document.sourceItemId || null,
      document.parentSourceItemId || null,
      document.sourceUrl || null,
      document.keyword || null,
      document.rank ?? null,
      document.title,
      document.summary,
      document.markdown,
      document.subject.id || null,
      document.subject.name || null,
      document.subject.type,
      document.publishedAt === undefined ? null : String(document.publishedAt),
      document.sourceUpdatedAt === undefined ? null : String(document.sourceUpdatedAt),
      document.fetchedAt,
      document.language,
      document.contentHash,
      JSON.stringify(document.metrics),
      JSON.stringify(document.attributes),
      JSON.stringify(document.citations),
      document.createdAt,
      document.updatedAt,
    ];
  }

  private persistAssets(document: CanonicalDocument): void {
    const statement = this.db.prepare(`
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
      statement.run(
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
  }

  private insertVersion(document: CanonicalDocument): string {
    const canonicalJson = JSON.stringify(document);
    // A version represents a business-document snapshot, not a crawl event.
    // Provenance and fetch timestamps live on document_sources; including them
    // here would manufacture a new version every time identical content is seen.
    const revisionHash = hash(JSON.stringify({
      canonicalKey: document.canonicalKey,
      kind: document.kind,
      platform: document.platform,
      originalPlatform: document.originalPlatform,
      sourceItemId: document.sourceItemId,
      parentSourceItemId: document.parentSourceItemId,
      sourceUrl: document.sourceUrl,
      keyword: document.keyword,
      rank: document.rank,
      title: document.title,
      summary: document.summary,
      markdown: document.markdown,
      subject: document.subject,
      publishedAt: document.publishedAt,
      sourceUpdatedAt: document.sourceUpdatedAt,
      language: document.language,
      metrics: document.metrics,
      attributes: document.attributes,
      citations: document.citations,
      assets: document.assets,
      contentHash: document.contentHash,
    }));
    const versionId = hash(`${document.documentId}:${revisionHash}`);
    this.db.prepare(`
      INSERT OR IGNORE INTO document_versions
        (version_id, document_id, revision_hash, content_hash, canonical_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      document.documentId,
      revisionHash,
      document.contentHash,
      canonicalJson,
      document.updatedAt,
    );
    return versionId;
  }

  private loadAssets(documentId: string): any[] {
    return this.db.prepare(`
      SELECT * FROM document_assets WHERE document_id=? ORDER BY created_at, asset_id
    `).all(documentId) as any[];
  }

  private rowToDocument(row: any, source: any, assets: any[]): CanonicalDocument {
    return canonicalDocumentSchema.parse({
      schemaVersion: 2,
      documentId: row.document_id,
      canonicalKey: row.canonical_key,
      kind: row.kind,
      platform: row.platform,
      ...(optional(row.original_platform) ? { originalPlatform: optional(row.original_platform) } : {}),
      ...(optional(row.source_item_id) ? { sourceItemId: optional(row.source_item_id) } : {}),
      ...(optional(row.parent_source_item_id) ? { parentSourceItemId: optional(row.parent_source_item_id) } : {}),
      ...(optional(row.source_url) ? { sourceUrl: optional(row.source_url) } : {}),
      ...(optional(row.keyword) ? { keyword: optional(row.keyword) } : {}),
      ...(row.rank === null || row.rank === undefined ? {} : { rank: Number(row.rank) }),
      title: row.title || '',
      summary: row.summary || '',
      markdown: row.markdown || '',
      subject: {
        ...(optional(row.subject_id) ? { id: optional(row.subject_id) } : {}),
        ...(optional(row.subject_name) ? { name: optional(row.subject_name) } : {}),
        type: row.subject_type || 'unknown',
      },
      ...(optional(row.published_at) ? { publishedAt: optional(row.published_at) } : {}),
      ...(optional(row.source_updated_at) ? { sourceUpdatedAt: optional(row.source_updated_at) } : {}),
      fetchedAt: row.fetched_at,
      language: row.language || 'und',
      metrics: parseJson(row.metrics_json, {}),
      attributes: parseJson(row.attributes_json, {}),
      citations: parseJson(row.citations_json, []),
      assets: assets.map((asset) => ({
        assetId: asset.asset_id,
        documentId: asset.document_id,
        kind: asset.kind,
        url: asset.url,
        ...(optional(asset.mime_type) ? { mimeType: optional(asset.mime_type) } : {}),
        ...(optional(asset.local_path) ? { localPath: optional(asset.local_path) } : {}),
        metadata: parseJson(asset.metadata_json, {}),
      })),
      provenance: {
        source: source?.platform || row.platform,
        ...(optional(source?.source_item_id || row.source_item_id)
          ? { sourceItemId: optional(source?.source_item_id || row.source_item_id) }
          : {}),
        ...(optional(source?.source_url || row.source_url)
          ? { sourceUrl: optional(source?.source_url || row.source_url) }
          : {}),
        rawItemId: source?.raw_item_id || `document:${row.document_id}`,
        ...(optional(source?.run_id) ? { runId: optional(source.run_id) } : {}),
        fetchedAt: source?.fetched_at || row.fetched_at,
      },
      contentHash: row.content_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

export const documentEngine = new DocumentEngine();
