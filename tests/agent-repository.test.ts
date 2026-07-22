import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { AgentRepository, type ResearchPlan } from '../src/server/services/AgentRepository';

function plan(overrides: Partial<ResearchPlan> = {}): ResearchPlan {
  return {
    goal: '调研扫地机器人口碑',
    platforms: ['xhs'],
    keywords: ['扫地机器人'],
    collectComments: true,
    collectSubComments: false,
    startPage: 1,
    loginType: 'qrcode',
    headless: false,
    analysis: ['用户观点'],
    outputs: ['csv'],
    ...overrides,
  };
}

function repository() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return { db, repository: new AgentRepository(() => db) };
}

test('creating a plan twice reuses the current active round', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('测试任务');
    const first = repo.createPlan(thread.thread_id, plan());
    const second = repo.createPlan(thread.thread_id, plan({ goal: '不应覆盖原计划' }));

    assert.equal(second.plan_id, first.plan_id);
    assert.equal(second.plan.goal, first.plan.goal);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_plans WHERE thread_id=?').get(thread.thread_id) as any).count, 1);
  } finally {
    db.close();
  }
});

test('a completed round allows a new collection round in the same task', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('多轮调研任务');
    const first = repo.createPlan(thread.thread_id, plan({ keywords: ['第一轮'] }));
    repo.updatePlanStatus(first.plan_id, 'completed');

    const second = repo.createPlan(thread.thread_id, plan({ platforms: ['zhihu'], keywords: ['第二轮'] }));
    const updated = repo.getThread(thread.thread_id);

    assert.notEqual(second.plan_id, first.plan_id);
    assert.equal(updated.plan.plan_id, second.plan_id);
    assert.deepEqual(updated.plans.map((item: any) => item.round_number), [1, 2]);
    assert.deepEqual(updated.plans.map((item: any) => item.plan.keywords), [['第一轮'], ['第二轮']]);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_plans WHERE thread_id=?').get(thread.thread_id) as any).count, 2);
  } finally {
    db.close();
  }
});

test('automatic titles stop changing after a manual rename', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread();
    repo.updateAutomaticTitle(thread.thread_id, '扫地机器人口碑调研', 'generated');
    assert.equal(repo.getThread(thread.thread_id).title, '扫地机器人口碑调研');

    const renamed = repo.renameThread(thread.thread_id, '我的重点项目');
    assert.equal(renamed.title, '我的重点项目');
    assert.equal(renamed.title_source, 'manual');
    assert.equal(renamed.title_locked, 1);

    repo.updateAutomaticTitle(thread.thread_id, '不应覆盖', 'plan');
    assert.equal(repo.getThread(thread.thread_id).title, '我的重点项目');
    assert.throws(() => repo.renameThread(thread.thread_id, '   '), /不能为空/);
  } finally {
    db.close();
  }
});

test('pinned tasks are listed first and return to recent ordering when unpinned', () => {
  const { db, repository: repo } = repository();
  try {
    const older = repo.createThread('较早任务');
    const newer = repo.createThread('较新任务');
    db.prepare('UPDATE agent_threads SET updated_at=? WHERE thread_id=?').run('2026-01-01T00:00:00.000Z', older.thread_id);
    db.prepare('UPDATE agent_threads SET updated_at=? WHERE thread_id=?').run('2026-02-01T00:00:00.000Z', newer.thread_id);

    const pinned = repo.setThreadPinned(older.thread_id, true);
    assert.ok(pinned.pinned_at);
    assert.deepEqual(repo.listThreads().map((thread: any) => thread.thread_id), [older.thread_id, newer.thread_id]);

    const unpinned = repo.setThreadPinned(older.thread_id, false);
    assert.equal(unpinned.pinned_at, null);
    assert.deepEqual(repo.listThreads().map((thread: any) => thread.thread_id), [newer.thread_id, older.thread_id]);
  } finally {
    db.close();
  }
});

test('a lazily created task starts without a welcome placeholder', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread(undefined, false, false);
    assert.equal(thread.title, '新建情报任务');
    assert.deepEqual(thread.messages, []);
  } finally {
    db.close();
  }
});

test('deleting a conversation pair removes one user turn and all of its assistant replies', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('对话删除', false, false);
    const firstUser = repo.addMessage(thread.thread_id, 'user', 'text', '第一问');
    const firstReply = repo.addMessage(thread.thread_id, 'assistant', 'text', '第一答');
    repo.addMessage(thread.thread_id, 'assistant', 'status', '第一答补充');
    const secondUser = repo.addMessage(thread.thread_id, 'user', 'text', '第二问');
    const secondReply = repo.addMessage(thread.thread_id, 'assistant', 'text', '第二答');

    assert.deepEqual(repo.deleteMessagePair(thread.thread_id, firstReply.message_id), { deleted: 3, attachment_ids: [] });
    assert.deepEqual(repo.getThread(thread.thread_id).messages.map((message: any) => message.message_id), [secondUser.message_id, secondReply.message_id]);
    assert.equal(repo.deleteMessagePair(thread.thread_id, firstUser.message_id), null);
  } finally {
    db.close();
  }
});

test('deleting a standalone assistant message does not consume the following user turn', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('欢迎消息');
    const welcome = thread.messages[0];
    const user = repo.addMessage(thread.thread_id, 'user', 'text', '你好');
    const reply = repo.addMessage(thread.thread_id, 'assistant', 'text', '你好呀');

    assert.equal(repo.deleteMessagePair(thread.thread_id, welcome.message_id)?.deleted, 1);
    assert.deepEqual(repo.getThread(thread.thread_id).messages.map((message: any) => message.message_id), [user.message_id, reply.message_id]);
  } finally {
    db.close();
  }
});

test('schema migration adds title controls to an existing conversation table', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE agent_threads (
        thread_id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    initSchema(db);
    const columns = db.prepare('PRAGMA table_info(agent_threads)').all() as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === 'title_source'), true);
    const planIndexes = db.prepare('PRAGMA index_list(agent_plans)').all() as Array<{ name: string; unique: number }>;
    assert.equal(planIndexes.some((index) => index.name === 'idx_agent_plans_one_per_thread'), false);
    assert.equal(planIndexes.some((index) => index.name === 'idx_agent_plans_thread_created' && index.unique === 0), true);
    assert.equal(columns.some((column) => column.name === 'title_locked'), true);
    assert.equal(columns.some((column) => column.name === 'pinned_at'), true);
  } finally {
    db.close();
  }
});

test('revising a pending plan updates the same plan and rebuilds its steps', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('测试任务');
    const first = repo.createPlan(thread.thread_id, plan());
    const revised = repo.updatePendingPlan(first.plan_id, plan({ platforms: ['xhs', 'zhihu'], keywords: ['新品'] }));

    assert.equal(revised.plan_id, first.plan_id);
    assert.deepEqual(revised.plan.keywords, ['新品']);
    assert.deepEqual(revised.steps.map((step: any) => step.platform).sort(), ['xhs', 'zhihu']);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_plans WHERE thread_id=?').get(thread.thread_id) as any).count, 1);
  } finally {
    db.close();
  }
});

test('a plan is frozen after execution has started', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('测试任务');
    const created = repo.createPlan(thread.thread_id, plan());
    repo.updatePlanStatus(created.plan_id, 'running');

    assert.throws(() => repo.updatePendingPlan(created.plan_id, plan({ keywords: ['新词'] })), /等待确认/);
  } finally {
    db.close();
  }
});

test('attachments are scoped to their conversation and removed with it', () => {
  const { db, repository: repo } = repository();
  try {
    const first = repo.createThread('附件任务');
    const second = repo.createThread('其他任务');
    const attachment = repo.createAttachment({
      thread_id: first.thread_id,
      file_name: 'notes.md',
      mime_type: 'text/markdown',
      kind: 'text',
      size_bytes: 12,
      text_content: '真实附件内容',
      storage_path: '',
    });

    assert.equal(repo.getAttachments(first.thread_id, [attachment.attachment_id]).length, 1);
    assert.equal(repo.getAttachments(second.thread_id, [attachment.attachment_id]).length, 0);
    repo.deleteThread(first.thread_id);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_attachments').get() as any).count, 0);
  } finally {
    db.close();
  }
});

test('deleting a task can retain or cascade analytics data and rejects active tasks', () => {
  const { db, repository: repo } = repository();
  try {
    const retained = repo.createThread('保留数据');
    const retainedPlan = repo.createPlan(retained.thread_id, plan());
    repo.updatePlanStatus(retainedPlan.plan_id, 'completed');
    db.prepare(`INSERT INTO crawl_runs
      (run_id, thread_id, plan_id, task_title, task_name, platform, crawler_type, status, started_at)
      VALUES ('run-retained', ?, ?, '保留数据', '执行', 'xhs', 'search', 'completed', datetime('now'))`).run(retained.thread_id, retainedPlan.plan_id);
    assert.deepEqual(repo.deleteThread(retained.thread_id, false), { deleted: 1, analytics_runs_deleted: 0 });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM crawl_runs WHERE run_id='run-retained'").get() as any).count, 1);

    const cascaded = repo.createThread('同步清理');
    const cascadedPlan = repo.createPlan(cascaded.thread_id, plan());
    repo.updatePlanStatus(cascadedPlan.plan_id, 'completed');
    db.prepare(`INSERT INTO crawl_runs
      (run_id, thread_id, plan_id, task_title, task_name, platform, crawler_type, status, started_at)
      VALUES ('run-cascaded', ?, ?, '同步清理', '执行', 'xhs', 'search', 'completed', datetime('now'))`).run(cascaded.thread_id, cascadedPlan.plan_id);
    assert.deepEqual(repo.deleteThread(cascaded.thread_id, true), { deleted: 1, analytics_runs_deleted: 1 });

    const active = repo.createThread('运行中');
    const activePlan = repo.createPlan(active.thread_id, plan());
    repo.updatePlanStatus(activePlan.plan_id, 'running');
    assert.throws(() => repo.deleteThread(active.thread_id), /停止/);
  } finally {
    db.close();
  }
});

test('memory settings and permanent memories are stored locally', () => {
  const { db, repository: repo } = repository();
  try {
    assert.deepEqual(repo.getMemorySettings(), {
      enabled: true,
      autoCapture: true,
      autoRecall: true,
      captureMode: 'balanced',
      recallLimit: 8,
    });
    assert.equal(repo.updateMemorySettings({ captureMode: 'conservative', recallLimit: 5 }).captureMode, 'conservative');

    const thread = repo.createThread('记忆来源');
    const source = repo.addMessage(thread.thread_id, 'user', 'text', '请记住我叫小青青');
    const created = repo.upsertMemory({
      category: 'identity', memoryKey: 'preferred_name', content: '用户希望被称为小青青',
      confidence: 0.98, importance: 0.9, status: 'active',
      sourceThreadId: thread.thread_id, sourceMessageId: source.message_id,
    });
    repo.upsertMemory({
      category: 'identity', memoryKey: 'preferred_name', content: '用户希望被称为青青',
      confidence: 0.99, importance: 0.8, status: 'active',
      sourceThreadId: thread.thread_id, sourceMessageId: source.message_id,
    });

    assert.equal(repo.listMemories().length, 1);
    assert.equal(repo.listMemories()[0].content, '用户希望被称为青青');
    assert.equal(repo.retrieveMemories('我是谁？', 5)[0].memory_id, created.memory_id);

    repo.deleteThread(thread.thread_id);
    assert.equal(repo.listMemories().length, 1, 'deleting a conversation must not delete permanent memory');
    assert.equal(repo.listMemories()[0].source_thread_id, null);
  } finally {
    db.close();
  }
});

test('runtime settings persist and clamp the global crawler limit', () => {
  const { db, repository: repo } = repository();
  try {
    assert.deepEqual(repo.getRuntimeSettings(), { maxConcurrentCrawlers: 3 });
    assert.deepEqual(repo.updateRuntimeSettings({ maxConcurrentCrawlers: 5 }), { maxConcurrentCrawlers: 5 });
    assert.deepEqual(repo.updateRuntimeSettings({ maxConcurrentCrawlers: 99 }), { maxConcurrentCrawlers: 5 });
    assert.deepEqual(repo.updateRuntimeSettings({ maxConcurrentCrawlers: 0 }), { maxConcurrentCrawlers: 1 });
  } finally {
    db.close();
  }
});

test('candidate and disabled memories are not recalled', () => {
  const { db, repository: repo } = repository();
  try {
    const candidate = repo.upsertMemory({
      category: 'preference', memoryKey: 'response_style', content: '用户可能喜欢简洁回答',
      confidence: 0.7, importance: 0.6, status: 'candidate',
    });
    assert.deepEqual(repo.retrieveMemories('回答风格'), []);

    repo.updateMemory(candidate.memory_id, { status: 'active' });
    assert.equal(repo.retrieveMemories('回答风格').length, 1);

    repo.updateMemorySettings({ enabled: false });
    assert.deepEqual(repo.retrieveMemories('回答风格'), []);
  } finally {
    db.close();
  }
});
