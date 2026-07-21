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
      (run_id, task_id, task_title, task_name, platform, crawler_type, keywords, status, started_at)
      VALUES ('run-1', 'task-1', '测试任务', '测试任务', 'dy', 'search', '测试', 'running', '2026-07-22T00:00:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO crawl_run_logs (run_id, platform, timestamp, level, message, created_at)
      VALUES ('run-1', 'dy', '06:00:00', 'warning', '等待图形验证', '2026-07-22T00:00:00.000Z')
    `).run();
    const log = db.prepare('SELECT * FROM crawl_run_logs WHERE run_id = ?').get('run-1') as any;
    assert.equal(log.message, '等待图形验证');
    db.prepare('DELETE FROM crawl_runs WHERE run_id = ?').run('run-1');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM crawl_run_logs').get() as any).count, 0);
  } finally {
    db.close();
  }
});
