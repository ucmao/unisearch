import fs from 'fs';
import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb, getDatabasePath } from './connection';
import { platformLabel } from '../connectors/registry';
import { canonicalDocumentSchema, type CanonicalDocument } from '../core/documents/canonical';
import { ConnectorHealthService } from '../connectors/health-service';

export interface RunConfig {
  platform: string;
  keywords: string;
  crawler_type: string;
  thread_id?: string;
  workflow_id?: string;
  task_title?: string;
  [key: string]: any;
}

export interface AnalyticsDocumentQuery {
  run_id?: string | null;
  workflow_id?: string | null;
  thread_id?: string | null;
  platform?: string | null;
  kind?: string | null;
  keyword?: string | null;
  subject_type?: string | null;
  parent_source_item_id?: string | null;
  query?: string | null;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface AnalyticsDocumentPage {
  items: CanonicalDocument[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

function presentFilter(value: string | null | undefined): value is string {
  return Boolean(value && value !== 'all');
}

function parseDocument(row: any): CanonicalDocument {
  const document = JSON.parse(row.canonical_json);
  document.fetchedAt = row.fetched_at;
  document.updatedAt = row.fetched_at;
  document.provenance = {
    source: row.platform,
    ...(row.source_item_id ? { sourceItemId: row.source_item_id } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    rawItemId: row.raw_item_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    fetchedAt: row.fetched_at,
  };
  return canonicalDocumentSchema.parse(document);
}

function aggregate(documents: CanonicalDocument[]): any {
  const metrics: Record<string, number> = {};
  const metricCoverage: Record<string, number> = {};
  for (const document of documents) {
    for (const [key, value] of Object.entries(document.metrics)) {
      metricCoverage[key] = (metricCoverage[key] || 0) + 1;
      if (typeof value === 'number') metrics[key] = (metrics[key] || 0) + value;
    }
  }
  return {
    document_count: documents.length,
    content_count: documents.filter((document) => document.kind !== 'comment').length,
    comment_count: documents.filter((document) => document.kind === 'comment').length,
    subject_count: new Set(documents
      .map((document) => document.subject.id || document.subject.name)
      .filter(Boolean)).size,
    metrics,
    metric_coverage: metricCoverage,
  };
}

export class AnalyticsRepository {
  private readonly connectorHealth: ConnectorHealthService;
  constructor(private readonly databaseProvider: () => Database = getDb) {
    this.connectorHealth = new ConnectorHealthService(databaseProvider);
  }
  private get db(): Database { return this.databaseProvider(); }

  createRun(config: RunConfig, taskName = ''): string {
    const runId = crypto.randomUUID().replace(/-/g, '');
    const title = String(config.task_title || taskName || config.keywords || config.platform);
    this.db.prepare(`
      INSERT INTO crawl_runs (
        run_id, thread_id, workflow_id, task_title, task_name, platform,
        crawler_type, keywords, status, started_at, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      runId,
      config.thread_id || null,
      config.workflow_id || null,
      title,
      taskName || title,
      config.platform,
      config.crawler_type || '',
      config.keywords || '',
      new Date().toISOString(),
      JSON.stringify(config),
    );
    return runId;
  }

  finishRun(runId: string, status: string, exitCode: number | null, _documents: any[], errorMessage = ''): void {
    const counts = this.countRunDocuments(runId);
    this.db.prepare(`
      UPDATE crawl_runs SET status=?, finished_at=?, exit_code=?, item_count=?, comment_count=?, error_message=?
      WHERE run_id=?
    `).run(
      status,
      new Date().toISOString(),
      exitCode,
      counts.item_count,
      counts.comment_count,
      errorMessage || null,
      runId,
    );
    this.connectorHealth.recordRun(runId);
  }

  countRunDocuments(runId: string): { item_count: number; comment_count: number } {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN d.kind != 'comment' THEN 1 ELSE 0 END), 0) AS item_count,
        COALESCE(SUM(CASE WHEN d.kind = 'comment' THEN 1 ELSE 0 END), 0) AS comment_count
      FROM document_sources s
      JOIN documents d ON d.document_id=s.document_id
      WHERE s.run_id=?
    `).get(runId) as any;
    return {
      item_count: Number(row?.item_count || 0),
      comment_count: Number(row?.comment_count || 0),
    };
  }

  refreshRunCounts(runId: string): void {
    const counts = this.countRunDocuments(runId);
    this.db.prepare('UPDATE crawl_runs SET item_count=?, comment_count=? WHERE run_id=?')
      .run(counts.item_count, counts.comment_count, runId);
  }

  appendRunLog(runId: string, log: { platform: string; timestamp: string; level: string; message: string }): number {
    return Number(this.db.prepare(`
      INSERT INTO crawl_run_logs (run_id, platform, timestamp, level, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, log.platform, log.timestamp, log.level, log.message, new Date().toISOString()).lastInsertRowid);
  }

  listRunLogs(platform?: string, limit = 500, threadId?: string): any[] {
    const where: string[] = [];
    const params: any[] = [];
    if (platform) { where.push('l.platform=?'); params.push(platform); }
    if (threadId) { where.push('r.thread_id=?'); params.push(threadId); }
    const rows = this.db.prepare(`
      SELECT l.*, r.thread_id
      FROM crawl_run_logs l
      JOIN crawl_runs r ON r.run_id=l.run_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.id DESC LIMIT ?
    `).all(...params, Math.max(1, Math.min(limit, 2000))) as any[];
    return rows.reverse();
  }

  queryDocuments(params: AnalyticsDocumentQuery = {}): AnalyticsDocumentPage {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(params.page_size || 20, 1_000_000));
    const sourceWhere: string[] = ['1=1'];
    const sourceValues: any[] = [];
    const workflowId = params.workflow_id;
    if (presentFilter(params.run_id)) { sourceWhere.push('s.run_id=?'); sourceValues.push(params.run_id); }
    if (presentFilter(workflowId)) { sourceWhere.push('r.workflow_id=?'); sourceValues.push(workflowId); }
    if (presentFilter(params.thread_id)) { sourceWhere.push('r.thread_id=?'); sourceValues.push(params.thread_id); }

    const documentWhere: string[] = ['source_rank=1'];
    const documentValues: any[] = [];
    const jsonText = (path: string) => `json_extract(canonical_json, '${path}')`;
    if (presentFilter(params.platform)) { documentWhere.push(`${jsonText('$.platform')}=?`); documentValues.push(params.platform); }
    if (presentFilter(params.kind)) {
      if (params.kind === 'main_only' || params.kind === 'exclude_comments') {
        documentWhere.push(`${jsonText('$.kind')} != 'comment'`);
      } else {
        documentWhere.push(`${jsonText('$.kind')}=?`);
        documentValues.push(params.kind);
      }
    }
    if (presentFilter(params.keyword)) { documentWhere.push(`${jsonText('$.keyword')}=?`); documentValues.push(params.keyword); }
    if (presentFilter(params.subject_type)) {
      documentWhere.push(`${jsonText('$.subject.type')}=?`);
      documentValues.push(params.subject_type);
    }
    if (presentFilter(params.parent_source_item_id)) {
      documentWhere.push(`(${jsonText('$.parentSourceItemId')}=? OR parent_source_item_id=?)`);
      documentValues.push(params.parent_source_item_id, params.parent_source_item_id);
    }
    if (params.query?.trim()) {
      const term = `%${params.query.trim().toLocaleLowerCase()}%`;
      documentWhere.push(`LOWER(
        COALESCE(${jsonText('$.title')}, '') || ' ' ||
        COALESCE(${jsonText('$.summary')}, '') || ' ' ||
        COALESCE(${jsonText('$.markdown')}, '') || ' ' ||
        COALESCE(${jsonText('$.subject.name')}, '') || ' ' ||
        COALESCE(${jsonText('$.sourceItemId')}, '') || ' ' ||
        COALESCE(${jsonText('$.parentSourceItemId')}, '') || ' ' ||
        COALESCE(parent_source_item_id, '')
      ) LIKE ?`);
      documentValues.push(term);
    }

    const base = `
      WITH ranked_sources AS (
        SELECT s.*, v.canonical_json,
               ROW_NUMBER() OVER (
                 PARTITION BY s.document_id ORDER BY s.fetched_at DESC, s.source_record_id DESC
               ) AS source_rank
        FROM document_sources s
        JOIN document_versions v ON v.version_id=s.document_version_id
        LEFT JOIN crawl_runs r ON r.run_id=s.run_id
        WHERE ${sourceWhere.join(' AND ')}
      )
    `;
    const where = documentWhere.join(' AND ');
    const values = [...sourceValues, ...documentValues];
    const total = Number((this.db.prepare(`
      ${base}
      SELECT COUNT(*) AS count FROM ranked_sources WHERE ${where}
    `).get(...values) as any).count);

    const direction = params.sort_order === 'asc' ? 'ASC' : 'DESC';
    const simpleSorts: Record<string, string> = {
      updated_at: jsonText('$.updatedAt'),
      published_at: jsonText('$.publishedAt'),
      fetched_at: 'fetched_at',
      rank: `CAST(${jsonText('$.rank')} AS REAL)`,
      title: jsonText('$.title'),
    };
    let sortExpression = simpleSorts[params.sort_by || ''] || 'fetched_at';
    const metricMatch = params.sort_by?.match(/^metrics\.([A-Za-z][A-Za-z0-9_]*)$/);
    if (metricMatch) sortExpression = `CAST(json_extract(canonical_json, '$.metrics.${metricMatch[1]}') AS REAL)`;

    const rows = this.db.prepare(`
      ${base}
      SELECT * FROM ranked_sources
      WHERE ${where}
      ORDER BY ${sortExpression} ${direction}, document_id ASC
      LIMIT ? OFFSET ?
    `).all(...values, pageSize, (page - 1) * pageSize) as any[];

    return {
      items: rows.map(parseDocument),
      total,
      page,
      page_size: pageSize,
      pages: Math.ceil(total / pageSize),
    };
  }

  summary(params: AnalyticsDocumentQuery = {}): any {
    const documents = this.queryDocuments({ ...params, page: 1, page_size: 1_000_000 }).items;
    const group = (key: 'platform' | 'kind' | 'keyword' | 'subject_type') => {
      const valueOf = (document: CanonicalDocument): string => {
        if (key === 'subject_type') return document.subject.type;
        return String(document[key] || '');
      };
      return [...new Set(documents.map(valueOf).filter(Boolean))].map((value) => ({
        [key]: value,
        ...(key === 'platform' ? { platform_label: platformLabel(value) } : {}),
        ...aggregate(documents.filter((document) => valueOf(document) === value)),
      }));
    };
    return {
      totals: aggregate(documents),
      by_platform: group('platform'),
      by_kind: group('kind'),
      by_keyword: group('keyword'),
      by_subject_type: group('subject_type'),
      filters: {
        platforms: [...new Set(documents.map((document) => document.platform))]
          .map((platform) => [platform, platformLabel(platform)]),
        kinds: [...new Set(documents.map((document) => document.kind))],
        keywords: [...new Set(documents.map((document) => document.keyword).filter(Boolean))],
        subject_types: [...new Set(documents.map((document) => document.subject.type))],
        metric_keys: [...new Set(documents.flatMap((document) => Object.keys(document.metrics)))],
        attribute_keys: [...new Set(documents.flatMap((document) => Object.keys(document.attributes)))],
      },
    };
  }

  listRuns(page = 1, pageSize = 20): any {
    const total = Number((this.db.prepare('SELECT COUNT(*) AS count FROM crawl_runs').get() as any).count);
    const items = this.db.prepare(`
      SELECT r.*, r.workflow_id AS plan_id, COALESCE(t.title, w.goal, r.task_title) AS task_title
      FROM crawl_runs r
      LEFT JOIN workflow_runs w ON w.workflow_id=r.workflow_id
      LEFT JOIN agent_threads t ON t.thread_id=r.thread_id
      ORDER BY r.started_at DESC LIMIT ? OFFSET ?
    `).all(pageSize, (page - 1) * pageSize) as any[];
    return {
      items: items.map((run) => ({ ...run, platform_label: platformLabel(run.platform) })),
      total,
      page,
      page_size: pageSize,
      pages: Math.ceil(total / pageSize),
    };
  }

  listTaskHierarchy(): any {
    const rows = this.db.prepare(`
      SELECT r.*, r.workflow_id AS plan_id, COALESCE(t.title, r.task_title) AS task_title,
             COALESCE(w.goal, r.task_title) AS round_title
      FROM crawl_runs r
      LEFT JOIN workflow_runs w ON w.workflow_id=r.workflow_id
      LEFT JOIN agent_threads t ON t.thread_id=r.thread_id
      ORDER BY r.started_at DESC
    `).all() as any[];
    const tasks = new Map<string, any>();
    for (const run of rows) {
      const threadId = run.thread_id || run.run_id;
      const workflowId = run.workflow_id || run.run_id;
      if (!tasks.has(threadId)) tasks.set(threadId, { thread_id: threadId, task_title: run.task_title, rounds: new Map() });
      const task = tasks.get(threadId);
      if (!task.rounds.has(workflowId)) task.rounds.set(workflowId, { plan_id: workflowId, round_title: run.round_title, runs: [] });
      task.rounds.get(workflowId).runs.push({ ...run, platform_label: platformLabel(run.platform) });
    }
    const items = [...tasks.values()].map((task) => ({ ...task, rounds: [...task.rounds.values()] }));
    return {
      items,
      total: items.length,
      round_total: items.reduce((sum, item) => sum + item.rounds.length, 0),
      run_total: rows.length,
    };
  }

  getSubtaskCount(threadId?: string, workflowId?: string): number {
    if (!threadId && !workflowId) return 1;
    if (threadId) {
      const row = this.db.prepare(`
        SELECT COUNT(DISTINCT COALESCE(workflow_id, run_id)) AS count
        FROM crawl_runs
        WHERE thread_id = ?
      `).get(threadId) as any;
      const count = Number(row?.count || 0);
      if (count > 0) return count;
      const wfRow = this.db.prepare(`
        SELECT COUNT(DISTINCT workflow_id) AS count
        FROM workflow_runs
        WHERE thread_id = ?
      `).get(threadId) as any;
      return Math.max(1, Number(wfRow?.count || 0));
    }
    return 1;
  }

  storageSummary(): any {
    const count = (table: string) => {
      try {
        return Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any)?.count || 0);
      } catch {
        return 0;
      }
    };

    let databaseSizeBytes = 0;
    try {
      const dbPath = getDatabasePath();
      if (fs.existsSync(dbPath)) {
        databaseSizeBytes = fs.statSync(dbPath).size;
      }
    } catch {
      databaseSizeBytes = 0;
    }

    return {
      database_size_bytes: databaseSizeBytes,
      // 1. 会话分类
      thread_records: count('agent_threads'),
      message_records: count('agent_messages'),
      // 2. 知识底座分类
      analytics_runs: count('crawl_runs'),
      analytics_records: count('documents'),
      raw_records: count('document_sources'),
      chunk_records: count('document_chunks'),
      embedding_records: count('document_chunk_embeddings'),
      graph_snapshots: count('graph_snapshots'),
      graph_nodes: count('graph_nodes'),
      graph_edges: count('graph_edges'),
      log_records: count('crawl_run_logs'),
      // 3. 研报资产分类
      report_records: count('analysis_reports'),
      artifact_records: count('report_artifacts'),
      assessment_records: count('search_relevance_assessments'),
    };
  }

  previewCleanup(params: {
    crawl_days?: number;
    crawl_failed_days?: number;
    thread_days?: number;
    max_messages?: number;
    report_days?: number;
  } = {}): {
    crawl_failed_empty: number;
    crawl_older_days: number;
    crawl_all: number;
    thread_empty_short: number;
    thread_older_days: number;
    thread_all: number;
    report_older_days: number;
    report_all: number;
  } {
    const crawlDays = Math.max(1, Math.min(3650, Number(params.crawl_days || 30)));
    const crawlFailedDays = Number(params.crawl_failed_days || 0);
    const threadDays = Math.max(1, Math.min(3650, Number(params.thread_days || 30)));
    const reportDays = Math.max(1, Math.min(3650, Number(params.report_days || 30)));

    const noCollectedData = `NOT EXISTS (
      SELECT 1
      FROM crawl_runs r
      JOIN document_sources s ON s.run_id = r.run_id
      JOIN documents d ON d.document_id = s.document_id
      WHERE r.thread_id = t.thread_id AND d.kind != 'comment'
    )`;
    const notBusyThread = `
      AND NOT EXISTS (
        SELECT 1 FROM workflow_runs w
        WHERE w.thread_id = t.thread_id AND w.status IN ('queued', 'running', 'waiting_for_user')
      )
      AND NOT EXISTS (
        SELECT 1 FROM crawl_runs cr
        WHERE cr.thread_id = t.thread_id AND cr.status = 'running'
      )
    `;

    const failedDaysFilter = crawlFailedDays > 0 ? ` AND started_at < datetime('now', '-${crawlFailedDays} days')` : '';
    const crawlFailedEmpty = Number((this.db.prepare(
      `SELECT COUNT(*) AS count FROM crawl_runs WHERE status!='running' AND (status='failed' OR item_count=0)${failedDaysFilter}`
    ).get() as any)?.count || 0);

    const crawlOlderDays = Number((this.db.prepare(
      `SELECT COUNT(*) AS count FROM crawl_runs WHERE status!='running' AND started_at < datetime('now', '-${crawlDays} days')`
    ).get() as any)?.count || 0);

    const crawlAll = Number((this.db.prepare(
      "SELECT COUNT(*) AS count FROM crawl_runs WHERE status!='running'"
    ).get() as any)?.count || 0);

    const maxMessages = Number(params.max_messages ?? 2);
    const userMsgCondition = maxMessages === 0
      ? "(SELECT COUNT(*) FROM agent_messages m WHERE m.thread_id = t.thread_id AND m.role = 'user') = 0"
      : `(SELECT COUNT(*) FROM agent_messages m WHERE m.thread_id = t.thread_id AND m.role = 'user') < ${maxMessages}`;

    const threadEmptyShort = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM agent_threads t
      WHERE ${userMsgCondition}
      AND ${noCollectedData}
      ${notBusyThread}
    `).get() as any)?.count || 0);

    const threadOlderDays = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM agent_threads t
      WHERE t.updated_at < datetime('now', '-${threadDays} days')
      AND ${noCollectedData}
      ${notBusyThread}
    `).get() as any)?.count || 0);

    const threadAll = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM agent_threads t
      WHERE 1=1
      ${notBusyThread}
    `).get() as any)?.count || 0);

    const reportOlderDays = Number((this.db.prepare(
      `SELECT COUNT(*) AS count FROM report_artifacts WHERE created_at < datetime('now', '-${reportDays} days')`
    ).get() as any)?.count || 0);

    const reportAll = Number((this.db.prepare(
      'SELECT COUNT(*) AS count FROM report_artifacts'
    ).get() as any)?.count || 0);

    return {
      crawl_failed_empty: crawlFailedEmpty,
      crawl_older_days: crawlOlderDays,
      crawl_all: crawlAll,
      thread_empty_short: threadEmptyShort,
      thread_older_days: threadOlderDays,
      thread_all: threadAll,
      report_older_days: reportOlderDays,
      report_all: reportAll,
    };
  }

  cleanupHistory(mode: 'failed_empty' | 'older_than_30_days' | 'all', options?: { days?: number }): number {
    if (mode === 'all') {
      return (this.db.transaction(() => {
        const activeCrawls = Number((this.db.prepare("SELECT COUNT(*) AS count FROM crawl_runs WHERE status='running'").get() as any).count);
        const activeWorkflows = Number((this.db.prepare(
          "SELECT COUNT(*) AS count FROM workflow_runs WHERE status IN ('queued','running','waiting_for_user')",
        ).get() as any).count);
        if (activeCrawls || activeWorkflows) throw new Error('请先停止正在运行或等待中的任务');

        // Research assets (reports & artifacts) are independent high-value outputs.
        // Decouple them from thread/workflow/graph to avoid foreign-key constraint violations
        // while preserving the user's research reports.
        this.db.prepare('UPDATE report_artifacts SET thread_id=NULL, workflow_id=NULL, graph_id=NULL').run();
        this.db.prepare('UPDATE analysis_reports SET thread_id=NULL, workflow_id=NULL').run();

        // Clear knowledge base graph snapshots, entity rules, and quality checks
        this.db.prepare('DELETE FROM graph_entity_rules').run();
        this.db.prepare('DELETE FROM graph_snapshots').run();
        this.db.prepare('DELETE FROM quality_gate_runs').run();

        const deletedRuns = this.db.prepare("DELETE FROM crawl_runs WHERE status!='running'").run().changes;
        this.db.prepare('DELETE FROM document_sources').run();
        this.db.prepare('DELETE FROM documents').run();
        this.db.prepare('DELETE FROM crawl_run_logs').run();
        this.db.prepare('DELETE FROM search_discoveries').run();
        return deletedRuns;
      }))();
    }

    let predicate: string;
    if (mode === 'failed_empty') {
      const failedDays = Number(options?.days || 0);
      const failedDaysFilter = failedDays > 0 ? ` AND started_at < datetime('now', '-${failedDays} days')` : '';
      predicate = `status!='running' AND (status='failed' OR item_count=0)${failedDaysFilter}`;
    } else {
      const days = Math.max(1, Math.min(3650, Number(options?.days || 30)));
      predicate = `status!='running' AND started_at < datetime('now', '-${days} days')`;
    }
    const ids = this.db.prepare(`SELECT run_id FROM crawl_runs WHERE ${predicate}`).all() as Array<{ run_id: string }>;
    const runIds = ids.map((item) => item.run_id);
    let deleted = 0;
    if (runIds.length) {
      deleted = this.deleteRuns(runIds, false);
    }
    this.db.prepare('DELETE FROM documents WHERE document_id NOT IN (SELECT document_id FROM document_sources)').run();
    // Clean orphan graph snapshots and entity rules that reference deleted runs
    this.db.prepare(`
      DELETE FROM graph_snapshots
      WHERE (scope_type = 'run' AND scope_id NOT IN (SELECT run_id FROM crawl_runs))
         OR (scope_type = 'thread' AND scope_id NOT IN (SELECT thread_id FROM agent_threads))
         OR (scope_type = 'workflow' AND scope_id NOT IN (SELECT workflow_id FROM workflow_runs))
    `).run();
    this.db.prepare(`
      DELETE FROM graph_entity_rules
      WHERE (scope_type = 'run' AND scope_id NOT IN (SELECT run_id FROM crawl_runs))
         OR (scope_type = 'thread' AND scope_id NOT IN (SELECT thread_id FROM agent_threads))
         OR (scope_type = 'workflow' AND scope_id NOT IN (SELECT workflow_id FROM workflow_runs))
    `).run();
    return deleted;
  }

  cleanupReports(mode: 'older_than_days' | 'all', options?: { days?: number }): number {
    return (this.db.transaction(() => {
      let artifactWhere = '1=1';
      let reportWhere = '1=1';
      if (mode === 'older_than_days') {
        const days = Math.max(1, Math.min(3650, Number(options?.days || 30)));
        artifactWhere = `created_at < datetime('now', '-${days} days')`;
        reportWhere = `created_at < datetime('now', '-${days} days')`;
      }

      // Collect target artifact report IDs
      const artifacts = this.db.prepare(`SELECT artifact_id, report_id FROM report_artifacts WHERE ${artifactWhere}`).all() as Array<{ artifact_id: string; report_id: string }>;
      const artifactIds = artifacts.map((a) => a.artifact_id);
      const reportIds = [...new Set(artifacts.map((a) => a.report_id).filter(Boolean))];

      let deletedArtifacts = 0;
      if (artifactIds.length) {
        const placeholders = artifactIds.map(() => '?').join(',');
        deletedArtifacts = this.db.prepare(`DELETE FROM report_artifacts WHERE artifact_id IN (${placeholders})`).run(...artifactIds).changes;
      } else if (mode === 'all') {
        deletedArtifacts = this.db.prepare('DELETE FROM report_artifacts').run().changes;
      }

      // Delete corresponding analysis reports
      if (reportIds.length) {
        const reportPlaceholders = reportIds.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM analysis_reports WHERE report_id IN (${reportPlaceholders})`).run(...reportIds);
      } else if (mode === 'all') {
        this.db.prepare('DELETE FROM analysis_reports').run();
      } else if (mode === 'older_than_days') {
        this.db.prepare(`DELETE FROM analysis_reports WHERE ${reportWhere}`).run();
      }

      // Clean assessments and quality gates
      if (mode === 'all') {
        this.db.prepare('DELETE FROM search_relevance_assessments').run();
        this.db.prepare('DELETE FROM quality_gate_runs').run();
      } else {
        this.db.prepare(`DELETE FROM search_relevance_assessments WHERE created_at < datetime('now', '-${Math.max(1, Number(options?.days || 30))} days')`).run();
      }

      return deletedArtifacts;
    }))();
  }

  vacuumDatabase(): { before_bytes: number; after_bytes: number; freed_bytes: number } {
    let beforeBytes = 0;
    try {
      const dbPath = getDatabasePath();
      if (fs.existsSync(dbPath)) beforeBytes = fs.statSync(dbPath).size;
    } catch {
      beforeBytes = 0;
    }

    // Execute VACUUM
    this.db.exec('VACUUM');

    let afterBytes = 0;
    try {
      const dbPath = getDatabasePath();
      if (fs.existsSync(dbPath)) afterBytes = fs.statSync(dbPath).size;
    } catch {
      afterBytes = beforeBytes;
    }

    return {
      before_bytes: beforeBytes,
      after_bytes: afterBytes,
      freed_bytes: Math.max(0, beforeBytes - afterBytes),
    };
  }

  cleanupThreads(
    mode: 'empty_short' | 'older_than_30_days_no_crawl' | 'all_threads',
    options?: { maxMessages?: number; days?: number },
  ): number {
    // A crawl task alone does not make a conversation worth retaining. Failed
    // or zero-result runs have no linked primary documents and should be
    // treated the same as conversations that never started a crawl.
    const noCollectedData = `NOT EXISTS (
      SELECT 1
      FROM crawl_runs r
      JOIN document_sources s ON s.run_id = r.run_id
      JOIN documents d ON d.document_id = s.document_id
      WHERE r.thread_id = t.thread_id AND d.kind != 'comment'
    )`;
    let whereClause: string;
    if (mode === 'empty_short') {
      const maxMessages = Number(options?.maxMessages ?? 2);
      const userMsgCondition = maxMessages === 0
        ? "(SELECT COUNT(*) FROM agent_messages m WHERE m.thread_id = t.thread_id AND m.role = 'user') = 0"
        : `(SELECT COUNT(*) FROM agent_messages m WHERE m.thread_id = t.thread_id AND m.role = 'user') < ${maxMessages}`;
      whereClause = `
        ${userMsgCondition}
        AND ${noCollectedData}
      `;
    } else if (mode === 'older_than_30_days_no_crawl') {
      const days = Math.max(1, Math.min(3650, Number(options?.days || 30)));
      whereClause = `
        t.updated_at < datetime('now', '-${days} days')
        AND ${noCollectedData}
      `;
    } else {
      whereClause = '1=1';
    }

    const candidateThreads = this.db.prepare(`
      SELECT t.thread_id FROM agent_threads t
      WHERE ${whereClause}
      AND NOT EXISTS (
        SELECT 1 FROM workflow_runs w
        WHERE w.thread_id = t.thread_id AND w.status IN ('queued', 'running', 'waiting_for_user')
      )
      AND NOT EXISTS (
        SELECT 1 FROM crawl_runs cr
        WHERE cr.thread_id = t.thread_id AND cr.status = 'running'
      )
    `).all() as Array<{ thread_id: string }>;

    if (!candidateThreads.length) return 0;

    const threadIds = candidateThreads.map((row) => row.thread_id);
    return (this.db.transaction(() => {
      const placeholders = threadIds.map(() => '?').join(',');

      // Conversation cleanup must not implicitly erase collected data or
      // research assets through agent_threads foreign-key cascades. Detach the
      // retained records first; crawl_runs.thread_id is intentionally kept as
      // the stable grouping key used by the knowledge-base task hierarchy.
      this.db.prepare(`UPDATE report_artifacts SET thread_id=NULL WHERE thread_id IN (${placeholders})`).run(...threadIds);
      this.db.prepare(`UPDATE workflow_runs SET thread_id=NULL WHERE thread_id IN (${placeholders})`).run(...threadIds);

      return this.db.prepare(`DELETE FROM agent_threads WHERE thread_id IN (${placeholders})`).run(...threadIds).changes;
    }))();
  }

  private deleteScope(column: 'thread_id' | 'workflow_id', values: string[], withReports: boolean = false): number {
    const ids = [...new Set(values.filter(Boolean))];
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const running = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM crawl_runs
      WHERE ${column} IN (${placeholders}) AND status='running'
    `).get(...ids) as any).count);
    if (running) throw new Error('请先停止所选任务中正在采集的执行');

    return (this.db.transaction(() => {
      // Clean graph snapshots associated with deleted scope or global snapshots
      const scopeType = column === 'thread_id' ? 'thread' : 'workflow';
      this.db.prepare(`DELETE FROM graph_snapshots WHERE (scope_type=? AND scope_id IN (${placeholders})) OR scope_type='all'`).run(scopeType, ...ids);

      // Clean reports if requested, otherwise detach to NULL to preserve as independent assets
      if (withReports) {
        this.db.prepare(`DELETE FROM report_artifacts WHERE ${column} IN (${placeholders})`).run(...ids);
      } else {
        this.db.prepare(`UPDATE report_artifacts SET ${column}=NULL WHERE ${column} IN (${placeholders})`).run(...ids);
      }

      const deleted = this.db.prepare(`DELETE FROM crawl_runs WHERE ${column} IN (${placeholders})`).run(...ids).changes;
      this.db.prepare('DELETE FROM documents WHERE document_id NOT IN (SELECT document_id FROM document_sources)').run();
      return deleted;
    }))();
  }

  deleteThreads(ids: string[], withReports: boolean = false): number { return this.deleteScope('thread_id', ids, withReports); }
  deletePlans(ids: string[], withReports: boolean = false): number { return this.deleteScope('workflow_id', ids, withReports); }

  deleteRuns(runIds: string[], _withReports: boolean = false): number {
    const ids = [...new Set(runIds.filter(Boolean))];
    if (!ids.length) return 0;
    const all = ids.includes('all');
    const where = all ? "status!='running'" : `run_id IN (${ids.map(() => '?').join(',')})`;
    const params = all ? [] : ids;
    if (!all) {
      const running = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM crawl_runs WHERE ${where} AND status='running'
      `).get(...params) as any).count);
      if (running) throw new Error('请先停止所选执行中的采集任务');
    }
    return (this.db.transaction(() => {
      if (!all) {
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM graph_snapshots WHERE (scope_type='run' AND scope_id IN (${placeholders})) OR scope_type='all'`).run(...ids);
      } else {
        this.db.prepare('DELETE FROM graph_snapshots').run();
      }
      const deleted = this.db.prepare(`DELETE FROM crawl_runs WHERE ${where}`).run(...params).changes;
      this.db.prepare('DELETE FROM documents WHERE document_id NOT IN (SELECT document_id FROM document_sources)').run();
      return deleted;
    }))();
  }

  deleteRun(runId: string, withReports: boolean = false): boolean { return this.deleteRuns([runId], withReports) > 0; }
}

export const analyticsRepository = new AnalyticsRepository();
