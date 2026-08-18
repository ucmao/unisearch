import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { currentAgentRunTrace } from '../agent/AgentToolRegistry';
import { getDb } from '../../database/connection';
import { AnalyticsRepository } from '../../database/repository';
import { exporterRegistry } from '../../exporters/registry';
import { getConnectorManifest, platformLabel } from '../../connectors/registry';
import { skillRegistry } from '../../skills/registry';

export type AgentRole = 'user' | 'assistant' | 'system';

export interface ContentEnrichmentOptions {
  mode: 'snippet' | 'auto' | 'full';
  maxReadItems: number;
  maxPerDomain: number;
  concurrency: number;
  timeoutMsPerUrl: number;
}

export interface QueryExpansionConfig {
  mode: 'strict' | 'fallback' | 'broad';
  maxQueriesPerKeyword: number;
  preserveOriginal: boolean;
}

export interface ResearchPlan {
  skillId?: string;
  goal: string;
  platforms: string[];
  keywords: string[];
  capability?: 'keyword_search' | 'content_detail' | 'creator_profile' | 'comments' | 'url_resolve';
  targets?: string[];
  connectorOptions?: Record<string, Record<string, unknown>>;
  contentEnrichment: ContentEnrichmentOptions;
  queryExpansion?: QueryExpansionConfig;
  /**
   * The only stored representation of "how much to collect". Concrete crawl
   * parameters (item budget, comment toggles, start page) are derived per
   * capability at execution time via resolveDepthPreset + the connector
   * manifest; anything the user overrides explicitly lives in connectorOptions.
   */
  collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom';
  loginType: 'qrcode' | 'none';
  headless: boolean;
  customScopeDescription?: string;
  analysis: string[];
  analysisSource?: 'ai' | 'fallback' | 'user';
  /** Run a report after collection even when no explicit analysis goals exist. */
  autoAnalyze?: boolean;
  outputs: string[];
  incremental?: {
    baseWorkflowId: string;
    since: string;
  };
  healthPolicy?: {
    originalPlatforms: string[];
    selectedPlatforms: string[];
    requiresConfirmation: boolean;
    decisions: Array<{ connectorId: string; action: string; state: string; reason: string; replacementId?: string }>;
  };
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
}

export type ConnectorFailoverPolicy = 'smart' | 'never' | 'always';
export type KeywordExpansionPolicy = 'smart' | 'strict' | 'always';

export interface RuntimeSettings {
  maxConcurrentCrawlers: number;
  connectorFailoverPolicy: ConnectorFailoverPolicy;
  keywordExpansionPolicy: KeywordExpansionPolicy;
}

export interface AgentMemoryRecord {
  memory_id: string;
  category: 'identity' | 'preference' | 'context' | 'rule';
  source: 'automatic' | 'manual';
  content: string;
  created_at: string;
  updated_at: string;
}

export interface AutomaticMemoryMutation {
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
        const interruptedSteps = this.db.prepare(`
          SELECT s.step_id, json_extract(s.output_json, '$.runId') AS run_id
          FROM workflow_steps s
          WHERE s.status='running'
        `).all() as Array<{ step_id: string; run_id: string | null }>;
        for (const step of interruptedSteps) {
          if (step.run_id) this.saveStepCheckpoint(step.step_id, step.run_id, 'interrupted');
        }
        this.db.prepare(`
          UPDATE workflow_runs
          SET status = 'interrupted', updated_at = ?, finished_at = COALESCE(finished_at, ?)
          WHERE status IN ('queued', 'running')
        `).run(now, now);

        this.db.prepare(`
          UPDATE workflow_steps
          SET status = 'queued', error_message = COALESCE(error_message, '服务重启，已保存断点，等待续采')
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

      let analyticsRunsDeleted: number;
      if (deleteAnalyticsData) {
        analyticsRunsDeleted = new AnalyticsRepository(() => this.db).deleteThreads([id], true);
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
      UPDATE agent_threads SET title=?, title_source='manual', title_locked=1 WHERE thread_id=?
    `).run(value, threadId);
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
    if (role === 'assistant' && !metadata.agent_run) {
      const trace = currentAgentRunTrace();
      if (trace) {
        trace.finish(String(metadata.action || kind || 'completed'));
        metadata = { ...metadata, agent_run: trace.snapshot() };
      }
    }
    this.db.prepare(`INSERT INTO agent_messages (message_id, thread_id, role, kind, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(messageId, threadId, role, kind, content, JSON.stringify(metadata), now);
    this.touchThread(threadId);
    return { message_id: messageId, thread_id: threadId, role, kind, content, metadata, created_at: now };
  }

  deleteMessage(messageId: string) {
    this.db.prepare(`DELETE FROM agent_messages WHERE message_id=?`).run(messageId);
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

  deleteAssistantMessageForRegenerate(threadId: string, messageId: string): { userMessage: { content: string; metadata: any } } | null {
    const rows = this.db.prepare(`
      SELECT rowid, message_id, role, content, metadata_json
      FROM agent_messages
      WHERE thread_id=?
      ORDER BY created_at ASC, rowid ASC
    `).all(threadId) as Array<{ rowid: number; message_id: string; role: AgentRole; content: string; metadata_json: string }>;
    const targetIndex = rows.findIndex((row) => row.message_id === messageId);
    if (targetIndex < 0 || rows[targetIndex].role !== 'assistant') return null;

    let userIndex = -1;
    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      if (rows[index].role === 'user') {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return null;

    const toDelete = rows.slice(targetIndex).map((row) => row.message_id);
    const placeholders = toDelete.map(() => '?').join(',');
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM agent_messages WHERE thread_id=? AND message_id IN (${placeholders})`)
        .run(threadId, ...toDelete);
      this.touchThread(threadId);
    })();

    const userRow = rows[userIndex];
    return {
      userMessage: {
        content: userRow.content,
        metadata: parseJson(userRow.metadata_json, {}),
      },
    };
  }

  getMemorySettings(): MemorySettings {
    const row = this.db.prepare('SELECT * FROM agent_memory_settings WHERE id=1').get() as any;
    return {
      enabled: Boolean(row?.enabled ?? 1),
      autoCapture: Boolean(row?.auto_capture ?? 1),
    };
  }

  updateMemorySettings(input: Partial<MemorySettings>): MemorySettings {
    const current = this.getMemorySettings();
    const next: MemorySettings = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      autoCapture: typeof input.autoCapture === 'boolean' ? input.autoCapture : current.autoCapture,
    };
    this.db.prepare(`UPDATE agent_memory_settings SET enabled=?, auto_capture=?, updated_at=? WHERE id=1`)
      .run(Number(next.enabled), Number(next.autoCapture), new Date().toISOString());
    return this.getMemorySettings();
  }

  getRuntimeSettings(): RuntimeSettings {
    const row = this.db.prepare('SELECT * FROM agent_runtime_settings WHERE id=1').get() as any;
    const validFailover = ['smart', 'never', 'always'].includes(row?.connector_failover_policy)
      ? row.connector_failover_policy
      : 'smart';
    const validExpansion = ['smart', 'strict', 'always'].includes(row?.keyword_expansion_policy)
      ? row.keyword_expansion_policy
      : 'smart';
    return {
      maxConcurrentCrawlers: Math.max(1, Math.min(5, Number(row?.max_concurrent_crawlers) || 3)),
      connectorFailoverPolicy: validFailover as ConnectorFailoverPolicy,
      keywordExpansionPolicy: validExpansion as KeywordExpansionPolicy,
    };
  }

  updateRuntimeSettings(input: Partial<RuntimeSettings>): RuntimeSettings {
    const current = this.getRuntimeSettings();
    const parsed = Number(input.maxConcurrentCrawlers ?? current.maxConcurrentCrawlers);
    const normalized = Number.isFinite(parsed) ? Math.round(parsed) : current.maxConcurrentCrawlers;
    const maxConcurrentCrawlers = Math.max(1, Math.min(5, normalized));
    const connectorFailoverPolicy = ['smart', 'never', 'always'].includes(String(input.connectorFailoverPolicy))
      ? input.connectorFailoverPolicy!
      : current.connectorFailoverPolicy;
    const keywordExpansionPolicy = ['smart', 'strict', 'always'].includes(String(input.keywordExpansionPolicy))
      ? input.keywordExpansionPolicy!
      : current.keywordExpansionPolicy;

    this.db.prepare('UPDATE agent_runtime_settings SET max_concurrent_crawlers=?, connector_failover_policy=?, keyword_expansion_policy=?, updated_at=? WHERE id=1')
      .run(maxConcurrentCrawlers, connectorFailoverPolicy, keywordExpansionPolicy, new Date().toISOString());
    return this.getRuntimeSettings();
  }

  listMemories(): AgentMemoryRecord[] {
    const sourceOrder: Record<string, number> = { manual: 0, automatic: 1 };
    const categoryOrder: Record<string, number> = { identity: 1, preference: 2, context: 3, rule: 4 };
    const rows = this.db.prepare(`SELECT * FROM agent_memories ORDER BY created_at DESC`).all() as AgentMemoryRecord[];
    return rows.sort((a, b) => {
      const srcDiff = (sourceOrder[a.source] || 0) - (sourceOrder[b.source] || 0);
      if (srcDiff !== 0) return srcDiff;
      return (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99);
    });
  }

  upsertMemory(input: {
    category: AgentMemoryRecord['category'];
    content: string;
    source?: 'automatic' | 'manual';
    memoryId?: string;
  }): AgentMemoryRecord {
    const categories: AgentMemoryRecord['category'][] = ['identity', 'preference', 'context', 'rule'];
    if (!categories.includes(input.category)) {
      throw new Error(`无效的记忆分类: ${input.category}`);
    }
    const content = String(input.content || '').trim().slice(0, 500);
    if (!content) {
      throw new Error('记忆内容不能为空');
    }
    const source = input.source || 'manual';
    const now = new Date().toISOString();

    if (source === 'automatic') {
      const existing = this.db.prepare(
        "SELECT memory_id FROM agent_memories WHERE source='automatic' AND category=?"
      ).get(input.category) as { memory_id: string } | undefined;

      if (existing) {
        this.db.prepare(`UPDATE agent_memories SET content=?, updated_at=? WHERE memory_id=?`)
          .run(content, now, existing.memory_id);
        return this.db.prepare('SELECT * FROM agent_memories WHERE memory_id=?').get(existing.memory_id) as AgentMemoryRecord;
      } else {
        const memoryId = `auto_${input.category}`;
        this.db.prepare(
          `INSERT INTO agent_memories (memory_id, category, source, content, created_at, updated_at) VALUES (?, ?, 'automatic', ?, ?, ?)`
        ).run(memoryId, input.category, content, now, now);
        return this.db.prepare('SELECT * FROM agent_memories WHERE memory_id=?').get(memoryId) as AgentMemoryRecord;
      }
    } else {
      const memoryId = input.memoryId || `manual_${id()}`;
      this.db.prepare(
        `INSERT INTO agent_memories (memory_id, category, source, content, created_at, updated_at) VALUES (?, ?, 'manual', ?, ?, ?)`
      ).run(memoryId, input.category, content, now, now);
      return this.db.prepare('SELECT * FROM agent_memories WHERE memory_id=?').get(memoryId) as AgentMemoryRecord;
    }
  }

  updateMemory(memoryIdOrCategory: string, input: { content?: string; category?: AgentMemoryRecord['category'] }): AgentMemoryRecord | null {
    const existing = this.db.prepare('SELECT * FROM agent_memories WHERE memory_id=? OR category=?')
      .get(memoryIdOrCategory, memoryIdOrCategory) as AgentMemoryRecord | undefined;
    if (!existing) return null;

    const content = typeof input.content === 'string' ? input.content.trim().slice(0, 500) : existing.content;
    if (!content) throw new Error('记忆内容不能为空');
    const category = input.category || existing.category;

    this.db.prepare(`UPDATE agent_memories SET content=?, category=?, updated_at=? WHERE memory_id=?`)
      .run(content, category, new Date().toISOString(), existing.memory_id);

    return this.db.prepare('SELECT * FROM agent_memories WHERE memory_id=?').get(existing.memory_id) as AgentMemoryRecord;
  }

  deleteMemory(memoryIdOrCategory: string): boolean {
    return this.db.prepare('DELETE FROM agent_memories WHERE memory_id=? OR category=?')
      .run(memoryIdOrCategory, memoryIdOrCategory).changes > 0;
  }

  clearMemories(): number {
    return this.db.prepare('DELETE FROM agent_memories').run().changes;
  }

  retrieveMemories(_query = ''): AgentMemoryRecord[] {
    const settings = this.getMemorySettings();
    if (!settings.enabled) return [];
    return this.listMemories().filter((m) => Boolean(m.content && m.content.trim()));
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
          workflow_id, thread_id, base_workflow_id, incremental_since, skill_id, skill_version, goal, status,
          input_json, output_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_confirmation', ?, '{}', ?, ?)
      `).run(workflowId, threadId, persistedPlan.incremental?.baseWorkflowId || null,
        persistedPlan.incremental?.since || null, skill.id, skill.version, persistedPlan.goal,
        JSON.stringify(persistedPlan), now, now);
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
        dependency_policy, input_json, status, max_attempts, timeout_ms, external_ref, created_at, updated_at
      ) VALUES (?, ?, ?, 'connector', ?, ?, ?, ?, 'queued', 2, 300000, ?, ?, ?)
    `);
    const capability = plan.capability || 'keyword_search';
    const collectStepKeys: string[] = [];
    const webSearchStepKeys: string[] = [];
    const enrichmentStepKeys: string[] = [];
    const searchRewriteStepKeys: string[] = [];
    for (const platform of plan.platforms) {
      const stepKey = `collect:${platform}`;
      collectStepKeys.push(stepKey);
      if (capability === 'keyword_search' && getConnectorManifest(platform)?.category === 'web_search') {
        webSearchStepKeys.push(stepKey);
      }
      insert.run(
        id(), workflowId, stepKey, `connector.${platform}.${capability}`,
        '[]',
        'success',
        JSON.stringify({
          capability,
          keywords: plan.keywords,
          targets: plan.targets || [],
          options: plan.connectorOptions?.[platform] || {},
        }),
        platform, now, now,
      );
      const manifest = getConnectorManifest(platform);
      const supportsDeterministicEnrichment = capability === 'keyword_search'
        && ['social_media', 'job_platform', 'complaint_platform'].includes(String(manifest?.category))
        && manifest?.capabilities.some((item) => item.id === 'content_detail');
      if (supportsDeterministicEnrichment) {
        const qualityStepKey = `quality:${platform}`;
        this.db.prepare(`
          INSERT INTO workflow_steps (
            step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
            dependency_policy, input_json, status, max_attempts, timeout_ms, created_at, updated_at
          ) VALUES (?, ?, ?, 'processor', 'processor.quality.select-enrichment', ?, 'terminal', ?, 'queued', 1, 300000, ?, ?)
        `).run(id(), workflowId, qualityStepKey, JSON.stringify([stepKey]), JSON.stringify({
          sourceStep: stepKey,
          platform,
          minTextChars: 120,
          maxTargets: plan.collectionDepth === 'deep' ? 50 : plan.collectionDepth === 'standard' ? 25 : 10,
          requireComments: ['standard', 'deep'].includes(plan.collectionDepth || 'quick'),
        }), now, now);
        const enrichmentStepKey = `enrich:${platform}`;
        enrichmentStepKeys.push(enrichmentStepKey);
        insert.run(
          id(), workflowId, enrichmentStepKey, `connector.${platform}.content_detail`,
          JSON.stringify([qualityStepKey]), 'success',
          JSON.stringify({
            capability: 'content_detail', keywords: [], targetsFromStep: qualityStepKey,
            role: 'quality_enrichment',
            options: plan.connectorOptions?.[platform] || {},
          }),
          platform, now, now,
        );
      }
    }

    const enableQueryExpansion = plan.queryExpansion?.mode !== 'strict';
    if (webSearchStepKeys.length && enableQueryExpansion) {
      this.db.prepare(`
        INSERT INTO workflow_steps (
          step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
          dependency_policy, input_json, status, max_attempts, timeout_ms, created_at, updated_at
        ) VALUES (?, ?, 'evaluate-search-initial', 'processor', 'processor.search.relevance',
          ?, 'terminal', ?, 'queued', 1, 300000, ?, ?)
      `).run(id(), workflowId, JSON.stringify(webSearchStepKeys), JSON.stringify({ phase: 'initial', stepKeys: webSearchStepKeys }), now, now);
      for (const platform of plan.platforms.filter((item) => webSearchStepKeys.includes(`collect:${item}`))) {
        const rewriteStepKey = `rewrite:${platform}`;
        searchRewriteStepKeys.push(rewriteStepKey);
        insert.run(
          id(), workflowId, rewriteStepKey, `connector.${platform}.keyword_search`,
          '["evaluate-search-initial"]', 'success',
          JSON.stringify({
            capability: 'keyword_search', keywordsFromStep: 'evaluate-search-initial', keywordProvider: platform,
            role: 'automatic_query_rewrite', options: plan.connectorOptions?.[platform] || {},
          }),
          platform, now, now,
        );
      }
      this.db.prepare(`
        INSERT INTO workflow_steps (
          step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
          dependency_policy, input_json, status, max_attempts, timeout_ms, created_at, updated_at
        ) VALUES (?, ?, 'evaluate-search-rewrite', 'processor', 'processor.search.relevance',
          ?, 'terminal', ?, 'queued', 1, 300000, ?, ?)
      `).run(id(), workflowId, JSON.stringify(searchRewriteStepKeys),
        JSON.stringify({ phase: 'rewrite', stepKeys: searchRewriteStepKeys }), now, now);
    }

    let readerStepKey: string | null = null;
    if (webSearchStepKeys.length && plan.contentEnrichment.mode !== 'snippet') {
      const selectorStepKey = 'select-search-urls';
      const selectorDependsOn = searchRewriteStepKeys.length
        ? ['evaluate-search-rewrite']
        : webSearchStepKeys;
      this.db.prepare(`
        INSERT INTO workflow_steps (
          step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
          dependency_policy, input_json, status, max_attempts, timeout_ms,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'processor', 'processor.search-results.select',
          ?, 'terminal', ?, 'queued', 2, 300000, ?, ?)
      `).run(
        id(), workflowId, selectorStepKey, JSON.stringify(selectorDependsOn),
        JSON.stringify(plan.contentEnrichment), now, now,
      );
      readerStepKey = 'read:web_reader';
      insert.run(
        id(), workflowId, readerStepKey, 'connector.web_reader.content_detail',
        JSON.stringify([selectorStepKey]),
        'success',
        JSON.stringify({
          capability: 'content_detail',
          keywords: [],
          targetsFromStep: selectorStepKey,
          options: {
            ...(plan.connectorOptions?.web_reader || {}),
            timeout_ms_per_url: plan.contentEnrichment.timeoutMsPerUrl,
            concurrency: plan.contentEnrichment.concurrency,
          },
        }),
        'web_reader', now, now,
      );
    }

    const finalDependencies = [...collectStepKeys, ...enrichmentStepKeys, ...searchRewriteStepKeys,
      ...(searchRewriteStepKeys.length ? ['evaluate-search-rewrite'] : []), ...(readerStepKey ? [readerStepKey] : [])];
    this.db.prepare(`
      INSERT INTO workflow_steps (
        step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
        dependency_policy, input_json, status, max_attempts, timeout_ms, created_at, updated_at
      ) VALUES (?, ?, 'quality-final', 'processor', 'processor.quality.final',
        ?, 'terminal', ?, 'queued', 1, 300000, ?, ?)
    `).run(id(), workflowId, JSON.stringify(finalDependencies), JSON.stringify({
      requireComments: ['standard', 'deep'].includes(plan.collectionDepth || 'quick'),
    }), now, now);
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
      JSON.stringify(['quality-final']),
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
    const shouldAutoAnalyze = Boolean(
      skill.execution.autoAnalyzeOnCompletion || plan.autoAnalyze || plan.analysis?.length,
    );
    if (shouldAutoAnalyze) {
      this.db.prepare(`
        INSERT INTO workflow_steps (
          step_id, workflow_id, step_key, kind, uses_id, depends_on_json,
          dependency_policy, input_json, status, max_attempts, timeout_ms,
          created_at, updated_at
        ) VALUES (?, ?, 'profile-dataset', 'analyzer', 'analyzer.dataset.profile',
          '["index-documents"]', 'success', ?, 'queued', 2, 300000, ?, ?)
      `).run(id(), workflowId, JSON.stringify({ goals: plan.analysis }), now, now);
      previousStep = 'profile-dataset';
    }
    if (shouldAutoAnalyze) {
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

  createIncrementalPlan(baseWorkflowId: string) {
    const base = this.getPlan(baseWorkflowId);
    if (!base) throw new Error('基线任务不存在');
    if (!['completed', 'partially_completed'].includes(base.status)) throw new Error('只有已完成的任务可以创建增量任务');
    if (!base.thread_id) throw new Error('基线任务没有所属任务');
    const active = this.db.prepare(`SELECT workflow_id FROM workflow_runs
      WHERE thread_id=? AND status IN ('awaiting_confirmation','queued','running') LIMIT 1`).get(base.thread_id) as any;
    if (active) throw new Error('该任务已有待确认或执行中的计划，请完成后再创建增量任务');
    const since = String(base.finished_at || base.updated_at || base.created_at);
    return this.createPlan(base.thread_id, {
      ...base.plan,
      goal: `${String(base.goal || base.plan.goal).replace(/（增量更新.*$/, '')}（增量更新：${since.slice(0, 10)} 之后）`,
      incremental: { baseWorkflowId, since },
    });
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
      SELECT s.*,
             MAX(COALESCE(r.item_count, 0), COALESCE(cp.collected_item_count, 0)) AS item_count,
             MAX(COALESCE(r.comment_count, 0), COALESCE(cp.collected_comment_count, 0)) AS comment_count
      FROM workflow_steps s
      LEFT JOIN crawl_runs r
        ON r.run_id=json_extract(s.output_json, '$.runId')
      LEFT JOIN workflow_step_checkpoints cp
        ON cp.step_id=s.step_id
      WHERE s.workflow_id=? AND s.kind='connector'
      ORDER BY s.created_at
    `).all(row.workflow_id) as any[]).map((step) => ({
      ...step,
      platform: step.external_ref,
      run_id: parseJson<any>(step.output_json, {}).runId || null,
      input: parseJson<Record<string, unknown>>(step.input_json, {}),
      role: parseJson<Record<string, unknown>>(step.input_json, {}).role || 'primary_collection',
      depends_on: parseJson<string[]>(step.depends_on_json, []),
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
    if (runId && ['completed', 'failed', 'cancelled', 'stopped', 'partial'].includes(status)) {
      this.saveStepCheckpoint(stepId, runId, status);
    }
  }

  saveStepCheckpoint(stepId: string, runId: string, status: string): void {
    const step = this.db.prepare('SELECT workflow_id FROM workflow_steps WHERE step_id=?').get(stepId) as any;
    const run = this.db.prepare('SELECT item_count, comment_count, config_json FROM crawl_runs WHERE run_id=?').get(runId) as any;
    if (!step || !run) return;
    const config = parseJson<Record<string, any>>(run.config_json, {});
    const previous = this.db.prepare('SELECT * FROM workflow_step_checkpoints WHERE step_id=?').get(stepId) as any;
    const checkpoint = parseJson<Record<string, any>>(previous?.checkpoint_json || '{}', {});
    const runIds = [...new Set([...(Array.isArray(checkpoint.runIds) ? checkpoint.runIds.map(String) : []), runId])];
    const liveCounts = this.db.prepare(`SELECT
      COUNT(DISTINCT CASE WHEN d.kind!='comment' THEN d.document_id END) AS item_count,
      COUNT(DISTINCT CASE WHEN d.kind='comment' THEN d.document_id END) AS comment_count
      FROM document_sources s JOIN documents d ON d.document_id=s.document_id WHERE s.run_id=?`).get(runId) as any;
    const itemCount = Math.max(Number(run.item_count || 0), Number(liveCounts?.item_count || 0));
    const commentCount = Math.max(Number(run.comment_count || 0), Number(liveCounts?.comment_count || 0));
    const startPage = Math.max(1, Number(config.start_page || 1));
    const pageSize: Record<string, number> = {
      arxiv: 25, github_repositories: 30, aihot: 100,
      boss: 20, zhaopin: 20, job51: 20, liepin: 20,
      baidu: 10, bing: 10, so360: 10, sogou: 10, toutiao: 10, quark: 10, chinaso: 10,
    };
    const size = pageSize[String(config.platform || '')] || 0;
    const nextPage = size ? startPage + Math.floor(itemCount / size) : startPage;
    const collectedItems = Number(previous?.collected_item_count || 0) + itemCount;
    const collectedComments = Number(previous?.collected_comment_count || 0) + commentCount;
    this.db.prepare(`INSERT INTO workflow_step_checkpoints
      (step_id, workflow_id, last_run_id, resume_count, collected_item_count, collected_comment_count,
       next_page, remaining_targets_json, checkpoint_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
      ON CONFLICT(step_id) DO UPDATE SET
        last_run_id=excluded.last_run_id,
        collected_item_count=excluded.collected_item_count,
        collected_comment_count=excluded.collected_comment_count,
        next_page=MAX(workflow_step_checkpoints.next_page, excluded.next_page),
        checkpoint_json=excluded.checkpoint_json,
        updated_at=excluded.updated_at`)
      .run(stepId, step.workflow_id, runId, Number(previous?.resume_count || 0), collectedItems, collectedComments,
        nextPage, JSON.stringify({ runIds, lastStatus: status, lastConfig: config }), new Date().toISOString());
  }

  getStepCheckpoint(stepId: string): any | null {
    const row = this.db.prepare('SELECT * FROM workflow_step_checkpoints WHERE step_id=?').get(stepId) as any;
    if (!row) return null;
    return {
      stepId: row.step_id,
      workflowId: row.workflow_id,
      lastRunId: row.last_run_id,
      resumeCount: Number(row.resume_count || 0),
      collectedItemCount: Number(row.collected_item_count || 0),
      collectedCommentCount: Number(row.collected_comment_count || 0),
      nextPage: Number(row.next_page || 1),
      remainingTargets: parseJson<string[]>(row.remaining_targets_json, []),
      details: parseJson<Record<string, unknown>>(row.checkpoint_json, {}),
      updatedAt: row.updated_at,
    };
  }

  markStepResumed(stepId: string): void {
    this.db.prepare(`UPDATE workflow_step_checkpoints
      SET resume_count=resume_count+1, updated_at=? WHERE step_id=?`)
      .run(new Date().toISOString(), stepId);
  }

  isStepReady(workflowId: string, stepKey: string): boolean {
    const steps = this.db.prepare(`
      SELECT step_key, status, depends_on_json, dependency_policy
      FROM workflow_steps WHERE workflow_id=?
    `).all(workflowId) as any[];
    const target = steps.find((step) => step.step_key === stepKey);
    if (!target || target.status !== 'queued') return false;
    const statusByKey = new Map(steps.map((step) => [step.step_key, step.status]));
    const accepted = target.dependency_policy === 'terminal'
      ? ['completed', 'skipped', 'failed', 'cancelled']
      : ['completed', 'skipped'];
    return parseJson<string[]>(target.depends_on_json, [])
      .every((dependency) => accepted.includes(String(statusByKey.get(dependency))));
  }

  getStepOutput(workflowId: string, stepKey: string): Record<string, unknown> {
    const row = this.db.prepare(`
      SELECT output_json FROM workflow_steps WHERE workflow_id=? AND step_key=?
    `).get(workflowId, stepKey) as any;
    return parseJson<Record<string, unknown>>(row?.output_json || '{}', {});
  }

  selectSearchUrls(
    workflowId: string,
    options: { maxReadItems: number; maxPerDomain: number },
  ): Array<{ url: string; providers: string[]; bestRank: number; title: string }> {
    const rows = this.db.prepare(`
      SELECT d.source_url, d.provider, d.rank, d.title
      FROM search_discoveries d
      JOIN crawl_runs r ON r.run_id=d.run_id
      WHERE r.workflow_id=?
      ORDER BY COALESCE(d.rank, 2147483647), d.fetched_at DESC
    `).all(workflowId) as Array<{ source_url: string; provider: string; rank: number | null; title: string }>;

    const normalize = (value: string): string | null => {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
          if (/^(?:utm_.+|spm|from|source|ref|referrer|tracking_id)$/i.test(key)) url.searchParams.delete(key);
        }
        return url.toString();
      } catch { return null; }
    };
    const grouped = new Map<string, { url: string; providers: Set<string>; bestRank: number; title: string }>();
    for (const row of rows) {
      const url = normalize(row.source_url);
      if (!url || /\.(?:pdf|zip|rar|7z|jpe?g|png|gif|webp|mp4|mp3)(?:$|\?)/i.test(url)) continue;
      const current = grouped.get(url) || {
        url, providers: new Set<string>(), bestRank: Number.MAX_SAFE_INTEGER, title: row.title,
      };
      current.providers.add(row.provider);
      if (row.rank !== null) current.bestRank = Math.min(current.bestRank, row.rank);
      if (!current.title) current.title = row.title;
      grouped.set(url, current);
    }
    const perDomain = new Map<string, number>();
    return [...grouped.values()]
      .sort((left, right) => right.providers.size - left.providers.size || left.bestRank - right.bestRank)
      .filter((item) => {
        const domain = new URL(item.url).hostname.toLowerCase();
        const count = perDomain.get(domain) || 0;
        if (count >= options.maxPerDomain) return false;
        perDomain.set(domain, count + 1);
        return true;
      })
      .slice(0, options.maxReadItems)
      .map((item) => ({
        url: item.url,
        providers: [...item.providers],
        bestRank: item.bestRank === Number.MAX_SAFE_INTEGER ? 0 : item.bestRank,
        title: item.title,
      }));
  }

  getCrawlRun(runId: string): any {
    return this.db.prepare('SELECT * FROM crawl_runs WHERE run_id=?').get(runId);
  }

  getPlanContents(workflowId: string, limit = 100, platforms: string[] = []): any[] {
    const analytics = new AnalyticsRepository(this.databaseProvider);
    const result = analytics.queryDocuments({ workflow_id: workflowId, page: 1, page_size: limit });
    return platforms.length ? result.items.filter((item) => platforms.includes(item.platform)) : result.items;
  }

  getThreadContents(threadId: string, limit = 100, platforms: string[] = []): any[] {
    const analytics = new AnalyticsRepository(this.databaseProvider);
    const result = analytics.queryDocuments({ thread_id: threadId, page: 1, page_size: limit });
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

  getThreadStats(threadId: string): { content_count: number; by_platform: Array<{ platform: string; platform_label: string; count: number }> } {
    const rows = new AnalyticsRepository(this.databaseProvider)
      .queryDocuments({ thread_id: threadId, page: 1, page_size: 1000000 }).items;
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

}

export const agentRepository = new AgentRepository();
