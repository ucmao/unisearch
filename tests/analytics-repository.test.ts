import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { AnalyticsRepository } from '../src/database/repository';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { DocumentEngine } from '../src/document/document-engine';

function repository() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return { db, repository: new AnalyticsRepository(() => db) };
}

async function insertRun(db: Database.Database, runId: string, threadId: string, workflowId = threadId, status = 'completed') {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO agent_threads
      (thread_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(threadId, threadId, now, now);
  db.prepare(`
    INSERT OR IGNORE INTO workflow_runs
      (workflow_id, thread_id, skill_id, skill_version, goal, status, input_json, output_json, created_at, updated_at)
    VALUES (?, ?, 'test', '1', ?, 'completed', '{}', '{}', ?, ?)
  `).run(workflowId, threadId, workflowId, now, now);
  db.prepare(`INSERT INTO crawl_runs
    (run_id, thread_id, workflow_id, task_title, task_name, platform, crawler_type, status, started_at)
    VALUES (?, ?, ?, ?, ?, 'xhs', 'search', ?, datetime('now'))`).run(runId, threadId, workflowId, threadId, runId, status);
  await new DocumentEngine(() => db).ingest(buildRawItem('emitXhsNote', {
    note_id: `content-${runId}`,
    title: `内容 ${runId}`,
    desc: `正文 ${runId}`,
    note_url: `https://example.com/${runId}`,
    nickname: '测试用户',
  }), runId);
  db.prepare(`INSERT INTO crawl_run_logs
    (run_id, platform, timestamp, level, message, created_at)
    VALUES (?, 'xhs', datetime('now'), 'info', 'done', datetime('now'))`).run(runId);
}

test('batch dashboard removal cascades Documents and keeps unrelated runs', async () => {
  const { db, repository: repo } = repository();
  try {
    await insertRun(db, 'run-a', 'task-a');
    await insertRun(db, 'run-b', 'task-b');
    assert.equal(repo.deleteThreads(['task-a']), 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM crawl_runs').get() as any).count, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM documents').get() as any).count, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM crawl_run_logs').get() as any).count, 1);
    assert.equal(repo.listTaskHierarchy().total, 1);
  } finally {
    db.close();
  }
});

test('dashboard removal rejects running selections and clear-all preserves them', async () => {
  const { db, repository: repo } = repository();
  try {
    await insertRun(db, 'done', 'task-done');
    await insertRun(db, 'active', 'task-active', 'workflow-active', 'running');
    assert.throws(() => repo.deleteRuns(['active']), /停止/);
    assert.equal(repo.deleteRuns(['all']), 1);
    assert.equal((db.prepare("SELECT status FROM crawl_runs WHERE run_id='active'").get() as any).status, 'running');
  } finally {
    db.close();
  }
});

test('task hierarchy merges multiple workflows under one AI thread', async () => {
  const { db, repository: repo } = repository();
  try {
    await insertRun(db, 'run-1', 'thread-1', 'workflow-1');
    await insertRun(db, 'run-2', 'thread-1', 'workflow-2');
    await insertRun(db, 'run-3', 'thread-1', 'workflow-2');
    const hierarchy = repo.listTaskHierarchy();
    assert.equal(hierarchy.total, 1);
    assert.equal(hierarchy.round_total, 2);
    assert.equal(hierarchy.run_total, 3);
    assert.equal(hierarchy.items[0].rounds.length, 2);
    assert.equal(hierarchy.items[0].rounds.find((round) => round.plan_id === 'workflow-2')?.runs.length, 2);
    assert.equal(repo.queryContents({ thread_id: 'thread-1' }).total, 3);
    assert.equal(repo.queryContents({ plan_id: 'workflow-1' }).total, 1);
    assert.equal(repo.queryContents({ plan_id: 'workflow-2' }).total, 2);

    const summary = repo.summary(null, null, null, null, 'thread-1');
    assert.equal(summary.totals.content_count, 3);
    assert.equal(summary.totals.creator_count, 1);
  } finally {
    db.close();
  }
});
