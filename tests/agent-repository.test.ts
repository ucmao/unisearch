import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { AgentRepository, type ResearchPlan } from '../src/server/services/AgentRepository';
import { AgentRunTrace, runWithAgentTrace } from '../src/server/agent/AgentToolRegistry';

function plan(overrides: Partial<ResearchPlan> = {}): ResearchPlan {
  return {
    goal: '调研扫地机器人口碑',
    platforms: ['xhs'],
    keywords: ['扫地机器人'],
    collectionDepth: 'standard',
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
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM workflow_runs WHERE thread_id=?').get(thread.thread_id) as any).count, 1);
  } finally {
    db.close();
  }
});

test('a business Skill id and version are persisted with its plan', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('市场调研');
    const created = repo.createPlan(thread.thread_id, plan({
      skillId: 'marketing-content-research',
      platforms: ['xhs', 'douyin'],
    }));

    assert.equal(created.skill_id, 'marketing-content-research');
    assert.equal(created.skill_version, '1.0.0');
    assert.equal(created.plan.skillId, 'marketing-content-research');
    const businessAnalysis = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_id=? AND step_key='business-analysis'",
    ).get(created.plan_id) as any;
    const datasetProfile = db.prepare(
      "SELECT * FROM workflow_steps WHERE workflow_id=? AND step_key='profile-dataset'",
    ).get(created.plan_id) as any;
    assert.ok(datasetProfile);
    assert.equal(datasetProfile.uses_id, 'analyzer.dataset.profile');
    assert.ok(businessAnalysis);
    assert.equal(
      JSON.parse(businessAnalysis.depends_on_json)[0],
      'profile-dataset',
    );
  } finally {
    db.close();
  }
});

test('automatic analysis is compiled independently from visible analysis goals', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('自动归纳');
    const created = repo.createPlan(thread.thread_id, plan({
      analysis: [],
      autoAnalyze: true,
    }));
    const keys = (db.prepare('SELECT step_key FROM workflow_steps WHERE workflow_id=?').all(created.plan_id) as any[])
      .map((row) => row.step_key);

    assert.ok(keys.includes('profile-dataset'));
    assert.ok(keys.includes('business-analysis'));
    assert.deepEqual(created.plan.analysis, []);
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
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM workflow_runs WHERE thread_id=?').get(thread.thread_id) as any).count, 2);
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

test('renaming a task preserves its recent ordering', () => {
  const { db, repository: repo } = repository();
  try {
    const older = repo.createThread('较早任务');
    const newer = repo.createThread('较新任务');
    const olderUpdatedAt = '2026-01-01T00:00:00.000Z';
    db.prepare('UPDATE agent_threads SET updated_at=? WHERE thread_id=?').run(olderUpdatedAt, older.thread_id);
    db.prepare('UPDATE agent_threads SET updated_at=? WHERE thread_id=?').run('2026-02-01T00:00:00.000Z', newer.thread_id);

    const renamed = repo.renameThread(older.thread_id, '重命名后的较早任务');

    assert.equal(renamed.updated_at, olderUpdatedAt);
    assert.deepEqual(repo.listThreads().map((thread: any) => thread.thread_id), [newer.thread_id, older.thread_id]);
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

test('deleting assistant message for regenerate removes assistant messages and returns user message info', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('刷新回答测试', false, false);
    const userMsg = repo.addMessage(thread.thread_id, 'user', 'text', '分析可观珠宝', { test: 123 });
    const replyMsg = repo.addMessage(thread.thread_id, 'assistant', 'text', '回答可观珠宝分析');

    const res = repo.deleteAssistantMessageForRegenerate(thread.thread_id, replyMsg.message_id);
    assert.ok(res);
    assert.equal(res.userMessage.content, '分析可观珠宝');
    assert.equal(res.userMessage.metadata.test, 123);

    const remaining = repo.getThread(thread.thread_id).messages;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].message_id, userMsg.message_id);
  } finally {
    db.close();
  }
});

test('schema version reset drops legacy data instead of migrating it', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE agent_threads (
        thread_id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO agent_threads VALUES ('legacy', '旧任务', 'active', 'now', 'now');
      PRAGMA user_version = 1;
    `);
    initSchema(db);
    const columns = db.prepare('PRAGMA table_info(agent_threads)').all() as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === 'title_source'), true);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_threads').get() as any).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='agent_plans'").get() as any).count, 0);
    const workflowIndexes = db.prepare('PRAGMA index_list(workflow_runs)').all() as Array<{ name: string }>;
    assert.equal(workflowIndexes.some((index) => index.name === 'idx_workflow_runs_thread'), true);
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
    assert.deepEqual(revised.steps.filter((step: any) => step.role === 'primary_collection').map((step: any) => step.platform).sort(), ['xhs', 'zhihu']);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM workflow_runs WHERE thread_id=?').get(thread.thread_id) as any).count, 1);
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

test('deleting a task always cascades workflows and Documents, and rejects active tasks', () => {
  const { db, repository: repo } = repository();
  try {
    const retained = repo.createThread('保留数据');
    const retainedPlan = repo.createPlan(retained.thread_id, plan());
    repo.updatePlanStatus(retainedPlan.plan_id, 'completed');
    db.prepare(`INSERT INTO crawl_runs
      (run_id, thread_id, workflow_id, task_title, task_name, platform, crawler_type, status, started_at)
      VALUES ('run-retained', ?, ?, '保留数据', '执行', 'xhs', 'search', 'completed', datetime('now'))`).run(retained.thread_id, retainedPlan.plan_id);
    assert.deepEqual(repo.deleteThread(retained.thread_id, false), { deleted: 1, analytics_runs_deleted: 1 });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM crawl_runs WHERE run_id='run-retained'").get() as any).count, 0);

    const cascaded = repo.createThread('同步清理');
    const cascadedPlan = repo.createPlan(cascaded.thread_id, plan());
    repo.updatePlanStatus(cascadedPlan.plan_id, 'completed');
    db.prepare(`INSERT INTO crawl_runs
      (run_id, thread_id, workflow_id, task_title, task_name, platform, crawler_type, status, started_at)
      VALUES ('run-cascaded', ?, ?, '同步清理', '执行', 'xhs', 'search', 'completed', datetime('now'))`).run(cascaded.thread_id, cascadedPlan.plan_id);
    assert.deepEqual(repo.deleteThread(cascaded.thread_id, true), { deleted: 1, analytics_runs_deleted: 1 });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM crawl_runs WHERE run_id='run-cascaded'").get() as any).count, 0);

    const active = repo.createThread('运行中');
    const activePlan = repo.createPlan(active.thread_id, plan());
    repo.updatePlanStatus(activePlan.plan_id, 'running');
    assert.throws(() => repo.deleteThread(active.thread_id), /停止/);
  } finally {
    db.close();
  }
});

test('dual-track memory supports manual multi-items and automatic category slots', () => {
  const { db, repository: repo } = repository();
  try {
    assert.deepEqual(repo.getMemorySettings(), {
      enabled: true,
      autoCapture: true,
    });
    assert.equal(repo.updateMemorySettings({ enabled: false }).enabled, false);
    assert.equal(repo.updateMemorySettings({ enabled: true, autoCapture: false }).autoCapture, false);

    // Manual memories can be created in arbitrary quantity
    const r1 = repo.upsertMemory({ category: 'rule', content: '规则1：导出默认 UTF-8', source: 'manual' });
    const r2 = repo.upsertMemory({ category: 'rule', content: '规则2：每次为三组加油', source: 'manual' });
    assert.notEqual(r1.memory_id, r2.memory_id);
    assert.equal(repo.listMemories().length, 2);

    // Automatic memories overwrite by category
    const autoId1 = repo.upsertMemory({ category: 'identity', content: '用户叫 Leo', source: 'automatic' });
    const autoId2 = repo.upsertMemory({ category: 'identity', content: '用户叫 Leo，是科莱特三组组长', source: 'automatic' });
    assert.equal(autoId1.memory_id, autoId2.memory_id);
    assert.equal(repo.listMemories().length, 3);
    assert.equal(repo.listMemories().find((m) => m.category === 'identity')?.content, '用户叫 Leo，是科莱特三组组长');

    // Dual-track retrieval
    assert.equal(repo.retrieveMemories().length, 3);

    // Update manual memory
    repo.updateMemory(r1.memory_id, { content: '规则1：导出必须是 UTF-8 编码' });
    assert.equal(repo.listMemories().find((m) => m.memory_id === r1.memory_id)?.content, '规则1：导出必须是 UTF-8 编码');

    // Delete single memory
    repo.deleteMemory(r2.memory_id);
    assert.equal(repo.listMemories().length, 2);

    initSchema(db);
    assert.equal(repo.listMemories().length, 2, 'reinitializing the schema must preserve memories');

    repo.clearMemories();
    assert.equal(repo.listMemories().length, 0);
  } finally {
    db.close();
  }
});

test('runtime settings persist and clamp the global crawler limit', () => {
  const { db, repository: repo } = repository();
  try {
    const defaultSettings = { maxConcurrentCrawlers: 2, connectorFailoverPolicy: 'smart', keywordExpansionPolicy: 'smart' };
    assert.deepEqual(repo.getRuntimeSettings(), defaultSettings);
    assert.deepEqual(repo.updateRuntimeSettings({ maxConcurrentCrawlers: 5 }), { ...defaultSettings, maxConcurrentCrawlers: 5 });
    assert.deepEqual(repo.updateRuntimeSettings({ maxConcurrentCrawlers: 8 }), { ...defaultSettings, maxConcurrentCrawlers: 5 });
    assert.deepEqual(repo.updateRuntimeSettings({ maxConcurrentCrawlers: 99 }), { ...defaultSettings, maxConcurrentCrawlers: 5 });
    assert.deepEqual(repo.updateRuntimeSettings({ maxConcurrentCrawlers: 0 }), { ...defaultSettings, maxConcurrentCrawlers: 1 });
  } finally {
    db.close();
  }
});

test('assistant messages automatically persist the active whole-run trace', async () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('轨迹测试');
    const trace = new AgentRunTrace(thread.thread_id);
    await runWithAgentTrace(trace, async () => {
      trace.recordRoute('chat', 'local');
      trace.recordModelCall({ durationMs: 12, success: true, inputTokens: 120, outputTokens: 20 });
      repo.addMessage(thread.thread_id, 'assistant', 'text', '回答', { action: 'chat' });
    });
    const message = repo.getThread(thread.thread_id).messages.at(-1);
    assert.equal(message.metadata.agent_run.route.action, 'chat');
    assert.equal(message.metadata.agent_run.metrics.model_calls, 1);
    assert.equal(message.metadata.agent_run.stop_reason, 'chat');
  } finally {
    db.close();
  }
});

test('isStepReady returns false when the parent workflow is cancelled or stopped', () => {
  const { db, repository: repo } = repository();
  try {
    const thread = repo.createThread('取消就绪测试');
    const created = repo.createPlan(thread.thread_id, plan({ platforms: ['xhs', 'zhihu'] }));
    repo.updatePlanStatus(created.plan_id, 'running');

    // Steps should be ready when running
    assert.equal(repo.isStepReady(created.plan_id, 'collect:xhs'), true);

    // When stopped, steps should not be ready
    repo.updatePlanStatus(created.plan_id, 'stopped');
    assert.equal(repo.isStepReady(created.plan_id, 'collect:xhs'), false);

    // When cancel_requested is set, steps should not be ready
    repo.updatePlanStatus(created.plan_id, 'running');
    db.prepare('UPDATE workflow_runs SET cancel_requested=1 WHERE workflow_id=?').run(created.plan_id);
    assert.equal(repo.isStepReady(created.plan_id, 'collect:xhs'), false);
  } finally {
    db.close();
  }
});

