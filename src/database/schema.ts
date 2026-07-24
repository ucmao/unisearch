import type { Database } from 'better-sqlite3';

export const DATABASE_SCHEMA_VERSION = 5;

function dropExistingSchema(db: Database): void {
  db.pragma('foreign_keys = OFF');
  const objects = db.prepare(`
    SELECT type, name FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view', 'trigger')
  `).all() as Array<{ type: string; name: string }>;
  for (const object of objects) {
    const type = object.type === 'view' ? 'VIEW' : object.type === 'trigger' ? 'TRIGGER' : 'TABLE';
    db.exec(`DROP ${type} IF EXISTS "${object.name.replace(/"/g, '""')}"`);
  }
  db.pragma('foreign_keys = ON');
}

export function initSchema(db: Database): void {
  const version = Number(db.pragma('user_version', { simple: true }) || 0);
  if (version !== DATABASE_SCHEMA_VERSION) dropExistingSchema(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_threads (
      thread_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_source TEXT NOT NULL DEFAULT 'default',
      title_locked INTEGER NOT NULL DEFAULT 0,
      pinned_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_threads_updated ON agent_threads(updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES agent_threads(thread_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_memory_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_capture INTEGER NOT NULL DEFAULT 1,
      auto_recall INTEGER NOT NULL DEFAULT 1,
      capture_mode TEXT NOT NULL DEFAULT 'balanced',
      recall_limit INTEGER NOT NULL DEFAULT 8,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO agent_memory_settings
      (id, enabled, auto_capture, auto_recall, capture_mode, recall_limit, updated_at)
    VALUES (1, 1, 1, 1, 'balanced', 8, datetime('now'));

    CREATE TABLE IF NOT EXISTS agent_runtime_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      max_concurrent_crawlers INTEGER NOT NULL DEFAULT 3,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO agent_runtime_settings
      (id, max_concurrent_crawlers, updated_at)
    VALUES (1, 3, datetime('now'));

    CREATE TABLE IF NOT EXISTS agent_memories (
      memory_id TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT 'context',
      memory_key TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      importance REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'active',
      source_thread_id TEXT,
      source_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY(source_thread_id) REFERENCES agent_threads(thread_id) ON DELETE SET NULL,
      FOREIGN KEY(source_message_id) REFERENCES agent_messages(message_id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memories_status
      ON agent_memories(status, importance DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_attachments (
      attachment_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      kind TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      text_content TEXT NOT NULL DEFAULT '',
      storage_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES agent_threads(thread_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_attachments_thread
      ON agent_attachments(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS workflow_runs (
      workflow_id TEXT PRIMARY KEY,
      thread_id TEXT,
      skill_id TEXT NOT NULL,
      skill_version TEXT NOT NULL,
      goal TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'created',
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY(thread_id) REFERENCES agent_threads(thread_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_thread ON workflow_runs(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS workflow_steps (
      step_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      uses_id TEXT NOT NULL,
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      dependency_policy TEXT NOT NULL DEFAULT 'success',
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      timeout_ms INTEGER NOT NULL DEFAULT 300000,
      external_ref TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY(workflow_id) REFERENCES workflow_runs(workflow_id) ON DELETE CASCADE,
      UNIQUE(workflow_id, step_key)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_ready
      ON workflow_steps(workflow_id, status);

    CREATE TABLE IF NOT EXISTS crawl_runs (
      run_id TEXT PRIMARY KEY,
      thread_id TEXT,
      workflow_id TEXT,
      task_title TEXT NOT NULL DEFAULT '',
      task_name TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL,
      crawler_type TEXT NOT NULL DEFAULT '',
      keywords TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_code INTEGER,
      item_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(workflow_id) REFERENCES workflow_runs(workflow_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON crawl_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON crawl_runs(thread_id);
    CREATE INDEX IF NOT EXISTS idx_runs_workflow_id ON crawl_runs(workflow_id);

    CREATE TABLE IF NOT EXISTS crawl_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES crawl_runs(run_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON crawl_run_logs(run_id, id);

    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      markdown TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      source_url TEXT,
      language TEXT NOT NULL DEFAULT 'und',
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_kind_updated ON documents(kind, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);

    CREATE TABLE IF NOT EXISTS document_versions (
      version_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      markdown TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
      UNIQUE(document_id, content_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_document_versions_document
      ON document_versions(document_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS document_sources (
      source_record_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      run_id TEXT,
      source TEXT NOT NULL,
      source_item_id TEXT,
      source_url TEXT,
      raw_item_id TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL DEFAULT '{}',
      fetched_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES crawl_runs(run_id) ON DELETE CASCADE,
      UNIQUE(run_id, raw_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_document_sources_document ON document_sources(document_id);
    CREATE INDEX IF NOT EXISTS idx_document_sources_run ON document_sources(run_id);
    CREATE INDEX IF NOT EXISTS idx_document_sources_source_item
      ON document_sources(source, source_item_id);
    CREATE TRIGGER IF NOT EXISTS delete_orphan_document
    AFTER DELETE ON document_sources
    BEGIN
      DELETE FROM documents
      WHERE document_id=OLD.document_id
        AND NOT EXISTS (SELECT 1 FROM document_sources WHERE document_id=OLD.document_id);
    END;

    CREATE TABLE IF NOT EXISTS document_assets (
      asset_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      mime_type TEXT,
      local_path TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
      UNIQUE(document_id, url)
    );
    CREATE INDEX IF NOT EXISTS idx_document_assets_document ON document_assets(document_id);

    CREATE TABLE IF NOT EXISTS document_artifacts (
      artifact_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      type TEXT NOT NULL,
      processor_id TEXT NOT NULL,
      processor_version TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
      UNIQUE(document_id, type, processor_id, processor_version, input_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_document_artifacts_document
      ON document_artifacts(document_id);

    CREATE TABLE IF NOT EXISTS document_relations (
      relation_id TEXT PRIMARY KEY,
      from_document_id TEXT NOT NULL,
      to_document_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(from_document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
      FOREIGN KEY(to_document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
      UNIQUE(from_document_id, to_document_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
      UNIQUE(document_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_document_chunks_document
      ON document_chunks(document_id, ordinal);

    CREATE TABLE IF NOT EXISTS document_chunk_embeddings (
      chunk_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(chunk_id, model),
      FOREIGN KEY(chunk_id) REFERENCES document_chunks(chunk_id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      document_id UNINDEXED,
      title,
      content,
      tokenize='unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS delete_chunk_fts
    AFTER DELETE ON document_chunks
    BEGIN
      DELETE FROM document_chunks_fts WHERE chunk_id=OLD.chunk_id;
    END;

    CREATE TABLE IF NOT EXISTS analysis_reports (
      report_id TEXT PRIMARY KEY,
      analyzer_id TEXT NOT NULL,
      analyzer_version TEXT NOT NULL,
      workflow_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(workflow_id) REFERENCES workflow_runs(workflow_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS export_runs (
      export_id TEXT PRIMARY KEY,
      exporter_id TEXT NOT NULL,
      workflow_id TEXT,
      output_path TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(workflow_id) REFERENCES workflow_runs(workflow_id) ON DELETE CASCADE
    );
  `);

  db.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
}
