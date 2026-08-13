import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';

type Phase = 'initial' | 'rewrite';

const STOP_WORDS = new Set([
  '的', '了', '和', '与', '及', '或', '在', '是', '对', '为', '最新', '相关', '信息', '内容', '搜索', '研究',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'latest', 'search',
]);

function tokens(value: string): string[] {
  const normalized = String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const output: string[] = [];
  for (const word of normalized.split(/\s+/).filter(Boolean)) {
    if (/^[\p{Script=Han}]+$/u.test(word)) {
      if (word.length <= 4) output.push(word);
      for (let index = 0; index < word.length - 1; index++) output.push(word.slice(index, index + 2));
    } else if (word.length > 1) output.push(word);
  }
  return [...new Set(output.filter((item) => !STOP_WORDS.has(item)))];
}

function relevanceScore(query: string, goal: string, title: string, snippet: string): number {
  const queryTokens = tokens(query);
  const goalTokens = tokens(goal);
  const titleTokens = new Set(tokens(title));
  const bodyTokens = new Set(tokens(`${title} ${snippet}`));
  const queryHits = queryTokens.filter((token) => bodyTokens.has(token)).length;
  const titleHits = queryTokens.filter((token) => titleTokens.has(token)).length;
  const goalHits = goalTokens.filter((token) => bodyTokens.has(token)).length;
  const queryCoverage = queryHits / Math.max(1, queryTokens.length);
  const goalCoverage = goalHits / Math.max(1, Math.min(goalTokens.length, 8));
  return Math.min(1, queryCoverage * 0.65 + goalCoverage * 0.2 + Math.min(0.15, titleHits * 0.075));
}

function rewriteQuery(query: string, goal: string, rows: Array<{ title: string; snippet: string }>): string {
  const queryTokens = new Set(tokens(query));
  const resultFrequency = new Map<string, number>();
  for (const row of rows) {
    for (const token of new Set(tokens(`${row.title} ${row.snippet}`))) {
      resultFrequency.set(token, (resultFrequency.get(token) || 0) + 1);
    }
  }
  const additions = tokens(goal)
    .filter((token) => !queryTokens.has(token))
    .sort((left, right) => (resultFrequency.get(left) || 0) - (resultFrequency.get(right) || 0) || right.length - left.length)
    .slice(0, 2);
  const base = query.trim().replace(/\s+/g, ' ');
  return [...new Set([base, ...additions])].filter(Boolean).join(' ').slice(0, 120);
}

export class SearchRelevanceService {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  evaluate(workflowId: string, goal: string, phase: Phase, stepKeys: string[]): any {
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
    const configured: string[] = (() => {
      try { return JSON.parse(plan?.input_json || '{}').keywords || []; } catch { return []; }
    })();
    for (const provider of stepKeys.map((key) => key.split(':').at(-1) || '').filter(Boolean)) {
      for (const query of configured) {
        const key = `${provider}\u0000${query}`;
        if (!grouped.has(key)) grouped.set(key, []);
      }
    }

    const now = new Date().toISOString();
    const assessments = [...grouped.entries()].map(([key, results]) => {
      const [provider, query] = key.split('\u0000');
      const scored = results.map((row) => ({ ...row, score: relevanceScore(query, goal, row.title, row.snippet) }));
      const top = scored.slice(0, 10);
      const relevantCount = top.filter((row) => row.score >= 0.35).length;
      const averageScore = scored.reduce((sum, row) => sum + row.score, 0) / Math.max(1, scored.length);
      const precisionAt10 = relevantCount / Math.max(1, top.length);
      const status = !scored.length ? 'empty' : precisionAt10 >= 0.5 && averageScore >= 0.35 ? 'good' : 'weak';
      const rewrittenQuery = phase === 'initial' && status !== 'good' ? rewriteQuery(query, goal, results) : '';
      this.db.prepare(`INSERT INTO search_relevance_assessments
        (assessment_id,workflow_id,phase,provider,query,result_count,relevant_count,average_score,precision_at_10,status,rewritten_query,metrics_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(workflow_id,phase,provider,query) DO UPDATE SET
          result_count=excluded.result_count,relevant_count=excluded.relevant_count,average_score=excluded.average_score,
          precision_at_10=excluded.precision_at_10,status=excluded.status,rewritten_query=excluded.rewritten_query,
          metrics_json=excluded.metrics_json,created_at=excluded.created_at`)
        .run(crypto.randomUUID(), workflowId, phase, provider, query, scored.length, relevantCount, averageScore,
          precisionAt10, status, rewrittenQuery || null, JSON.stringify({ threshold: 0.35, runIds, topScores: top.map((row) => row.score) }), now);
      return { provider, query, resultCount: scored.length, relevantCount, averageScore, precisionAt10, status, rewrittenQuery };
    });
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
