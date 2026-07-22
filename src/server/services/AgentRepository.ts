import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../../database/connection';

export type AgentRole = 'user' | 'assistant' | 'system';

export interface ResearchPlan {
  goal: string;
  platforms: string[];
  keywords: string[];
  capability?: 'keyword_search' | 'content_detail' | 'creator_profile' | 'comments' | 'url_resolve';
  targets?: string[];
  connectorOptions?: Record<string, Record<string, unknown>>;
  collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom';
  collectComments: boolean;
  collectSubComments: boolean;
  startPage: number;
  loginType: 'qrcode' | 'cookie';
  headless: boolean;
  analysis: string[];
  analysisSource?: 'ai' | 'fallback' | 'user';
  outputs: string[];
}

export interface AgentAttachmentRecord {
  attachment_id: string;
  thread_id: string;
  file_name: string;
  mime_type: string;
  kind: 'image' | 'text' | 'spreadsheet';
  size_bytes: number;
  text_content: string;
  storage_path: string;
  created_at: string;
}

export interface MemorySettings {
  enabled: boolean;
  autoCapture: boolean;
  autoRecall: boolean;
  captureMode: 'conservative' | 'balanced';
  recallLimit: number;
}

export interface RuntimeSettings {
  maxConcurrentCrawlers: number;
}

export interface AgentMemoryRecord {
  memory_id: string;
  category: 'identity' | 'preference' | 'context' | 'rule';
  memory_key: string;
  content: string;
  confidence: number;
  importance: number;
  status: 'active' | 'candidate';
  source_thread_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

function id(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export class AgentRepository {
  constructor(private readonly databaseProvider: () => Database = getDb) {}

  private get db(): Database { return this.databaseProvider(); }

  createThread(title = '新建情报任务', titleLocked = false, addWelcomeMessage = true) {
    const threadId = id();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO agent_threads (thread_id, title, title_source, title_locked, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`)
      .run(threadId, title, titleLocked ? 'manual' : 'default', titleLocked ? 1 : 0, now, now);
    if (addWelcomeMessage) {
      this.addMessage(threadId, 'assistant', 'text', '你好，想聊点什么，还是开始一项调研？');
    }
    return this.getThread(threadId);
  }

  listThreads() {
    return this.db.prepare(`
      SELECT t.*,
        (SELECT content FROM agent_messages m WHERE m.thread_id=t.thread_id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
        (SELECT status FROM agent_plans p WHERE p.thread_id=t.thread_id ORDER BY p.created_at DESC LIMIT 1) AS plan_status
      FROM agent_threads t
      ORDER BY (t.pinned_at IS NOT NULL) DESC, t.pinned_at DESC, t.updated_at DESC
    `).all();
  }

  getThread(threadId: string): any {
    const thread = this.db.prepare('SELECT * FROM agent_threads WHERE thread_id = ?').get(threadId) as any;
    if (!thread) return null;
    const messages = (this.db.prepare('SELECT * FROM agent_messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC').all(threadId) as any[])
      .map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
    const plan = this.getLatestPlan(threadId);
    const plans = this.listPlans(threadId);
    return { ...thread, messages, plan, plans };
  }

  deleteThread(threadId: string, deleteAnalyticsData = false): { deleted: number; analytics_runs_deleted: number } {
    const id = String(threadId || '').trim();
    if (!id) return { deleted: 0, analytics_runs_deleted: 0 };
    const active = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM agent_plans
      WHERE thread_id=? AND status IN ('queued', 'running')
    `).get(id) as { count: number };
    if (Number(active?.count || 0) > 0) throw new Error('请先停止正在排队或采集中的任务');
    const runningRuns = this.db.prepare(`
      SELECT COUNT(*) AS count FROM crawl_runs
      WHERE status = 'running' AND thread_id=?
    `).get(id) as { count: number };
    if (Number(runningRuns?.count || 0) > 0) throw new Error('请先停止正在采集的执行');

    return this.db.transaction(() => {
      let analyticsRunsDeleted = 0;
      if (deleteAnalyticsData) {
        const result = this.db.prepare('DELETE FROM crawl_runs WHERE thread_id=?').run(id);
        analyticsRunsDeleted = result.changes;
      }
      const deleted = this.db.prepare('DELETE FROM agent_threads WHERE thread_id=?').run(id).changes;
      return { deleted, analytics_runs_deleted: analyticsRunsDeleted };
    })();
  }

  createAttachment(input: Omit<AgentAttachmentRecord, 'attachment_id' | 'created_at'>): AgentAttachmentRecord {
    const attachmentId = id();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agent_attachments
        (attachment_id, thread_id, file_name, mime_type, kind, size_bytes, text_content, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attachmentId, input.thread_id, input.file_name, input.mime_type, input.kind,
      input.size_bytes, input.text_content, input.storage_path, createdAt,
    );
    return this.getAttachment(input.thread_id, attachmentId)!;
  }

  getAttachment(threadId: string, attachmentId: string): AgentAttachmentRecord | null {
    return (this.db.prepare('SELECT * FROM agent_attachments WHERE thread_id=? AND attachment_id=?')
      .get(threadId, attachmentId) as AgentAttachmentRecord | undefined) || null;
  }

  getAttachments(threadId: string, attachmentIds: string[]): AgentAttachmentRecord[] {
    if (!attachmentIds.length) return [];
    const placeholders = attachmentIds.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM agent_attachments WHERE thread_id=? AND attachment_id IN (${placeholders}) ORDER BY created_at`)
      .all(threadId, ...attachmentIds) as AgentAttachmentRecord[];
  }

  deleteAttachment(threadId: string, attachmentId: string): AgentAttachmentRecord | null {
    const existing = this.getAttachment(threadId, attachmentId);
    if (!existing) return null;
    this.db.prepare('DELETE FROM agent_attachments WHERE thread_id=? AND attachment_id=?').run(threadId, attachmentId);
    return existing;
  }

  listReferenceableTasks() {
    return (this.db.prepare(`
      SELECT p.plan_id, p.goal, p.status, p.updated_at,
             GROUP_CONCAT(DISTINCT s.platform) AS platforms,
             COUNT(DISTINCT c.id) AS content_count
      FROM agent_plans p
      LEFT JOIN agent_plan_steps s ON s.plan_id=p.plan_id
      LEFT JOIN content_records c ON c.run_id=s.run_id
      WHERE p.status IN ('completed', 'partially_completed')
      GROUP BY p.plan_id
      ORDER BY p.updated_at DESC
    `).all() as any[]).map((row) => ({
      ...row,
      platforms: String(row.platforms || '').split(',').filter(Boolean),
      content_count: Number(row.content_count || 0),
    }));
  }

  touchThread(threadId: string) {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE agent_threads SET updated_at=? WHERE thread_id=?').run(now, threadId);
  }

  updateAutomaticTitle(threadId: string, title: string, source: 'fallback' | 'generated' | 'plan') {
    const value = title.trim().slice(0, 80);
    if (!value) return this.getThread(threadId);
    this.db.prepare(`
      UPDATE agent_threads SET title=?, title_source=?, updated_at=?
      WHERE thread_id=? AND title_locked=0 AND title_source!='manual'
    `).run(value, source, new Date().toISOString(), threadId);
    return this.getThread(threadId);
  }

  renameThread(threadId: string, title: string) {
    const value = title.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!value) throw new Error('任务名称不能为空');
    const result = this.db.prepare(`
      UPDATE agent_threads SET title=?, title_source='manual', title_locked=1, updated_at=? WHERE thread_id=?
    `).run(value, new Date().toISOString(), threadId);
    return result.changes ? this.getThread(threadId) : null;
  }

  setThreadPinned(threadId: string, pinned: boolean) {
    const result = this.db.prepare('UPDATE agent_threads SET pinned_at=? WHERE thread_id=?')
      .run(pinned ? new Date().toISOString() : null, threadId);
    return result.changes ? this.getThread(threadId) : null;
  }

  addMessage(threadId: string, role: AgentRole, kind: string, content: string, metadata: any = {}) {
    const messageId = id();
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO agent_messages (message_id, thread_id, role, kind, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(messageId, threadId, role, kind, content, JSON.stringify(metadata), now);
    this.touchThread(threadId);
    return { message_id: messageId, thread_id: threadId, role, kind, content, metadata, created_at: now };
  }

  deleteMessagePair(threadId: string, messageId: string): { deleted: number; attachment_ids: string[] } | null {
    const rows = this.db.prepare(`
      SELECT rowid, message_id, role, metadata_json
      FROM agent_messages
      WHERE thread_id=?
      ORDER BY created_at ASC, rowid ASC
    `).all(threadId) as Array<{ rowid: number; message_id: string; role: AgentRole; metadata_json: string }>;
    const targetIndex = rows.findIndex((row) => row.message_id === messageId);
    if (targetIndex < 0) return null;

    let startIndex = targetIndex;
    if (rows[targetIndex].role === 'assistant') {
      for (let index = targetIndex - 1; index >= 0; index -= 1) {
        if (rows[index].role === 'user') {
          startIndex = index;
          break;
        }
      }
    }
    let endIndex = rows.length;
    for (let index = startIndex + 1; index < rows.length; index += 1) {
      if (rows[index].role === 'user') {
        endIndex = index;
        break;
      }
    }

    const selected = rows.slice(startIndex, endIndex);
    const messageIds = selected.map((row) => row.message_id);
    const attachmentIds = [...new Set(selected.flatMap((row) => {
      const metadata = parseJson<{ attachments?: Array<{ attachment_id?: string }> }>(row.metadata_json, {});
      return (metadata.attachments || []).map((attachment) => String(attachment.attachment_id || '')).filter(Boolean);
    }))];
    const placeholders = messageIds.map(() => '?').join(',');
    const deleted = this.db.transaction(() => {
      const result = this.db.prepare(`DELETE FROM agent_messages WHERE thread_id=? AND message_id IN (${placeholders})`)
        .run(threadId, ...messageIds);
      this.touchThread(threadId);
      return result.changes;
    })();
    return { deleted, attachment_ids: attachmentIds };
  }

  getMemorySettings(): MemorySettings {
    const row = this.db.prepare('SELECT * FROM agent_memory_settings WHERE id=1').get() as any;
    return {
      enabled: Boolean(row?.enabled),
      autoCapture: Boolean(row?.auto_capture),
      autoRecall: Boolean(row?.auto_recall),
      captureMode: row?.capture_mode === 'conservative' ? 'conservative' : 'balanced',
      recallLimit: Math.max(1, Math.min(20, Number(row?.recall_limit) || 8)),
    };
  }

  updateMemorySettings(input: Partial<MemorySettings>): MemorySettings {
    const current = this.getMemorySettings();
    const next: MemorySettings = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      autoCapture: typeof input.autoCapture === 'boolean' ? input.autoCapture : current.autoCapture,
      autoRecall: typeof input.autoRecall === 'boolean' ? input.autoRecall : current.autoRecall,
      captureMode: input.captureMode === 'conservative' ? 'conservative' : input.captureMode === 'balanced' ? 'balanced' : current.captureMode,
      recallLimit: Math.max(1, Math.min(20, Number(input.recallLimit ?? current.recallLimit) || 8)),
    };
    this.db.prepare(`UPDATE agent_memory_settings SET enabled=?, auto_capture=?, auto_recall=?, capture_mode=?, recall_limit=?, updated_at=? WHERE id=1`)
      .run(Number(next.enabled), Number(next.autoCapture), Number(next.autoRecall), next.captureMode, next.recallLimit, new Date().toISOString());
    return this.getMemorySettings();
  }

  getRuntimeSettings(): RuntimeSettings {
    const row = this.db.prepare('SELECT * FROM agent_runtime_settings WHERE id=1').get() as any;
    return {
      maxConcurrentCrawlers: Math.max(1, Math.min(5, Number(row?.max_concurrent_crawlers) || 3)),
    };
  }

  updateRuntimeSettings(input: Partial<RuntimeSettings>): RuntimeSettings {
    const current = this.getRuntimeSettings();
    const parsed = Number(input.maxConcurrentCrawlers ?? current.maxConcurrentCrawlers);
    const normalized = Number.isFinite(parsed) ? Math.round(parsed) : current.maxConcurrentCrawlers;
    const maxConcurrentCrawlers = Math.max(1, Math.min(5, normalized));
    this.db.prepare('UPDATE agent_runtime_settings SET max_concurrent_crawlers=?, updated_at=? WHERE id=1')
      .run(maxConcurrentCrawlers, new Date().toISOString());
    return this.getRuntimeSettings();
  }

  listMemories(): AgentMemoryRecord[] {
    return this.db.prepare(`SELECT * FROM agent_memories ORDER BY CASE status WHEN 'candidate' THEN 0 ELSE 1 END, importance DESC, updated_at DESC`)
      .all() as AgentMemoryRecord[];
  }

  upsertMemory(input: {
    category: AgentMemoryRecord['category']; memoryKey: string; content: string;
    confidence: number; importance: number; status: AgentMemoryRecord['status'];
    sourceThreadId?: string; sourceMessageId?: string;
  }): AgentMemoryRecord {
    const now = new Date().toISOString();
    const memoryId = id();
    const memoryKey = String(input.memoryKey).trim().slice(0, 120);
    const content = String(input.content).trim().slice(0, 500);
    if (!memoryKey || !content) throw new Error('记忆内容不能为空');
    this.db.prepare(`
      INSERT INTO agent_memories
        (memory_id, category, memory_key, content, confidence, importance, status, source_thread_id, source_message_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_key) DO UPDATE SET
        category=CASE WHEN agent_memories.status='active' AND excluded.status='candidate' THEN agent_memories.category ELSE excluded.category END,
        content=CASE WHEN agent_memories.status='active' AND excluded.status='candidate' THEN agent_memories.content ELSE excluded.content END,
        confidence=CASE WHEN agent_memories.status='active' AND excluded.status='candidate' THEN agent_memories.confidence ELSE excluded.confidence END,
        importance=MAX(agent_memories.importance, excluded.importance),
        status=CASE WHEN agent_memories.status='active' THEN 'active' ELSE excluded.status END,
        source_thread_id=CASE WHEN agent_memories.status='active' AND excluded.status='candidate' THEN agent_memories.source_thread_id ELSE excluded.source_thread_id END,
        source_message_id=CASE WHEN agent_memories.status='active' AND excluded.status='candidate' THEN agent_memories.source_message_id ELSE excluded.source_message_id END,
        updated_at=excluded.updated_at
    `).run(
      memoryId, input.category, memoryKey, content,
      Math.max(0, Math.min(1, input.confidence)), Math.max(0, Math.min(1, input.importance)), input.status,
      input.sourceThreadId || null, input.sourceMessageId || null, now, now,
    );
    return this.db.prepare('SELECT * FROM agent_memories WHERE memory_key=?').get(memoryKey) as AgentMemoryRecord;
  }

  updateMemory(memoryId: string, input: { content?: string; status?: AgentMemoryRecord['status'] }): AgentMemoryRecord | null {
    const existing = this.db.prepare('SELECT * FROM agent_memories WHERE memory_id=?').get(memoryId) as AgentMemoryRecord | undefined;
    if (!existing) return null;
    const content = typeof input.content === 'string' ? input.content.trim().slice(0, 500) : existing.content;
    if (!content) throw new Error('记忆内容不能为空');
    const status = input.status === 'active' || input.status === 'candidate' ? input.status : existing.status;
    this.db.prepare('UPDATE agent_memories SET content=?, status=?, updated_at=? WHERE memory_id=?')
      .run(content, status, new Date().toISOString(), memoryId);
    return this.db.prepare('SELECT * FROM agent_memories WHERE memory_id=?').get(memoryId) as AgentMemoryRecord;
  }

  deleteMemory(memoryId: string): boolean {
    return this.db.prepare('DELETE FROM agent_memories WHERE memory_id=?').run(memoryId).changes > 0;
  }

  deleteMemoryByKey(memoryKey: string): boolean {
    return this.db.prepare('DELETE FROM agent_memories WHERE memory_key=?').run(memoryKey).changes > 0;
  }

  clearMemories(): number {
    return this.db.prepare('DELETE FROM agent_memories').run().changes;
  }

  retrieveMemories(query: string, limit?: number): AgentMemoryRecord[] {
    const settings = this.getMemorySettings();
    if (!settings.enabled || !settings.autoRecall) return [];
    const rows = this.db.prepare(`SELECT * FROM agent_memories WHERE status='active' ORDER BY importance DESC, updated_at DESC LIMIT 200`)
      .all() as AgentMemoryRecord[];
    const normalized = query.toLocaleLowerCase().replace(/\s+/g, '');
    const grams = new Set<string>();
    for (let index = 0; index < normalized.length - 1; index++) grams.add(normalized.slice(index, index + 2));
    const scored = rows.map((row) => {
      const text = `${row.memory_key}${row.content}`.toLocaleLowerCase().replace(/\s+/g, '');
      let overlap = 0;
      for (const gram of grams) if (text.includes(gram)) overlap++;
      const baseline = ['identity', 'preference', 'rule'].includes(row.category) ? 0.18 : 0;
      return { row, score: overlap / Math.max(1, grams.size) + row.importance * 0.35 + baseline };
    }).sort((a, b) => b.score - a.score);
    const selected = scored.slice(0, Math.max(1, Math.min(20, limit || settings.recallLimit))).map(({ row }) => row);
    if (selected.length) {
      const placeholders = selected.map(() => '?').join(',');
      this.db.prepare(`UPDATE agent_memories SET last_used_at=? WHERE memory_id IN (${placeholders})`)
        .run(new Date().toISOString(), ...selected.map((row) => row.memory_id));
    }
    return selected;
  }

  createPlan(threadId: string, plan: ResearchPlan) {
    const planId = id();
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const existing = this.db.prepare(`SELECT * FROM agent_plans WHERE thread_id=? AND status IN ('awaiting_confirmation','queued','running') ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(threadId) as any;
      if (existing) return this.hydratePlan(existing);

      this.db.prepare(`INSERT INTO agent_plans (plan_id, thread_id, goal, status, plan_json, created_at, updated_at) VALUES (?, ?, ?, 'awaiting_confirmation', ?, ?, ?)`)
        .run(planId, threadId, plan.goal, JSON.stringify(plan), now, now);
      const insert = this.db.prepare(`INSERT INTO agent_plan_steps (step_id, plan_id, platform, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)`);
      for (const platform of plan.platforms) insert.run(id(), planId, platform, now, now);
      return this.getPlan(planId);
    });
    return tx();
  }

  updatePendingPlan(planId: string, plan: ResearchPlan) {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const result = this.db.prepare(`UPDATE agent_plans SET goal=?, plan_json=?, updated_at=? WHERE plan_id=? AND status='awaiting_confirmation'`)
        .run(plan.goal, JSON.stringify(plan), now, planId);
      if (result.changes === 0) throw new Error('只有等待确认的计划可以修改');

      this.db.prepare('DELETE FROM agent_plan_steps WHERE plan_id=?').run(planId);
      const insert = this.db.prepare(`INSERT INTO agent_plan_steps (step_id, plan_id, platform, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)`);
      for (const platform of plan.platforms) insert.run(id(), planId, platform, now, now);
      return this.getPlan(planId);
    });
    return tx();
  }

  getLatestPlan(threadId: string) {
    const row = this.db.prepare(`SELECT * FROM agent_plans WHERE thread_id=? AND status!='superseded' ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(threadId) as any;
    return row ? this.hydratePlan(row) : null;
  }

  listPlans(threadId: string) {
    return (this.db.prepare(`SELECT * FROM agent_plans WHERE thread_id=? AND status!='superseded' ORDER BY created_at ASC, rowid ASC`).all(threadId) as any[])
      .map((row, index) => ({ ...this.hydratePlan(row), round_number: index + 1 }));
  }

  getPlan(planId: string) {
    const row = this.db.prepare('SELECT * FROM agent_plans WHERE plan_id=?').get(planId) as any;
    return row ? this.hydratePlan(row) : null;
  }

  private hydratePlan(row: any) {
    const steps = this.db.prepare(`
      SELECT s.*, COALESCE(r.item_count, 0) AS item_count
      FROM agent_plan_steps s
      LEFT JOIN crawl_runs r ON s.run_id = r.run_id
      WHERE s.plan_id=?
      ORDER BY s.created_at
    `).all(row.plan_id);
    const stats = this.getPlanStats(row.plan_id);
    return { ...row, plan: parseJson<ResearchPlan>(row.plan_json, {} as ResearchPlan), steps, stats };
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

  getPlanContents(planId: string, limit = 60, platforms: string[] = []): any[] {
    const selectedPlatforms = platforms.filter(Boolean);
    const platformClause = selectedPlatforms.length
      ? ` AND c.platform IN (${selectedPlatforms.map(() => '?').join(',')})`
      : '';
    return this.db.prepare(`
      SELECT c.platform_label, c.keyword, substr(c.title, 1, 240) AS title,
             substr(c.description, 1, 800) AS description, c.creator_name,
             c.likes, c.saves, c.comments, c.shares, c.views, c.content_url,
             substr(c.source_metadata, 1, 2000) AS source_metadata
      FROM content_records c
      JOIN agent_plan_steps s ON s.run_id=c.run_id
      WHERE s.plan_id=?${platformClause} ORDER BY c.engagement DESC LIMIT ?
    `).all(planId, ...selectedPlatforms, limit) as any[];
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
