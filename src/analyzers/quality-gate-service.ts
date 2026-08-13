import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import type { CanonicalDocument } from '../core/documents/canonical';
import { getDb } from '../database/connection';
import { AnalyticsRepository } from '../database/repository';

export interface QualityGateResult {
  assessmentId: string;
  phase: 'enrichment' | 'final';
  status: 'ready' | 'limited' | 'insufficient';
  documentCount: number;
  qualifiedCount: number;
  missingTextCount: number;
  missingUrlCount: number;
  missingCommentCount: number;
  enrichmentTargetCount: number;
  targets: string[];
  warnings: string[];
  metrics: Record<string, number>;
}

function bodyLength(document: CanonicalDocument): number {
  return `${document.title}\n${document.summary}\n${document.markdown}`.replace(/\s+/g, ' ').trim().length;
}

export class QualityGateService {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  assess(input: {
    workflowId: string;
    runId?: string;
    platform?: string;
    phase: 'enrichment' | 'final';
    requireComments?: boolean;
    maxTargets?: number;
    minTextChars?: number;
  }): QualityGateResult {
    const repository = new AnalyticsRepository(this.databaseProvider);
    const documents = repository.queryDocuments({
      ...(input.runId ? { run_id: input.runId } : { workflow_id: input.workflowId }),
      page_size: 1_000_000,
    }).items;
    const nonComments = documents.filter((document) => document.kind !== 'comment');
    const enrichedDocuments = nonComments.filter((document) => document.kind !== 'search_result');
    const primary = enrichedDocuments.length ? enrichedDocuments : nonComments;
    const commentsByParent = new Set(documents.filter((document) => document.kind === 'comment').map((document) => document.parentSourceItemId).filter(Boolean));
    const minTextChars = Math.max(40, input.minTextChars || 120);
    const missingText = primary.filter((document) => bodyLength(document) < minTextChars);
    const missingUrl = primary.filter((document) => !document.sourceUrl);
    const missingComments = input.requireComments
      ? primary.filter((document) => Number(document.metrics.comments || 0) > 0
        && Boolean(document.sourceItemId)
        && !commentsByParent.has(document.sourceItemId))
      : [];
    const deficientIds = new Set([...missingText, ...missingUrl, ...missingComments].map((document) => document.documentId));
    const candidates = primary.filter((document) => deficientIds.has(document.documentId) && document.sourceUrl);
    const targets = [...new Set(candidates.map((document) => document.sourceUrl).filter((value): value is string => Boolean(value)))]
      .slice(0, Math.max(0, input.maxTargets ?? 20));
    const qualifiedCount = Math.max(0, primary.length - deficientIds.size);
    const textCoverage = primary.length ? 1 - missingText.length / primary.length : 0;
    const urlCoverage = primary.length ? 1 - missingUrl.length / primary.length : 0;
    const commentCoverage = input.requireComments && missingComments.length
      ? Math.max(0, 1 - missingComments.length / Math.max(1, primary.filter((document) => Number(document.metrics.comments || 0) > 0).length))
      : 1;
    const status: QualityGateResult['status'] = primary.length < 3 || textCoverage < 0.5
      ? 'insufficient'
      : textCoverage < 0.8 || urlCoverage < 0.7 || commentCoverage < 0.5
        ? 'limited'
        : 'ready';
    const warnings: string[] = [];
    if (primary.length < 3) warnings.push(`有效正文样本仅 ${primary.length} 条，不足以支持稳定的总体结论`);
    if (missingText.length) warnings.push(`${missingText.length} 条内容正文不足`);
    if (missingUrl.length) warnings.push(`${missingUrl.length} 条内容缺少可回溯来源链接`);
    if (missingComments.length) warnings.push(`${missingComments.length} 条高评论内容未取得评论文本`);
    const result: QualityGateResult = {
      assessmentId: crypto.randomUUID(), phase: input.phase, status,
      documentCount: primary.length, qualifiedCount,
      missingTextCount: missingText.length, missingUrlCount: missingUrl.length,
      missingCommentCount: missingComments.length, enrichmentTargetCount: targets.length,
      targets, warnings, metrics: { textCoverage, urlCoverage, commentCoverage },
    };
    this.db.prepare(`INSERT INTO quality_gate_runs
      (assessment_id,workflow_id,run_id,platform,phase,status,document_count,qualified_count,missing_text_count,
       missing_url_count,missing_comment_count,enrichment_target_count,metrics_json,warnings_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      result.assessmentId, input.workflowId, input.runId || null, input.platform || null, input.phase, result.status,
      result.documentCount, result.qualifiedCount, result.missingTextCount, result.missingUrlCount,
      result.missingCommentCount, result.enrichmentTargetCount, JSON.stringify(result.metrics), JSON.stringify(result.warnings), new Date().toISOString(),
    );
    return result;
  }

  latestFinal(workflowId: string): QualityGateResult | null {
    const row = this.db.prepare("SELECT * FROM quality_gate_runs WHERE workflow_id=? AND phase='final' ORDER BY created_at DESC LIMIT 1").get(workflowId) as any;
    if (!row) return null;
    return {
      assessmentId: row.assessment_id, phase: row.phase, status: row.status,
      documentCount: row.document_count, qualifiedCount: row.qualified_count,
      missingTextCount: row.missing_text_count, missingUrlCount: row.missing_url_count,
      missingCommentCount: row.missing_comment_count, enrichmentTargetCount: row.enrichment_target_count,
      targets: [], warnings: JSON.parse(row.warnings_json), metrics: JSON.parse(row.metrics_json),
    };
  }

  latestForScope(scope: { workflowId?: string; threadId?: string; runId?: string }): QualityGateResult | null {
    if (scope.workflowId) return this.latestFinal(scope.workflowId);
    const row = scope.runId
      ? this.db.prepare("SELECT workflow_id FROM crawl_runs WHERE run_id=?").get(scope.runId) as any
      : scope.threadId
        ? this.db.prepare("SELECT workflow_id FROM workflow_runs WHERE thread_id=? ORDER BY created_at DESC LIMIT 1").get(scope.threadId) as any
        : this.db.prepare("SELECT workflow_id FROM quality_gate_runs WHERE phase='final' ORDER BY created_at DESC LIMIT 1").get() as any;
    return row?.workflow_id ? this.latestFinal(row.workflow_id) : null;
  }
}

export const qualityGateService = new QualityGateService();
