import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { AnalyticsRepository } from '../src/database/repository';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { DocumentEngine } from '../src/document/document-engine';
import { classifyConnectorError } from '../src/core/contracts/errors';

function repository() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return { db, repository: new AnalyticsRepository(() => db) };
}

async function seedRun(db: Database.Database, runId: string, notes: number, comments: number) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO agent_threads (thread_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run('thread-1', 'thread-1', now, now);
  db.prepare(`INSERT INTO crawl_runs
    (run_id, thread_id, workflow_id, task_title, task_name, platform, crawler_type, status, started_at)
    VALUES (?, 'thread-1', NULL, ?, ?, 'xhs', 'search', 'running', datetime('now'))`).run(runId, runId, runId);

  const engine = new DocumentEngine(() => db);
  for (let index = 0; index < notes; index++) {
    await engine.ingest(buildRawItem('emitXhsNote', {
      note_id: `${runId}-note-${index}`,
      title: `笔记 ${index}`,
      desc: `正文 ${index}`,
      note_url: `https://example.com/${runId}/${index}`,
      nickname: '测试用户',
    }), runId);
  }
  for (let index = 0; index < comments; index++) {
    await engine.ingest(buildRawItem('emitXhsComment', {
      comment_id: `${runId}-comment-${index}`,
      note_id: `${runId}-note-0`,
      content: `评论 ${index}`,
      nickname: '评论用户',
    }), runId);
  }
}

test('finishRun counts primary content and comments separately', async () => {
  const { db, repository: repo } = repository();
  try {
    await seedRun(db, 'run-a', 3, 7);
    repo.finishRun('run-a', 'completed', 0, []);
    const row = db.prepare('SELECT item_count, comment_count FROM crawl_runs WHERE run_id=?').get('run-a') as any;
    // A single blended total is what made the dashboard disagree with itself.
    assert.equal(row.item_count, 3);
    assert.equal(row.comment_count, 7);
    assert.equal(repo.queryContents({ run_id: 'run-a', page_size: 100 }).total, row.item_count);
  } finally {
    db.close();
  }
});

test('a run that only produced comments is not reported as a successful harvest', async () => {
  const { db, repository: repo } = repository();
  try {
    await seedRun(db, 'run-b', 0, 5);
    repo.finishRun('run-b', 'completed', 0, []);
    const row = db.prepare('SELECT item_count, comment_count FROM crawl_runs WHERE run_id=?').get('run-b') as any;
    assert.equal(row.item_count, 0);
    assert.equal(row.comment_count, 5);
  } finally {
    db.close();
  }
});

test('running counters refresh before the run finishes', async () => {
  const { db, repository: repo } = repository();
  try {
    await seedRun(db, 'run-c', 2, 4);
    assert.equal((db.prepare('SELECT item_count FROM crawl_runs WHERE run_id=?').get('run-c') as any).item_count, 0);
    repo.refreshRunCounts('run-c');
    const row = db.prepare('SELECT item_count, comment_count FROM crawl_runs WHERE run_id=?').get('run-c') as any;
    assert.equal(row.item_count, 2);
    assert.equal(row.comment_count, 4);
  } finally {
    db.close();
  }
});

test('error classification is not hijacked by page copy quoted in the message', () => {
  // 抖音 used to append the whole page body to its errors, so "验证码登录" in the
  // login wall made every failure look like a captcha prompt.
  assert.equal(
    classifyConnectorError(new Error('未捕获到抖音搜索请求，页面可能被风控或尚未完成加载。')).code,
    'ANTI_BOT_BLOCKED',
  );
  assert.equal(
    classifyConnectorError(new Error('抖音搜索页出现图形验证，请手动完成')).code,
    'MANUAL_VERIFICATION_REQUIRED',
  );
  assert.equal(
    classifyConnectorError(new Error('等待抖音图形验证超时，请重新运行任务')).code,
    'MANUAL_VERIFICATION_REQUIRED',
  );
  assert.equal(
    classifyConnectorError(new Error('抖音登录已失效，请重新扫码')).code,
    'AUTH_REQUIRED',
  );
  assert.equal(
    classifyConnectorError(new Error('Timeout 30000ms exceeded')).code,
    'TIMEOUT',
  );
});
