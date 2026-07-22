import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { AnalyticsRepository } from '../src/database/repository';

function repository() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return { db, repository: new AnalyticsRepository(() => db) };
}

function insertRun(db: Database.Database, runId: string, threadId: string, planId = threadId, status = 'completed') {
  db.prepare(`INSERT INTO crawl_runs
    (run_id, thread_id, plan_id, task_title, task_name, platform, crawler_type, status, started_at)
    VALUES (?, ?, ?, ?, ?, 'xhs', 'search', ?, datetime('now'))`).run(runId, threadId, planId, threadId, runId, status);
  db.prepare(`INSERT INTO content_records
    (run_id, platform, platform_label, content_id, ingested_at)
    VALUES (?, 'xhs', '小红书', ?, datetime('now'))`).run(runId, `content-${runId}`);
  db.prepare(`INSERT INTO crawl_run_logs
    (run_id, platform, timestamp, level, message, created_at)
    VALUES (?, 'xhs', datetime('now'), 'info', 'done', datetime('now'))`).run(runId);
}

test('batch dashboard removal cascades normalized records and keeps unrelated runs', () => {
  const { db, repository: repo } = repository();
  try {
    insertRun(db, 'run-a', 'task-a');
    insertRun(db, 'run-b', 'task-b');
    assert.equal(repo.deleteThreads(['task-a']), 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM crawl_runs').get() as any).count, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM content_records').get() as any).count, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM crawl_run_logs').get() as any).count, 1);
    assert.equal(repo.listTaskHierarchy().total, 1);
  } finally {
    db.close();
  }
});

test('dashboard removal rejects running selections and clear-all preserves them', () => {
  const { db, repository: repo } = repository();
  try {
    insertRun(db, 'done', 'task-done');
    insertRun(db, 'active', 'task-active', 'plan-active', 'running');
    assert.throws(() => repo.deleteRuns(['active']), /停止/);
    assert.equal(repo.deleteRuns(['all']), 1);
    assert.equal((db.prepare("SELECT status FROM crawl_runs WHERE run_id='active'").get() as any).status, 'running');
  } finally {
    db.close();
  }
});

test('task hierarchy merges multiple plans under one AI thread', () => {
  const { db, repository: repo } = repository();
  try {
    insertRun(db, 'run-1', 'thread-1', 'plan-1');
    insertRun(db, 'run-2', 'thread-1', 'plan-2');
    insertRun(db, 'run-3', 'thread-1', 'plan-2');
    const hierarchy = repo.listTaskHierarchy();
    assert.equal(hierarchy.total, 1);
    assert.equal(hierarchy.round_total, 2);
    assert.equal(hierarchy.run_total, 3);
    assert.equal(hierarchy.items[0].rounds.length, 2);
    assert.equal(hierarchy.items[0].rounds.find((round) => round.plan_id === 'plan-2')?.runs.length, 2);
    assert.equal(repo.queryContents({ thread_id: 'thread-1' }).total, 3);
    assert.equal(repo.queryContents({ plan_id: 'plan-1' }).total, 1);
    assert.equal(repo.queryContents({ plan_id: 'plan-2' }).total, 2);
  } finally {
    db.close();
  }
});
