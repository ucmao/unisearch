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
    assert.equal(repo.queryDocuments({ thread_id: 'thread-1' }).total, 3);
    assert.equal(repo.queryDocuments({ workflow_id: 'workflow-1' }).total, 1);
    assert.equal(repo.queryDocuments({ workflow_id: 'workflow-2' }).total, 2);

    const summary = repo.summary({ thread_id: 'thread-1' });
    assert.equal(summary.totals.content_count, 3);
    assert.equal(summary.totals.subject_count, 1);
  } finally {
    db.close();
  }
});

test('storageSummary reports thread and message counts, cleanupThreads removes threads without collected data', async () => {
  const { db, repository: repo } = repository();
  try {
    const now = new Date().toISOString();
    // Thread 1: Empty thread with 1 welcome message
    db.prepare("INSERT INTO agent_threads (thread_id, title, created_at, updated_at) VALUES ('t1', 'empty', ?, ?)").run(now, now);
    db.prepare("INSERT INTO agent_messages (message_id, thread_id, role, content, created_at) VALUES ('m1', 't1', 'assistant', 'hi', ?)").run(now);

    // Thread 2: Thread with crawl run
    await insertRun(db, 'run-t2', 't2');

    // Storage summary should show thread_records: 2, message_records: 1 (m1)
    const summary = repo.storageSummary();
    assert.equal(summary.thread_records, 2);
    assert.ok(summary.message_records >= 1);

    // Cleanup empty_short should delete t1 and keep t2
    const deleted = repo.cleanupThreads('empty_short');
    assert.equal(deleted, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM agent_threads WHERE thread_id='t1'").get() as any).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM agent_threads WHERE thread_id='t2'").get() as any).count, 1);
  } finally {
    db.close();
  }
});

test('cleanupThreads removes failed and zero-result crawl threads but keeps threads with primary data', async () => {
  const { db, repository: repo } = repository();
  try {
    const threads = [
      ['zero-result', 'failed'],
      ['failed', 'failed'],
      ['comments-only', 'completed'],
      ['with-data', 'completed'],
    ] as const;
    const now = new Date().toISOString();
    for (const [threadId] of threads) {
      db.prepare('INSERT INTO agent_threads (thread_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(threadId, threadId, now, now);
      db.prepare('INSERT INTO agent_messages (message_id, thread_id, role, content, created_at) VALUES (?, ?, \'user\', \'采集请求\', ?)')
        .run(`message-${threadId}`, threadId, now);
    }
    const zero = { thread_id: 'zero-result' };
    const failed = { thread_id: 'failed' };
    const commentsOnly = { thread_id: 'comments-only' };
    const withData = { thread_id: 'with-data' };

    const insertCrawlRun = (runId: string, threadId: string, status: string) => {
      db.prepare(`
        INSERT INTO crawl_runs
          (run_id, thread_id, task_title, task_name, platform, crawler_type, status, started_at)
        VALUES (?, ?, ?, ?, 'xhs', 'search', ?, datetime('now'))
      `).run(runId, threadId, runId, runId, status);
    };
    for (const [threadId, status] of threads) insertCrawlRun(`run-${threadId}`, threadId, status);

    await new DocumentEngine(() => db).ingest(buildRawItem('emitXhsNote', {
      note_id: 'primary-data', title: '有效数据', desc: '正文', note_url: 'https://example.com/primary-data', nickname: '用户',
    }), 'run-with-data');
    await new DocumentEngine(() => db).ingest(buildRawItem('emitXhsComment', {
      note_id: 'comment-only', title: '评论', desc: '评论正文', note_url: 'https://example.com/comment-only', nickname: '用户',
    }), 'run-comments-only');

    assert.equal(repo.cleanupThreads('empty_short'), 3);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_threads WHERE thread_id=?').get(withData.thread_id) as any).count, 1);

    db.prepare('INSERT INTO agent_threads (thread_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('old-empty', 'old-empty', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO agent_messages (message_id, thread_id, role, content, created_at) VALUES (?, ?, \'user\', \'历史采集请求\', ?)')
      .run('message-old-empty', 'old-empty', '2020-01-01T00:00:00.000Z');
    insertCrawlRun('run-old-empty', 'old-empty', 'failed');
    db.prepare('UPDATE agent_threads SET updated_at=? WHERE thread_id=?')
      .run('2020-01-01T00:00:00.000Z', withData.thread_id);
    assert.equal(repo.cleanupThreads('older_than_30_days_no_crawl'), 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_threads WHERE thread_id=?').get('old-empty') as any).count, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_threads WHERE thread_id=?').get(withData.thread_id) as any).count, 1);
  } finally {
    db.close();
  }
});
