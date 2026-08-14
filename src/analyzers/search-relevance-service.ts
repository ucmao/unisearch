import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';
import { modelService } from '../server/services/ModelService';

type Phase = 'initial' | 'rewrite';

const STOP_WORDS = new Set([
  '的', '了', '和', '与', '及', '或', '在', '是', '对', '为', '最新', '相关', '信息', '内容', '搜索', '研究',
  '多引擎', '引擎', '平台', '采集', '抓取', '分析', '调研',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'latest', 'search',
]);

const PROHIBITED_WORDS = /(?:采集|抓取|搜索|爬虫|百度|360|搜狗|神马|中国搜索|头条|必应|多引擎|引擎|平台|任务|分析)/i;

export function extractTokens(value: string): string[] {
  const normalized = String(value || '').toLocaleLowerCase().trim();
  if (!normalized) return [];

  const output: string[] = [];
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    try {
      const segmenter = new (Intl as any).Segmenter('zh-CN', { granularity: 'word' });
      for (const seg of segmenter.segment(normalized)) {
        const word = seg.segment.trim().replace(/[^\p{L}\p{N}]+/gu, '');
        if (word.length >= 2 && !STOP_WORDS.has(word)) {
          output.push(word);
        }
      }
    } catch {
      // fallback to regex word extraction below
    }
  }

  if (!output.length) {
    const cleaned = normalized.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    for (const word of cleaned.split(/\s+/).filter(Boolean)) {
      if (word.length >= 2 && !STOP_WORDS.has(word)) output.push(word);
    }
  }

  return [...new Set(output)];
}

export function validateExpandedQuery(query: string, originalQuery: string): boolean {
  const q = String(query || '').trim().replace(/\s+/g, ' ');
  if (!q || q.length < 2 || q.length > 50) return false;
  if (q.toLowerCase() === originalQuery.toLowerCase()) return false;
  if (PROHIBITED_WORDS.test(q)) return false;
  // Disallow pure punctuation, numbers or symbols
  if (/^[\p{P}\p{S}\s\d]+$/u.test(q)) return false;
  return true;
}

function relevanceScore(query: string, goal: string, title: string, snippet: string): number {
  const queryTokens = extractTokens(query);
  const goalTokens = extractTokens(goal);
  const titleTokens = new Set(extractTokens(title));
  const bodyTokens = new Set(extractTokens(`${title} ${snippet}`));
  const queryHits = queryTokens.filter((token) => bodyTokens.has(token)).length;
  const titleHits = queryTokens.filter((token) => titleTokens.has(token)).length;
  const goalHits = goalTokens.filter((token) => bodyTokens.has(token)).length;
  const queryCoverage = queryHits / Math.max(1, queryTokens.length);
  const goalCoverage = goalHits / Math.max(1, Math.min(goalTokens.length, 8));
  const queryWeight = queryCoverage >= 0.6 ? queryCoverage * 0.55 : queryCoverage * 0.4;
  const titleBonus = titleHits === queryTokens.length && queryTokens.length > 0 ? 0.15 : (titleHits / Math.max(1, queryTokens.length)) * 0.05;
  return Math.min(1, queryWeight + goalCoverage * 0.3 + titleBonus);
}

export class SearchRelevanceService {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  private async generateSemanticExpansion(
    query: string,
    goal: string,
    results: Array<{ title: string; snippet: string }>,
    maxCount: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const snippets = results.slice(0, 3).map((r) => `${r.title}: ${r.snippet}`);
    try {
      const candidates = await modelService.expandSearchQueries({
        originalQuery: query,
        goal,
        snippets,
        maxCount,
      }, signal);

      for (const c of candidates) {
        if (c?.query && validateExpandedQuery(c.query, query)) {
          return c.query.trim().slice(0, 50);
        }
      }
    } catch {
      // LLM failure or unconfigured model
    }

    // Heuristic fallback for offline/test environments: extract key goal entities
    const queryTokens = new Set(extractTokens(query));
    const goalTokens = extractTokens(goal).filter((t) => !queryTokens.has(t) && !PROHIBITED_WORDS.test(t));
    if (goalTokens.length > 0) {
      const candidate = `${query} ${goalTokens.slice(0, 2).join(' ')}`.trim();
      if (validateExpandedQuery(candidate, query)) {
        return candidate;
      }
    }

    return '';
  }

  async evaluate(
    workflowId: string,
    goal: string,
    phase: Phase,
    stepKeys: string[],
    signal?: AbortSignal,
  ): Promise<any> {
    const runIds = stepKeys.flatMap((stepKey) => {
      const row = this.db.prepare('SELECT output_json FROM workflow_steps WHERE workflow_id=? AND step_key=?')
        .get(workflowId, stepKey) as { output_json?: string } | undefined;
      try {
        const runId = JSON.parse(row?.output_json || '{}').runId;
        return runId ? [String(runId)] : [];
      } catch { return []; }
    });
    if (!runIds.length) return { phase, assessments: [], rewrittenByProvider: {}, rewriteCount: 0 };
    const placeholders = runIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT provider, query, rank, title, snippet, source_url
      FROM search_discoveries WHERE run_id IN (${placeholders})
      ORDER BY provider, query, COALESCE(rank, 2147483647)
    `).all(...runIds) as Array<{ provider: string; query: string; rank: number | null; title: string; snippet: string; source_url: string }>;
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.provider}\u0000${row.query}`;
      grouped.set(key, [...(grouped.get(key) || []), row]);
    }
    const plan = this.db.prepare('SELECT input_json FROM workflow_runs WHERE workflow_id=?').get(workflowId) as any;
    const parsedPlan = (() => {
      try { return JSON.parse(plan?.input_json || '{}'); } catch { return {}; }
    })();
    const configured: string[] = Array.isArray(parsedPlan.keywords) ? parsedPlan.keywords : [];
    const expansionMode: 'strict' | 'fallback' | 'broad' = parsedPlan.queryExpansion?.mode || 'fallback';
    const maxQueriesPerKeyword = Math.max(1, Math.min(Number(parsedPlan.queryExpansion?.maxQueriesPerKeyword) || 2, 3));

    for (const provider of stepKeys.map((key) => key.split(':').at(-1) || '').filter(Boolean)) {
      for (const query of configured) {
        const key = `${provider}\u0000${query}`;
        if (!grouped.has(key)) grouped.set(key, []);
      }
    }

    const now = new Date().toISOString();
    const assessments: Array<{
      provider: string;
      query: string;
      resultCount: number;
      relevantCount: number;
      averageScore: number;
      precisionAt10: number;
      status: string;
      rewrittenQuery: string;
    }> = [];

    for (const [key, results] of grouped.entries()) {
      const [provider, query] = key.split('\u0000');
      const scored = results.map((row) => ({ ...row, score: relevanceScore(query, goal, row.title, row.snippet) }));
      const top = scored.slice(0, 10);
      const relevantCount = top.filter((row) => row.score >= 0.35).length;
      const averageScore = scored.reduce((sum, row) => sum + row.score, 0) / Math.max(1, scored.length);
      const precisionAt10 = relevantCount / Math.max(1, top.length);
      const status = !scored.length ? 'empty' : precisionAt10 >= 0.5 && averageScore >= 0.35 ? 'good' : 'weak';

      let rewrittenQuery = '';
      if (phase === 'initial' && expansionMode !== 'strict') {
        const needsExpansion = expansionMode === 'broad' || status !== 'good';
        if (needsExpansion) {
          rewrittenQuery = await this.generateSemanticExpansion(query, goal, results, maxQueriesPerKeyword, signal);
        }
      }

      this.db.prepare(`INSERT INTO search_relevance_assessments
        (assessment_id,workflow_id,phase,provider,query,result_count,relevant_count,average_score,precision_at_10,status,rewritten_query,metrics_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(workflow_id,phase,provider,query) DO UPDATE SET
          result_count=excluded.result_count,relevant_count=excluded.relevant_count,average_score=excluded.average_score,
          precision_at_10=excluded.precision_at_10,status=excluded.status,rewritten_query=excluded.rewritten_query,
          metrics_json=excluded.metrics_json,created_at=excluded.created_at`)
        .run(crypto.randomUUID(), workflowId, phase, provider, query, scored.length, relevantCount, averageScore,
          precisionAt10, status, rewrittenQuery || null, JSON.stringify({ threshold: 0.35, runIds, topScores: top.map((row) => row.score) }), now);

      assessments.push({ provider, query, resultCount: scored.length, relevantCount, averageScore, precisionAt10, status, rewrittenQuery });
    }

    const rewrittenByProvider: Record<string, string[]> = {};
    for (const item of assessments) {
      if (!item.rewrittenQuery || item.rewrittenQuery === item.query) continue;
      rewrittenByProvider[item.provider] ||= [];
      if (!rewrittenByProvider[item.provider].includes(item.rewrittenQuery)) rewrittenByProvider[item.provider].push(item.rewrittenQuery);
    }
    return { phase, assessments, rewrittenByProvider, rewriteCount: Object.values(rewrittenByProvider).flat().length };
  }

  list(workflowId: string): any[] {
    return (this.db.prepare(`SELECT * FROM search_relevance_assessments WHERE workflow_id=? ORDER BY created_at, provider, query`)
      .all(workflowId) as any[]).map((row) => ({
      assessmentId: row.assessment_id, workflowId: row.workflow_id, phase: row.phase, provider: row.provider,
      query: row.query, resultCount: Number(row.result_count), relevantCount: Number(row.relevant_count),
      averageScore: Number(row.average_score), precisionAt10: Number(row.precision_at_10), status: row.status,
      rewrittenQuery: row.rewritten_query, createdAt: row.created_at,
    }));
  }
}

export const searchRelevanceService = new SearchRelevanceService();
