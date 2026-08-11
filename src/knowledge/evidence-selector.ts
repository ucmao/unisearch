import type { DatasetProfile } from '../analyzers/dataset-profiler';
import { knowledgeIndex, type KnowledgeRetrievalMode, type KnowledgeSearchResult } from './knowledge-index';

export type EvidenceSelectionReason = 'high_relevance' | 'preferred_type' | 'platform_representative' | 'kind_representative';

export interface SelectedEvidence {
  id: string;
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  source: string;
  kind: string;
  keyword?: string;
  subject: KnowledgeSearchResult['subject'];
  sourceUrl?: string;
  score: number;
  matchedQueries: string[];
  selectionReason: EvidenceSelectionReason;
}

export interface EvidenceSelection {
  targetDocumentCount: number;
  candidateDocumentCount: number;
  selectedDocumentCount: number;
  queries: string[];
  preferredKinds: string[];
  byPlatform: Record<string, number>;
  byKind: Record<string, number>;
  retrievalMode: KnowledgeRetrievalMode;
  retrievalWarnings: string[];
  evidence: SelectedEvidence[];
}

export interface EvidenceSelectionRequest {
  threadId?: string;
  workflowId?: string;
  workflowGoal: string;
  userRequest: string;
  analysisGoals: string[];
  datasetProfile: DatasetProfile;
}

interface RankedDocument {
  documentId: string;
  best: KnowledgeSearchResult;
  score: number;
  matchedQueries: Set<string>;
  chunkScores: Map<string, number>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function dynamicEvidenceDocumentLimit(documentCount: number): number {
  if (documentCount <= 0) return 0;
  return Math.min(documentCount, clamp(Math.round(Math.sqrt(documentCount) * 1.5), 12, 30));
}

function cleanQuery(value: string): string {
  return value
    .replace(/^(?:分析目标|原任务|任务|请|帮我|请根据|请分析)[:：\s]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export function decomposeEvidenceQueries(request: Pick<EvidenceSelectionRequest, 'workflowGoal' | 'userRequest' | 'analysisGoals'>): string[] {
  const raw = [
    ...request.analysisGoals,
    ...request.userRequest.split(/[\n。；;!?！？]+/),
    request.workflowGoal,
  ];
  const queries: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = cleanQuery(item);
    if (value.length < 2) continue;
    const normalized = value.toLocaleLowerCase();
    if (seen.has(normalized) || /^(?:分析|总结|分析这些结果|分析当前结果)$/.test(value)) continue;
    seen.add(normalized);
    queries.push(value);
    if (queries.length >= 8) break;
  }
  return queries.length ? queries : ['主要发现'];
}

export function inferPreferredKinds(queries: string[]): string[] {
  const text = queries.join(' ');
  const kinds = new Set<string>();
  if (/薪资|薪酬|工资|月薪|年薪|招聘|职位|岗位|学历|经验要求/i.test(text)) kinds.add('job');
  if (/投诉|退款|维权|风险|负面|售后|纠纷/i.test(text)) {
    kinds.add('complaint');
    kinds.add('comment');
  }
  if (/评论|用户诉求|用户反馈|口碑|观点|情绪/i.test(text)) kinds.add('comment');
  if (/内容|选题|表达|互动|热度|爆款|视频|帖子/i.test(text)) {
    kinds.add('post');
    kinds.add('video');
  }
  if (/AI回答|AI 回答|问答平台|GEO|品牌可见性/i.test(text)) kinds.add('ai_answer');
  return [...kinds];
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
}

export class EvidenceSelector {
  constructor(private readonly index: Pick<typeof knowledgeIndex, 'searchDetailed'> = knowledgeIndex) {}

  async select(request: EvidenceSelectionRequest): Promise<EvidenceSelection> {
    const targetDocumentCount = dynamicEvidenceDocumentLimit(request.datasetProfile.documentCount);
    const queries = decomposeEvidenceQueries(request);
    const preferredKinds = inferPreferredKinds(queries);
    if (!targetDocumentCount) {
      return {
        targetDocumentCount: 0,
        candidateDocumentCount: 0,
        selectedDocumentCount: 0,
        queries,
        preferredKinds,
        byPlatform: {},
        byKind: {},
        retrievalMode: 'lexical',
        retrievalWarnings: [],
        evidence: [],
      };
    }

    const candidateLimit = Math.min(50, Math.max(30, targetDocumentCount * 3));
    const documents = new Map<string, RankedDocument>();
    const retrievalModes = new Set<KnowledgeRetrievalMode>();
    const retrievalWarnings = new Set<string>();
    for (const query of queries) {
      const search = await this.index.searchDetailed(query, {
        threadId: request.threadId,
        workflowId: request.workflowId,
        limit: candidateLimit,
      });
      retrievalModes.add(search.mode);
      if (search.warning) retrievalWarnings.add(search.warning);
      const results = search.items;
      results.forEach((result, rank) => {
        const rankScore = 1 / (rank + 1);
        const current = documents.get(result.documentId) || {
          documentId: result.documentId,
          best: result,
          score: 0,
          matchedQueries: new Set<string>(),
          chunkScores: new Map<string, number>(),
        };
        current.matchedQueries.add(query);
        current.chunkScores.set(result.chunkId, (current.chunkScores.get(result.chunkId) || 0) + rankScore);
        const bestChunkScore = current.chunkScores.get(current.best.chunkId) || 0;
        const candidateChunkScore = current.chunkScores.get(result.chunkId) || 0;
        if (candidateChunkScore > bestChunkScore) current.best = result;
        current.score += rankScore;
        documents.set(result.documentId, current);
      });
    }

    const preferred = new Set(preferredKinds);
    const ranked = [...documents.values()]
      .map((document) => ({
        ...document,
        score: document.score
          + Math.max(0, document.matchedQueries.size - 1) * 0.2
          + (preferred.has(document.best.kind) ? 0.75 : 0),
      }))
      .sort((left, right) => right.score - left.score || left.documentId.localeCompare(right.documentId));

    const selected = new Map<string, { document: RankedDocument; reason: EvidenceSelectionReason }>();
    const add = (document: RankedDocument, reason: EvidenceSelectionReason): boolean => {
      if (selected.size >= targetDocumentCount || selected.has(document.documentId)) return false;
      selected.set(document.documentId, { document, reason });
      return true;
    };

    if (preferred.size) {
      const preferredQuota = Math.ceil(targetDocumentCount * 0.65);
      for (const document of ranked.filter((item) => preferred.has(item.best.kind))) {
        add(document, 'preferred_type');
        if (selected.size >= preferredQuota) break;
      }
    }

    const platformQuota = Math.ceil(targetDocumentCount * 0.3);
    const representedPlatforms = new Set([...selected.values()].map(({ document }) => document.best.source));
    for (const document of ranked) {
      if (representedPlatforms.size >= platformQuota) break;
      if (representedPlatforms.has(document.best.source)) continue;
      if (add(document, 'platform_representative')) representedPlatforms.add(document.best.source);
    }

    const kindQuota = Math.ceil(targetDocumentCount * 0.2);
    const representedKinds = new Set([...selected.values()].map(({ document }) => document.best.kind));
    for (const document of ranked) {
      if (representedKinds.size >= kindQuota) break;
      if (representedKinds.has(document.best.kind)) continue;
      if (add(document, 'kind_representative')) representedKinds.add(document.best.kind);
    }

    for (const document of ranked) add(document, 'high_relevance');

    const evidence = [...selected.values()].map(({ document, reason }, index) => ({
      id: `S${index + 1}`,
      chunkId: document.best.chunkId,
      documentId: document.documentId,
      title: document.best.title || '未命名资料',
      content: document.best.content,
      source: document.best.source,
      kind: document.best.kind,
      keyword: document.best.keyword,
      subject: document.best.subject,
      sourceUrl: document.best.sourceUrl,
      score: document.score,
      matchedQueries: [...document.matchedQueries],
      selectionReason: reason,
    }));
    const retrievalMode: KnowledgeRetrievalMode = retrievalModes.has('hybrid_reranked')
      ? 'hybrid_reranked'
      : retrievalModes.has('hybrid')
        ? 'hybrid'
        : retrievalModes.has('semantic')
          ? 'semantic'
          : 'lexical';
    return {
      targetDocumentCount,
      candidateDocumentCount: documents.size,
      selectedDocumentCount: evidence.length,
      queries,
      preferredKinds,
      byPlatform: counts(evidence.map((item) => item.source)),
      byKind: counts(evidence.map((item) => item.kind)),
      retrievalMode,
      retrievalWarnings: [...retrievalWarnings],
      evidence,
    };
  }
}

export const evidenceSelector = new EvidenceSelector();
