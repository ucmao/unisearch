import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../../database/connection';

export type AgentRole = 'user' | 'assistant' | 'system';

export interface ResearchPlan {
  goal: string;
  platforms: string[];
  keywords: string[];
  collectComments: boolean;
  collectSubComments: boolean;
  startPage: number;
  loginType: 'qrcode' | 'cookie';
  headless: boolean;
  analysis: string[];
  outputs: string[];
}

function id(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export class AgentRepository {
  private get db(): Database { return getDb(); }

  createThread(title = '新建情报任务') {
    const threadId = id();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO agent_threads (thread_id, title, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`)
      .run(threadId, title, now, now);
    this.addMessage(threadId, 'assistant', 'text', '告诉我你想采集什么信息、涉及哪些平台，以及最终希望得到什么结论。');
    return this.getThread(threadId);
  }

  listThreads() {
    return this.db.prepare(`
      SELECT t.*,
        (SELECT content FROM agent_messages m WHERE m.thread_id=t.thread_id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
        (SELECT status FROM agent_plans p WHERE p.thread_id=t.thread_id ORDER BY p.created_at DESC LIMIT 1) AS plan_status
      FROM agent_threads t ORDER BY t.updated_at DESC
    `).all();
  }

  getThread(threadId: string): any {
    const thread = this.db.prepare('SELECT * FROM agent_threads WHERE thread_id = ?').get(threadId) as any;
    if (!thread) return null;
    const messages = (this.db.prepare('SELECT * FROM agent_messages WHERE thread_id = ? ORDER BY created_at').all(threadId) as any[])
      .map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
    const plan = this.getLatestPlan(threadId);
    return { ...thread, messages, plan };
  }

  deleteThread(threadId: string): boolean {
    return this.db.prepare('DELETE FROM agent_threads WHERE thread_id = ?').run(threadId).changes > 0;
  }

  touchThread(threadId: string, title?: string) {
    const now = new Date().toISOString();
    if (title) this.db.prepare('UPDATE agent_threads SET title=?, updated_at=? WHERE thread_id=?').run(title, now, threadId);
    else this.db.prepare('UPDATE agent_threads SET updated_at=? WHERE thread_id=?').run(now, threadId);
  }

  addMessage(threadId: string, role: AgentRole, kind: string, content: string, metadata: any = {}) {
    const messageId = id();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO agent_messages (message_id, thread_id, role, kind, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(messageId, threadId, role, kind, content, JSON.stringify(metadata), now);
    this.touchThread(threadId);
    return { message_id: messageId, thread_id: threadId, role, kind, content, metadata, created_at: now };
  }

  createPlan(threadId: string, plan: ResearchPlan) {
    const planId = id();
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE agent_plans SET status='superseded', updated_at=? WHERE thread_id=? AND status IN ('draft','awaiting_confirmation')`).run(now, threadId);
      this.db.prepare(`INSERT INTO agent_plans (plan_id, thread_id, goal, status, plan_json, created_at, updated_at) VALUES (?, ?, ?, 'awaiting_confirmation', ?, ?, ?)`)
        .run(planId, threadId, plan.goal, JSON.stringify(plan), now, now);
      const insert = this.db.prepare(`INSERT INTO agent_plan_steps (step_id, plan_id, platform, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)`);
      for (const platform of plan.platforms) insert.run(id(), planId, platform, now, now);
    });
    tx();
    return this.getPlan(planId);
  }

  getLatestPlan(threadId: string) {
    const row = this.db.prepare(`SELECT * FROM agent_plans WHERE thread_id=? AND status!='superseded' ORDER BY created_at DESC LIMIT 1`).get(threadId) as any;
    return row ? this.hydratePlan(row) : null;
  }

  getPlan(planId: string) {
    const row = this.db.prepare('SELECT * FROM agent_plans WHERE plan_id=?').get(planId) as any;
    return row ? this.hydratePlan(row) : null;
  }

  private hydratePlan(row: any) {
    const steps = this.db.prepare('SELECT * FROM agent_plan_steps WHERE plan_id=? ORDER BY created_at').all(row.plan_id);
    return { ...row, plan: parseJson<ResearchPlan>(row.plan_json, {} as ResearchPlan), steps };
  }

  listActivePlans(): any[] {
    return (this.db.prepare(`SELECT * FROM agent_plans WHERE status IN ('queued','running') ORDER BY created_at`).all() as any[])
      .map((row) => this.hydratePlan(row));
  }

  updatePlanStatus(planId: string, status: string) {
    this.db.prepare('UPDATE agent_plans SET status=?, updated_at=? WHERE plan_id=?').run(status, new Date().toISOString(), planId);
  }

  updateStep(stepId: string, status: string, runId?: string | null, errorMessage?: string | null) {
    this.db.prepare(`UPDATE agent_plan_steps SET status=?, run_id=COALESCE(?, run_id), error_message=?, updated_at=? WHERE step_id=?`)
      .run(status, runId || null, errorMessage || null, new Date().toISOString(), stepId);
  }

  getCrawlRun(runId: string): any {
    return this.db.prepare('SELECT * FROM crawl_runs WHERE run_id=?').get(runId);
  }

  getPlanContents(planId: string, limit = 60): any[] {
    return this.db.prepare(`
      SELECT c.platform_label, c.keyword, substr(c.title, 1, 240) AS title,
             substr(c.description, 1, 800) AS description, c.creator_name,
             c.likes, c.saves, c.comments, c.shares, c.views, c.content_url
      FROM content_records c
      JOIN agent_plan_steps s ON s.run_id=c.run_id
      WHERE s.plan_id=? ORDER BY c.engagement DESC LIMIT ?
    `).all(planId, limit) as any[];
  }

  getPlanStats(planId: string): { content_count: number; by_platform: Array<{ platform: string; platform_label: string; count: number }> } {
    const total = this.db.prepare(`
      SELECT COUNT(*) AS content_count
      FROM content_records c
      JOIN agent_plan_steps s ON s.run_id=c.run_id
      WHERE s.plan_id=?
    `).get(planId) as { content_count: number } | undefined;
    const byPlatform = this.db.prepare(`
      SELECT c.platform, c.platform_label, COUNT(*) AS count
      FROM content_records c
      JOIN agent_plan_steps s ON s.run_id=c.run_id
      WHERE s.plan_id=?
      GROUP BY c.platform, c.platform_label
      ORDER BY count DESC
    `).all(planId) as Array<{ platform: string; platform_label: string; count: number }>;
    return { content_count: Number(total?.content_count || 0), by_platform: byPlatform };
  }

  getPlanExportContents(planId: string): any[] {
    return this.db.prepare(`
      SELECT c.* FROM content_records c
      JOIN agent_plan_steps s ON s.run_id=c.run_id
      WHERE s.plan_id=? ORDER BY c.platform, c.keyword, c.engagement DESC
    `).all(planId) as any[];
  }
}

export const agentRepository = new AgentRepository();
