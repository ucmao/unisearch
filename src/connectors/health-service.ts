import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';

export type ConnectorHealthState = 'healthy' | 'degraded' | 'blocked' | 'broken' | 'unknown';

function errorCode(message: string): string | null {
  if (/登录|auth|unauthorized/i.test(message)) return 'AUTH_REQUIRED';
  if (/验证|captcha|challenge|风控/i.test(message)) return 'VERIFICATION_REQUIRED';
  if (/限流|频繁|429|rate.?limit/i.test(message)) return 'RATE_LIMITED';
  if (/结构|selector|schema|页面.{0,6}变化/i.test(message)) return 'PAGE_STRUCTURE_CHANGED';
  if (/timeout|超时|network|ECONN|ENOTFOUND/i.test(message)) return 'NETWORK_ERROR';
  return message ? 'CONNECTOR_ERROR' : null;
}

function stateFor(status: string, itemCount: number, code: string | null): ConnectorHealthState {
  if (code === 'AUTH_REQUIRED' || code === 'VERIFICATION_REQUIRED') return 'blocked';
  if (code === 'PAGE_STRUCTURE_CHANGED') return 'broken';
  if (status === 'completed' && itemCount > 0) return 'healthy';
  if (status === 'running') return 'unknown';
  return 'degraded';
}

export class ConnectorHealthService {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  recordRun(runId: string): any {
    const run = this.db.prepare('SELECT * FROM crawl_runs WHERE run_id=?').get(runId) as any;
    if (!run) throw new Error('Crawl run not found');
    const config = JSON.parse(run.config_json || '{}');
    const target = Math.max(0, Number(config.connector_options?.max_items ?? config.crawler_max_notes_count ?? 0));
    const itemCount = Number(run.item_count || 0);
    const sourceStats = this.db.prepare(`SELECT COUNT(*) total, COUNT(DISTINCT document_id) distinct_documents
      FROM document_sources WHERE run_id=?`).get(runId) as any;
    const quality = this.db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN d.title!='' THEN 1 ELSE 0 END) title_count,
      SUM(CASE WHEN d.source_url IS NOT NULL AND d.source_url!='' THEN 1 ELSE 0 END) url_count,
      SUM(CASE WHEN d.markdown!='' OR d.summary!='' THEN 1 ELSE 0 END) text_count
      FROM document_sources s JOIN documents d ON d.document_id=s.document_id WHERE s.run_id=?`).get(runId) as any;
    const total = Number(sourceStats?.total || 0);
    const duplicateRate = total ? Math.max(0, 1 - Number(sourceStats.distinct_documents || 0) / total) : 0;
    const fieldCoverage = Number(quality?.total || 0)
      ? (Number(quality.title_count || 0) + Number(quality.url_count || 0) + Number(quality.text_count || 0)) / (Number(quality.total) * 3)
      : 0;
    const code = errorCode(String(run.error_message || ''));
    const state = stateFor(run.status, itemCount, code);
    const previous = this.db.prepare('SELECT * FROM connector_health WHERE connector_id=?').get(run.platform) as any;
    const runCount = Number(previous?.run_count || 0) + 1;
    const previousSuccesses = Math.round(Number(previous?.success_rate || 0) * Number(previous?.run_count || 0));
    const success = run.status === 'completed' && itemCount > 0 ? 1 : 0;
    const consecutiveFailures = success ? 0 : Number(previous?.consecutive_failures || 0) + 1;
    const updatedAt = new Date().toISOString();
    const metrics = { targetItems: target, collectedItems: itemCount, commentCount: Number(run.comment_count || 0), status: run.status };
    this.db.prepare(`INSERT INTO connector_health
      (connector_id, state, last_run_id, last_success_at, consecutive_failures, run_count, success_rate, yield_rate,
       duplicate_rate, field_coverage, last_error_code, last_error_message, metrics_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connector_id) DO UPDATE SET
       state=excluded.state,last_run_id=excluded.last_run_id,last_success_at=excluded.last_success_at,
       consecutive_failures=excluded.consecutive_failures,run_count=excluded.run_count,success_rate=excluded.success_rate,
       yield_rate=excluded.yield_rate,duplicate_rate=excluded.duplicate_rate,field_coverage=excluded.field_coverage,
       last_error_code=excluded.last_error_code,last_error_message=excluded.last_error_message,
       metrics_json=excluded.metrics_json,updated_at=excluded.updated_at`)
      .run(run.platform, state, runId, success ? run.finished_at || updatedAt : previous?.last_success_at || null,
        consecutiveFailures, runCount, (previousSuccesses + success) / runCount, target ? Math.min(1, itemCount / target) : (itemCount ? 1 : 0),
        duplicateRate, fieldCoverage, code, run.error_message || null, JSON.stringify(metrics), updatedAt);
    return this.get(run.platform);
  }

  get(connectorId: string): any {
    const row = this.db.prepare('SELECT * FROM connector_health WHERE connector_id=?').get(connectorId) as any;
    return row ? this.parse(row) : null;
  }

  list(): any[] {
    return (this.db.prepare('SELECT * FROM connector_health ORDER BY state, connector_id').all() as any[]).map((row) => this.parse(row));
  }

  private parse(row: any): any {
    return {
      connectorId: row.connector_id, state: row.state, lastRunId: row.last_run_id, lastSuccessAt: row.last_success_at,
      consecutiveFailures: row.consecutive_failures, runCount: row.run_count, successRate: row.success_rate,
      yieldRate: row.yield_rate, duplicateRate: row.duplicate_rate, fieldCoverage: row.field_coverage,
      lastErrorCode: row.last_error_code, lastErrorMessage: row.last_error_message,
      metrics: JSON.parse(row.metrics_json || '{}'), updatedAt: row.updated_at,
    };
  }
}

export const connectorHealthService = new ConnectorHealthService();
