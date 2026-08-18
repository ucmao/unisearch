import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';
import { getConnectorManifest, listConnectorManifests } from './registry';

export type ConnectorHealthState = 'healthy' | 'degraded' | 'blocked' | 'broken' | 'unknown';

export interface ConnectorPlanDecision {
  connectorId: string;
  action: 'use' | 'warn' | 'replace' | 'require_confirmation';
  state: ConnectorHealthState;
  reason: string;
  replacementId?: string;
}

export interface ConnectorPlanPolicy {
  originalPlatforms: string[];
  selectedPlatforms: string[];
  requiresConfirmation: boolean;
  decisions: ConnectorPlanDecision[];
}

function errorCode(message: string): string | null {
  if (/登录|auth|unauthorized/i.test(message)) return 'AUTH_REQUIRED';
  if (/验证|captcha|challenge|风控/i.test(message)) return 'VERIFICATION_REQUIRED';
  if (/限流|频繁|429|rate.?limit/i.test(message)) return 'RATE_LIMITED';
  if (/结构|selector|schema|页面.{0,6}变化/i.test(message)) return 'PAGE_STRUCTURE_CHANGED';
  if (/timeout|超时|network|ECONN|ENOTFOUND/i.test(message)) return 'NETWORK_ERROR';
  return message ? 'CONNECTOR_ERROR' : null;
}

export function determineState(
  status: string,
  itemCount: number,
  code: string | null,
  consecutiveFailures: number,
  previousState: ConnectorHealthState = 'unknown',
): ConnectorHealthState {
  if (code === 'AUTH_REQUIRED' || code === 'VERIFICATION_REQUIRED') return 'blocked';
  if (code === 'PAGE_STRUCTURE_CHANGED') return 'broken';
  if (status === 'running') return 'unknown';
  if (status === 'completed' && itemCount > 0) return 'healthy';

  // 缓冲防抖机制：如果连续失败少于 3 次且此前为正常状态，给予缓冲期保持 healthy，不轻易报警
  if (consecutiveFailures < 3 && previousState === 'healthy') {
    return 'healthy';
  }

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
    const previous = this.db.prepare('SELECT * FROM connector_health WHERE connector_id=?').get(run.platform) as any;
    const previousState = (previous?.state || 'unknown') as ConnectorHealthState;
    const previousSuccesses = Math.round(Number(previous?.success_rate || 0) * Number(previous?.run_count || 0));

    const isUserAborted = run.status === 'stopped' || run.status === 'cancelled';
    const success = run.status === 'completed' && itemCount > 0 ? 1 : 0;

    let runCount = Number(previous?.run_count || 0);
    let consecutiveFailures = Number(previous?.consecutive_failures || 0);
    let successRate = Number(previous?.success_rate || 0);
    let state: ConnectorHealthState;

    if (isUserAborted && !code) {
      // 用户主动停止且未发生异常报错时，保留原有健康状态与失败计数，不污染连接器质量
      state = previousState === 'unknown' ? 'unknown' : previousState;
    } else {
      runCount += 1;
      consecutiveFailures = success ? 0 : consecutiveFailures + 1;
      successRate = (previousSuccesses + success) / runCount;
      state = determineState(run.status, itemCount, code, consecutiveFailures, previousState);
    }

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
        consecutiveFailures, runCount, successRate, target ? Math.min(1, itemCount / target) : (itemCount ? 1 : 0),
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

  evaluatePlan(
    platforms: string[],
    explicitPlatforms: string[],
    capability = 'keyword_search',
    failoverPolicy: 'smart' | 'never' | 'always' = 'smart',
  ): ConnectorPlanPolicy {
    const explicit = new Set(explicitPlatforms);
    const health = new Map(this.list().map((item) => [item.connectorId, item]));
    const selected: string[] = [];
    const decisions: ConnectorPlanDecision[] = [];
    let requiresConfirmation = false;
    for (const connectorId of platforms) {
      const current = health.get(connectorId);
      const state = (current?.state || 'unknown') as ConnectorHealthState;
      if (!['blocked', 'broken'].includes(state)) {
        selected.push(connectorId);
        decisions.push({
          connectorId,
          action: state === 'degraded' ? 'warn' : 'use',
          state,
          reason: state === 'degraded' ? '近期运行质量下降，执行时将保留质量警告' : state === 'healthy' ? '近期运行正常' : '暂无足够运行历史',
        });
        continue;
      }

      // Check whether auto-failover is allowed for this connector
      const allowAutoReplace = failoverPolicy === 'always' || (failoverPolicy === 'smart' && !explicit.has(connectorId));

      if (allowAutoReplace) {
        const manifest = getConnectorManifest(connectorId);
        const replacement = listConnectorManifests()
          .filter((candidate) => candidate.id !== connectorId
            && candidate.category === manifest?.category
            && candidate.capabilities.some((item) => item.id === capability)
            && health.get(candidate.id)?.state === 'healthy'
            && !selected.includes(candidate.id))
          .sort((left, right) => Number(health.get(right.id)?.successRate || 0) - Number(health.get(left.id)?.successRate || 0))[0];
        if (replacement) {
          selected.push(replacement.id);
          decisions.push({ connectorId, action: 'replace', state, replacementId: replacement.id, reason: `自动改用近期运行正常的同类连接器 ${replacement.name}` });
          continue;
        }
      }

      // Fallback or explicit lock requires user confirmation
      selected.push(connectorId);
      requiresConfirmation = true;
      const lockReason = explicit.has(connectorId)
        ? (state === 'blocked' ? '用户显式选定的连接器需要重新登录或完成验证' : '用户显式选定的连接器近期疑似异常，保留选定等待手动确认')
        : (state === 'blocked' ? '当前连接器需要重新登录或完成人工验证' : '近期错误疑似由页面结构变化导致');
      decisions.push({
        connectorId,
        action: 'require_confirmation',
        state,
        reason: lockReason,
      });
    }
    return { originalPlatforms: [...platforms], selectedPlatforms: [...new Set(selected)], requiresConfirmation, decisions };
  }

  private parse(row: any): any {
    let state = row.state;
    // 自愈与平滑：对于非阻断错误，若连续失败小于3次且有运行记录，平滑为 healthy
    if (
      state === 'degraded'
      && Number(row.consecutive_failures || 0) < 3
      && Number(row.run_count || 0) > 0
      && !['AUTH_REQUIRED', 'VERIFICATION_REQUIRED', 'PAGE_STRUCTURE_CHANGED'].includes(row.last_error_code)
    ) {
      state = 'healthy';
    }
    return {
      connectorId: row.connector_id, state, lastRunId: row.last_run_id, lastSuccessAt: row.last_success_at,
      consecutiveFailures: row.consecutive_failures, runCount: row.run_count, successRate: row.success_rate,
      yieldRate: row.yield_rate, duplicateRate: row.duplicate_rate, fieldCoverage: row.field_coverage,
      lastErrorCode: row.last_error_code, lastErrorMessage: row.last_error_message,
      metrics: JSON.parse(row.metrics_json || '{}'), updatedAt: row.updated_at,
    };
  }
}

export const connectorHealthService = new ConnectorHealthService();
