import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';

test('content records preserve connector-specific source metadata', () => {
  const db = new Database(':memory:');
  try {
    initSchema(db);
    const columns = db.prepare('PRAGMA table_info(content_records)').all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === 'source_metadata'));
    for (const table of ['documents', 'document_sources', 'document_assets', 'document_artifacts', 'workflow_runs', 'workflow_steps']) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} should exist`);
    }
  } finally {
    db.close();
  }
});

test('crawler execution logs are persisted per run', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    initSchema(db);
    db.prepare(`
      INSERT INTO crawl_runs
      (run_id, thread_id, plan_id, task_title, task_name, platform, crawler_type, keywords, status, started_at)
      VALUES ('run-1', 'thread-1', 'plan-1', '测试任务', '测试任务', 'douyin', 'search', '测试', 'running', '2026-07-22T00:00:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO crawl_run_logs (run_id, platform, timestamp, level, message, created_at)
      VALUES ('run-1', 'douyin', '06:00:00', 'warning', '等待图形验证', '2026-07-22T00:00:00.000Z')
    `).run();
    const log = db.prepare('SELECT * FROM crawl_run_logs WHERE run_id = ?').get('run-1') as any;
    assert.equal(log.message, '等待图形验证');
    db.prepare('DELETE FROM crawl_runs WHERE run_id = ?').run('run-1');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM crawl_run_logs').get() as any).count, 0);
  } finally {
    db.close();
  }
});

test('legacy task_id databases are rebuilt for the explicit task hierarchy', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE crawl_runs (run_id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
      CREATE TABLE xhs_note (id INTEGER PRIMARY KEY, note_id TEXT);
      INSERT INTO crawl_runs VALUES ('legacy-run', 'legacy-task');
      INSERT INTO xhs_note VALUES (1, 'legacy-note');
    `);
    initSchema(db);
    const columns = db.prepare('PRAGMA table_info(crawl_runs)').all() as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === 'task_id'), false);
    assert.equal(columns.some((column) => column.name === 'thread_id'), true);
    assert.equal(columns.some((column) => column.name === 'plan_id'), true);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM crawl_runs').get() as any).count, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM xhs_note').get() as any).count, 0);
  } finally {
    db.close();
  }
});
