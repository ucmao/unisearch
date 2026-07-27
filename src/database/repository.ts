import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from './connection';
import { platformLabel } from '../connectors/registry';
import { canonicalDocumentSchema, type CanonicalDocument } from '../core/documents/canonical';

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
  constructor(private readonly databaseProvider: () => Database = getDb) {}
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

  storageSummary(): any {
    const count = (table: string) => Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count);
    return {
      analytics_runs: count('crawl_runs'),
      analytics_records: count('documents'),
      log_records: count('crawl_run_logs'),
      raw_records: count('document_sources'),
    };
  }

  cleanupHistory(mode: 'failed_empty' | 'older_than_30_days' | 'all'): number {
    const predicate = mode === 'failed_empty'
      ? "status!='running' AND (status='failed' OR item_count=0)"
      : mode === 'older_than_30_days'
        ? "status!='running' AND started_at < datetime('now','-30 days')"
        : "status!='running'";
    const ids = this.db.prepare(`SELECT run_id FROM crawl_runs WHERE ${predicate}`).all() as Array<{ run_id: string }>;
    return this.deleteRuns(ids.map((item) => item.run_id));
  }

  private deleteScope(column: 'thread_id' | 'workflow_id', values: string[]): number {
    const ids = [...new Set(values.filter(Boolean))];
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const running = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM crawl_runs
      WHERE ${column} IN (${placeholders}) AND status='running'
    `).get(...ids) as any).count);
    if (running) throw new Error('请先停止所选任务中正在采集的执行');
    return this.db.prepare(`DELETE FROM crawl_runs WHERE ${column} IN (${placeholders})`).run(...ids).changes;
  }

  deleteThreads(ids: string[]): number { return this.deleteScope('thread_id', ids); }
  deletePlans(ids: string[]): number { return this.deleteScope('workflow_id', ids); }

  deleteRuns(runIds: string[]): number {
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
    return this.db.prepare(`DELETE FROM crawl_runs WHERE ${where}`).run(...params).changes;
  }

  deleteRun(runId: string): boolean { return this.deleteRuns([runId]) > 0; }
}

export const analyticsRepository = new AnalyticsRepository();
