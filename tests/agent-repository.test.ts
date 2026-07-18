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

test('creating a plan twice is idempotent for one task', () => {
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
