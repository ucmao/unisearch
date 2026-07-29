import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../../database/connection';
import { AnalyticsRepository } from '../../database/repository';
import { exporterRegistry } from '../../exporters/registry';
import { platformLabel } from '../../connectors/registry';
import { skillRegistry } from '../../skills/registry';

export type AgentRole = 'user' | 'assistant' | 'system';

export interface ResearchPlan {
  skillId?: string;
  goal: string;
  platforms: string[];
  keywords: string[];
  capability?: 'keyword_search' | 'content_detail' | 'creator_profile' | 'comments' | 'url_resolve';
  targets?: string[];
  connectorOptions?: Record<string, Record<string, unknown>>;
  /**
   * The only stored representation of "how much to collect". Concrete crawl
   * parameters (item budget, comment toggles, start page) are derived per
   * capability at execution time via resolveDepthPreset + the connector
   * manifest; anything the user overrides explicitly lives in connectorOptions.
   */
  collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom';
  loginType: 'qrcode' | 'cookie' | 'none';
  headless: boolean;
  customScopeDescription?: string;
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
  status: 'active' | 'candidate' | 'superseded';
  source_thread_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface AutomaticMemorySummary {
  category: AgentMemoryRecord['category'];
  content: string;
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
        (SELECT status FROM workflow_runs w WHERE w.thread_id=t.thread_id ORDER BY w.created_at DESC LIMIT 1) AS plan_status,
        (SELECT COALESCE(SUM(item_count), 0) FROM crawl_runs r WHERE r.thread_id=t.thread_id) AS total_items
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

  reconcileStuckTasks() {
    try {
      this.db.transaction(() => {
        const now = new Date().toISOString();
        this.db.prepare(`
          UPDATE workflow_runs
          SET status = 'interrupted', updated_at = ?, finished_at = COALESCE(finished_at, ?)
          WHERE status IN ('queued', 'running')
        `).run(now, now);

        this.db.prepare(`
          UPDATE workflow_steps
          SET status = 'failed', error_message = COALESCE(error_message, '服务重启或采集中断')
          WHERE status = 'running'
        `).run();

        this.db.prepare(`
          UPDATE crawl_runs
          SET status = 'failed', error_message = COALESCE(error_message, '服务重启或采集中断'), finished_at = COALESCE(finished_at, ?)
          WHERE status IN ('queued', 'running')
        `).run(now);
      })();
    } catch (e) {
      console.error('[AgentRepository] reconcileStuckTasks failed:', e);
    }
  }

  deleteThread(threadId: string, deleteAnalyticsData = true): { deleted: number; analytics_runs_deleted: number } {
    const id = String(threadId || '').trim();
    if (!id) return { deleted: 0, analytics_runs_deleted: 0 };

    return this.db.transaction(() => {
      const active = this.db.prepare(`
        SELECT 1 FROM workflow_runs
        WHERE thread_id=? AND status IN ('queued','running','waiting_for_user')
        LIMIT 1
      `).get(id);
      if (active) throw new Error('任务仍在运行，请先停止后再删除');

      const runningCrawl = Number((this.db.prepare(
        "SELECT COUNT(*) AS count FROM crawl_runs WHERE thread_id=? AND status='running'",
      ).get(id) as any)?.count || 0);
      if (runningCrawl) throw new Error('任务仍在运行，请先停止后再删除');

      let analyticsRunsDeleted = 0;
      if (deleteAnalyticsData) {
        analyticsRunsDeleted = this.db.prepare('DELETE FROM crawl_runs WHERE thread_id=?').run(id).changes;
      } else {
        analyticsRunsDeleted = Number((this.db.prepare(
          'SELECT COUNT(*) AS count FROM crawl_runs WHERE thread_id=?',
        ).get(id) as any)?.count || 0);
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
      SELECT w.workflow_id AS plan_id, w.goal, w.status, w.updated_at,
             GROUP_CONCAT(DISTINCT s.external_ref) AS platforms,
             COUNT(DISTINCT ds.document_id) AS content_count
      FROM workflow_runs w
      LEFT JOIN workflow_steps s ON s.workflow_id=w.workflow_id AND s.kind='connector'
      LEFT JOIN crawl_runs r ON r.workflow_id=w.workflow_id
      LEFT JOIN document_sources ds ON ds.run_id=r.run_id
      WHERE w.status IN ('completed', 'partially_completed')
      GROUP BY w.workflow_id
      ORDER BY w.updated_at DESC
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
    return this.db.prepare(`SELECT * FROM agent_memories WHERE status != 'superseded' ORDER BY CASE WHEN memory_key LIKE 'user_manual_%' THEN 0 ELSE 1 END, CASE status WHEN 'candidate' THEN 0 ELSE 1 END, updated_at DESC`)
      .all() as AgentMemoryRecord[];
  }

  upsertMemory(input: {
    category: AgentMemoryRecord['category'];
    memoryKey: string;
    content: string;
    confidence: number;
    importance: number;
    status: AgentMemoryRecord['status'];
    sourceThreadId?: string;
    sourceMessageId?: string;
  }): AgentMemoryRecord {
    const now = new Date().toISOString();
    const memoryId = id();
    const memoryKey = String(input.memoryKey).trim().slice(0, 120);
    const content = String(input.content).trim().slice(0, 500);
    if (!memoryKey || !content) throw new Error('记忆内容不能为空');

    const existing = this.db.prepare('SELECT * FROM agent_memories WHERE memory_key=?')
      .get(memoryKey) as AgentMemoryRecord | undefined;
    if (existing?.memory_key.startsWith('user_manual_')) return existing;

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

  updateMemory(memoryId: string, input: {
    content?: string;
    status?: AgentMemoryRecord['status'];
  }): AgentMemoryRecord | null {
    const existing = this.db.prepare('SELECT * FROM agent_memories WHERE memory_id=?').get(memoryId) as AgentMemoryRecord | undefined;
    if (!existing) return null;

    const content = typeof input.content === 'string' ? input.content.trim().slice(0, 500) : existing.content;
    if (!content) throw new Error('记忆内容不能为空');

    const status = ['active', 'candidate', 'superseded'].includes(String(input.status))
      ? (input.status as AgentMemoryRecord['status'])
      : existing.status;
    const userEditedAutomaticMemory = typeof input.content === 'string' && !existing.memory_key.startsWith('user_manual_');
    const memoryKey = userEditedAutomaticMemory ? `user_manual_${id()}` : existing.memory_key;
    this.db.prepare(`
      UPDATE agent_memories
      SET memory_key=?, content=?, confidence=?, importance=?, status=?, source_thread_id=?, source_message_id=?, updated_at=?
      WHERE memory_id=?
    `).run(
      memoryKey,
      content,
      userEditedAutomaticMemory ? 1 : existing.confidence,
      userEditedAutomaticMemory ? 1 : existing.importance,
      userEditedAutomaticMemory ? 'active' : status,
      userEditedAutomaticMemory ? null : existing.source_thread_id,
      userEditedAutomaticMemory ? null : existing.source_message_id,
      new Date().toISOString(),
      memoryId,
    );
    return this.db.prepare('SELECT * FROM agent_memories WHERE memory_id=?').get(memoryId) as AgentMemoryRecord;
  }

  listAutomaticMemories(): AgentMemoryRecord[] {
    return this.db.prepare(`
      SELECT * FROM agent_memories
      WHERE status='active' AND memory_key NOT LIKE 'user_manual_%'
      ORDER BY updated_at ASC
    `).all() as AgentMemoryRecord[];
  }

  replaceAutomaticMemorySummaries(summaries: AutomaticMemorySummary[]): AgentMemoryRecord[] {
    const categories: AgentMemoryRecord['category'][] = ['identity', 'preference', 'context', 'rule'];
    const normalized = new Map<AgentMemoryRecord['category'], string>();
    for (const summary of summaries) {
      if (!categories.includes(summary.category)) continue;
      normalized.set(summary.category, String(summary.content || '').trim().slice(0, 500));
    }

    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM agent_memories WHERE memory_key NOT LIKE 'user_manual_%'`).run();
      for (const category of categories) {
        const content = normalized.get(category);
        if (!content) continue;
        this.upsertMemory({
          category,
          memoryKey: `auto_summary_${category}`,
          content,
          confidence: 1,
          importance: 0.8,
          status: 'active',
        });
      }
    })();
    return this.listAutomaticMemories();
  }

  deleteMemory(memoryId: string): boolean {
    return this.db.prepare('DELETE FROM agent_memories WHERE memory_id=?').run(memoryId).changes > 0;
  }

  clearMemories(): number {
    return this.db.prepare('DELETE FROM agent_memories').run().changes;
  }

  retrieveMemories(_query = '', limit?: number): AgentMemoryRecord[] {
    const settings = this.getMemorySettings();
    if (!settings.enabled || !settings.autoRecall) return [];

    const recallLimit = Math.max(1, Math.min(20, limit || settings.recallLimit));
    const selected = this.db.prepare(`
      SELECT * FROM agent_memories
      WHERE status='active'
      ORDER BY CASE WHEN memory_key LIKE 'user_manual_%' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT ?
    `).all(recallLimit) as AgentMemoryRecord[];

    if (selected.length) {
      const placeholders = selected.map(() => '?').join(',');
      this.db.prepare(`UPDATE agent_memories SET last_used_at=? WHERE memory_id IN (${placeholders})`)
        .run(new Date().toISOString(), ...selected.map((row) => row.memory_id));
    }
    return selected;
  }

  createPlan(threadId: string, plan: ResearchPlan) {
    const workflowId = id();
    const now = new Date().toISOString();
    const skill = skillRegistry.find(plan.skillId) || skillRegistry.get('multi-source-research');
    const persistedPlan = { ...plan, skillId: skill.id };
    const tx = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT * FROM workflow_runs
        WHERE thread_id=? AND status IN ('awaiting_confirmation','queued','running')
        ORDER BY created_at DESC, rowid DESC LIMIT 1
      `).get(threadId) as any;
      if (existing) return this.hydratePlan(existing);

      this.db.prepare(`
        INSERT INTO workflow_runs (
          workflow_id, thread_id, skill_id, skill_version, goal, status,
          input_json, output_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'awaiting_confirmation', ?, '{}', ?, ?)
      `).run(workflowId, threadId, skill.id, skill.version, persistedPlan.goal, JSON.stringify(persistedPlan), now, now);
      this.insertConnectorSteps(workflowId, persistedPlan, now);
      return this.getPlan(workflowId);
    });
    return tx();
  }

  private insertConnectorSteps(workflowId: string, plan: ResearchPlan, now: string): void {
    const skill = skillRegistry.find(plan.skillId) || skillRegistry.get('multi-source-research');
    const insert = this.db.prepare(`
      INSERT INTO workflow_steps (
        step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
        input_json, status, max_attempts, timeout_ms, external_ref, created_at, updated_at
      ) VALUES (?, ?, ?, 'connector', ?, '[]', ?, 'queued', 2, 300000, ?, ?, ?)
    `);
    const capability = plan.capability || 'keyword_search';
    for (const platform of plan.platforms) {
      insert.run(
        id(), workflowId, `collect:${platform}`, `connector.${platform}.${capability}`,
        JSON.stringify({
          keywords: plan.keywords,
          targets: plan.targets || [],
          options: plan.connectorOptions?.[platform] || {},
        }),
        platform, now, now,
      );
    }
    this.db.prepare(`
      INSERT INTO workflow_steps (
        step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
        dependency_policy, input_json, status, max_attempts, timeout_ms,
        created_at, updated_at
      ) VALUES (?, ?, 'finalize-documents', 'processor', 'processor.documents.finalize',
        ?, 'terminal', ?, 'queued', 2, 300000, ?, ?)
    `).run(
      id(),
      workflowId,
      JSON.stringify(plan.platforms.map((platform) => `collect:${platform}`)),
      JSON.stringify({ processorIds: ['metadata.normalize', 'document.clean_markdown'] }),
      now,
      now,
    );
    this.db.prepare(`
      INSERT INTO workflow_steps (
        step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
        dependency_policy, input_json, status, max_attempts, timeout_ms,
        created_at, updated_at
      ) VALUES (?, ?, 'index-documents', 'analyzer', 'analyzer.knowledge.index',
        '["finalize-documents"]', 'success', '{}', 'queued', 2, 300000, ?, ?)
    `).run(id(), workflowId, now, now);
    let previousStep = 'index-documents';
    if (plan.analysis?.length) {
      this.db.prepare(`
        INSERT INTO workflow_steps (
          step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
          dependency_policy, input_json, status, max_attempts, timeout_ms,
          created_at, updated_at
        ) VALUES (?, ?, 'analyze-results', 'analyzer', 'analyzer.extractive.summary',
          '["index-documents"]', 'success', ?, 'queued', 2, 300000, ?, ?)
      `).run(id(), workflowId, JSON.stringify({ goals: plan.analysis }), now, now);
      previousStep = 'analyze-results';
    }
    if (skill.execution.autoAnalyzeOnCompletion || plan.analysis?.length) {
      this.db.prepare(`
        INSERT INTO workflow_steps (
          step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
          dependency_policy, input_json, status, max_attempts, timeout_ms,
          created_at, updated_at
        ) VALUES (?, ?, 'business-analysis', 'analyzer', 'analyzer.business.insight',
          ?, 'success', '{}', 'queued', 1, 300000, ?, ?)
      `).run(id(), workflowId, JSON.stringify([previousStep]), now, now);
      previousStep = 'business-analysis';
    }
    const supportedExporters = new Set(exporterRegistry.list().map((e) => e.id));
    for (const exporter of (plan.outputs || []).filter((output) => supportedExporters.has(output))) {
      this.db.prepare(`
        INSERT INTO workflow_steps (
          step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
          dependency_policy, input_json, status, max_attempts, timeout_ms,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'exporter', ?, ?, 'success', '{}', 'queued', 2, 300000, ?, ?)
      `).run(
        id(),
        workflowId,
        `export:${exporter}`,
        `exporter.${exporter}`,
        JSON.stringify([previousStep]),
        now,
        now,
      );
    }
  }

  updatePendingPlan(workflowId: string, plan: ResearchPlan) {
    const now = new Date().toISOString();
    const skill = skillRegistry.find(plan.skillId) || skillRegistry.get('multi-source-research');
    const persistedPlan = { ...plan, skillId: skill.id };
    const tx = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE workflow_runs SET skill_id=?, skill_version=?, goal=?, input_json=?, updated_at=?
        WHERE workflow_id=? AND status='awaiting_confirmation'
      `).run(skill.id, skill.version, persistedPlan.goal, JSON.stringify(persistedPlan), now, workflowId);
      if (result.changes === 0) throw new Error('只有等待确认的计划可以修改');

      this.db.prepare('DELETE FROM workflow_steps WHERE workflow_id=?').run(workflowId);
      this.insertConnectorSteps(workflowId, persistedPlan, now);
      return this.getPlan(workflowId);
    });
    return tx();
  }

  getLatestPlan(threadId: string) {
    const row = this.db.prepare(`
      SELECT * FROM workflow_runs WHERE thread_id=?
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(threadId) as any;
    return row ? this.hydratePlan(row) : null;
  }

  listPlans(threadId: string) {
    return (this.db.prepare(`
      SELECT * FROM workflow_runs WHERE thread_id=? ORDER BY created_at ASC, rowid ASC
    `).all(threadId) as any[])
      .map((row, index) => ({ ...this.hydratePlan(row), round_number: index + 1 }));
  }

  getPlan(workflowId: string) {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE workflow_id=?').get(workflowId) as any;
    return row ? this.hydratePlan(row) : null;
  }

  private hydratePlan(row: any) {
    const steps = (this.db.prepare(`
      SELECT s.*, COALESCE(r.item_count, 0) AS item_count, COALESCE(r.comment_count, 0) AS comment_count
      FROM workflow_steps s
      LEFT JOIN crawl_runs r
        ON r.run_id=json_extract(s.output_json, '$.runId')
      WHERE s.workflow_id=? AND s.kind='connector'
      ORDER BY s.created_at
    `).all(row.workflow_id) as any[]).map((step) => ({
      ...step,
      platform: step.external_ref,
      run_id: parseJson<any>(step.output_json, {}).runId || null,
    }));
    const stats = this.getPlanStats(row.workflow_id);
    const plan = parseJson<ResearchPlan>(row.input_json, {} as ResearchPlan);
    if (!plan.skillId) plan.skillId = row.skill_id || 'multi-source-research';
    return {
      ...row,
      plan_id: row.workflow_id,
      plan,
      steps,
      stats,
    };
  }

  listActivePlans(): any[] {
    return (this.db.prepare(`
      SELECT * FROM workflow_runs WHERE status IN ('queued','running') ORDER BY created_at
    `).all() as any[])
      .map((row) => this.hydratePlan(row));
  }

  updatePlanStatus(workflowId: string, status: string) {
    const now = new Date().toISOString();
    const terminal = ['completed', 'partially_completed', 'failed', 'stopped', 'cancelled'].includes(status);
    this.db.prepare(`
      UPDATE workflow_runs SET status=?, updated_at=?,
        started_at=CASE WHEN ?='running' THEN COALESCE(started_at, ?) ELSE started_at END,
        finished_at=CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END
      WHERE workflow_id=?
    `).run(status, now, status, now, terminal ? 1 : 0, now, workflowId);
  }

  updateStep(stepId: string, status: string, runId?: string | null, errorMessage?: string | null) {
    const current = this.db.prepare('SELECT output_json FROM workflow_steps WHERE step_id=?').get(stepId) as any;
    const output = parseJson<Record<string, unknown>>(current?.output_json || '{}', {});
    if (runId) output.runId = runId;
    this.db.prepare(`
      UPDATE workflow_steps SET status=?, output_json=?, error_message=?, updated_at=? WHERE step_id=?
    `).run(status === 'stopped' ? 'cancelled' : status, JSON.stringify(output), errorMessage || null, new Date().toISOString(), stepId);
  }

  getCrawlRun(runId: string): any {
    return this.db.prepare('SELECT * FROM crawl_runs WHERE run_id=?').get(runId);
  }

  getPlanContents(workflowId: string, limit = 100, platforms: string[] = []): any[] {
    const analytics = new AnalyticsRepository(this.databaseProvider);
    const result = analytics.queryDocuments({ workflow_id: workflowId, page: 1, page_size: limit });
    return platforms.length ? result.items.filter((item) => platforms.includes(item.platform)) : result.items;
  }

  getPlanStats(workflowId: string): { content_count: number; by_platform: Array<{ platform: string; platform_label: string; count: number }> } {
    const rows = new AnalyticsRepository(this.databaseProvider)
      .queryDocuments({ workflow_id: workflowId, page: 1, page_size: 1000000 }).items;
    const counts = new Map<string, { platform: string; platform_label: string; count: number }>();
    for (const row of rows) {
      const current = counts.get(row.platform) || {
        platform: row.platform,
        platform_label: platformLabel(row.platform),
        count: 0,
      };
      current.count++;
      counts.set(row.platform, current);
    }
    return { content_count: rows.length, by_platform: [...counts.values()].sort((a, b) => b.count - a.count) };
  }

  getPlanExportContents(workflowId: string): any[] {
    return new AnalyticsRepository(this.databaseProvider)
      .queryDocuments({ workflow_id: workflowId, page: 1, page_size: 1000000 }).items;
  }
}

export const agentRepository = new AgentRepository();
