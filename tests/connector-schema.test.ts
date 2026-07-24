import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { DATABASE_SCHEMA_VERSION, initSchema } from '../src/database/schema';

test('new database contains only Document and Workflow architecture tables', () => {
  const db = new Database(':memory:');
  try {
    initSchema(db);
    const tables = new Set((db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all() as Array<{ name: string }>).map((row) => row.name));
    for (const table of [
      'documents', 'document_versions', 'document_sources', 'document_assets', 'document_artifacts',
      'document_chunks', 'document_chunk_embeddings', 'document_chunks_fts',
      'analysis_reports', 'export_runs',
      'workflow_runs', 'workflow_steps', 'crawl_runs', 'crawl_run_logs',
    ]) assert.ok(tables.has(table), `${table} should exist`);
    for (const removed of ['content_records', 'agent_plans', 'agent_plan_steps', 'xhs_note', 'douyin_aweme']) {
      assert.equal(tables.has(removed), false, `${removed} should not exist`);
    }
    assert.equal(Number(db.pragma('user_version', { simple: true })), DATABASE_SCHEMA_VERSION);
  } finally {
    db.close();
  }
});

test('crawler execution logs cascade with a run', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    initSchema(db);
    db.prepare(`
      INSERT INTO crawl_runs
      (run_id, task_title, task_name, platform, crawler_type, keywords, status, started_at)
      VALUES ('run-1', '测试任务', '测试任务', 'douyin', 'search', '测试', 'running', '2026-07-22T00:00:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO crawl_run_logs (run_id, platform, timestamp, level, message, created_at)
      VALUES ('run-1', 'douyin', '06:00:00', 'warning', '等待图形验证', '2026-07-22T00:00:00.000Z')
    `).run();
    db.prepare("DELETE FROM crawl_runs WHERE run_id='run-1'").run();
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM crawl_run_logs').get() as any).count, 0);
  } finally {
    db.close();
  }
});

test('opening an old database deletes legacy data instead of migrating it', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE xhs_note (id INTEGER PRIMARY KEY, note_id TEXT);
      INSERT INTO xhs_note VALUES (1, 'legacy-note');
      PRAGMA user_version=1;
    `);
    initSchema(db);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='xhs_note'").get(), undefined);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM documents').get() as any).count, 0);
  } finally {
    db.close();
  }
});
