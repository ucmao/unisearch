import { knowledgeIndex, type KnowledgeSearchOptions } from './knowledge-index';
import { modelService } from '../server/services/ModelService';

export interface RagAnswer {
  answer: string;
  coverage?: AnalysisCoverage;
  sources: Array<{
    id: string;
    chunkId: string;
    documentId: string;
    title: string;
    source: string;
    kind: string;
    keyword?: string;
    subject: { type: string; id?: string; name?: string };
    sourceUrl?: string;
    excerpt: string;
    score: number;
  }>;
}

export interface AnalysisScope {
  mode: 'quick';
  collectedDocumentCount: number;
  partial?: boolean;
}

export interface AnalysisCoverage {
  mode: 'quick';
  collectedDocumentCount: number;
  qualitativelyAnalyzedDocumentCount: number;
  evidenceDocumentCount: number;
  evidenceChunkCount: number;
  citedDocumentCount: number;
  fullDatasetStatistics: false;
  partial: boolean;
}

export interface RagAnswerOptions extends KnowledgeSearchOptions {
  analysisScope?: AnalysisScope;
}

function citedSourceIds(answer: string, sourceIds: Set<string>): Set<string> {
  const cited = new Set<string>();
  for (const match of answer.matchAll(/\[(S\d+)\]/gi)) {
    const id = match[1].toUpperCase();
    if (sourceIds.has(id)) cited.add(id);
  }
  return cited;
}

export function buildAnalysisCoverage(
  scope: AnalysisScope,
  sources: RagAnswer['sources'],
  answer: string,
): AnalysisCoverage {
  const documentIds = new Set(sources.map((source) => source.documentId));
  const sourceDocumentIds = new Map(sources.map((source) => [source.id.toUpperCase(), source.documentId]));
  const citedDocuments = new Set(
    [...citedSourceIds(answer, new Set(sourceDocumentIds.keys()))]
      .map((sourceId) => sourceDocumentIds.get(sourceId))
      .filter((documentId): documentId is string => Boolean(documentId)),
  );
  return {
    mode: scope.mode,
    collectedDocumentCount: Math.max(0, Math.round(scope.collectedDocumentCount)),
    qualitativelyAnalyzedDocumentCount: documentIds.size,
    evidenceDocumentCount: documentIds.size,
    evidenceChunkCount: sources.length,
    citedDocumentCount: citedDocuments.size,
    fullDatasetStatistics: false,
    partial: Boolean(scope.partial),
  };
}

export function buildAnalysisBoundary(coverage: AnalysisCoverage): string {
  const collectionState = coverage.partial ? '当前已入库' : '本任务已入库';
  const readScope = coverage.qualitativelyAnalyzedDocumentCount === coverage.collectedDocumentCount
    ? `模型读取了全部 **${coverage.collectedDocumentCount}** 个文档`
    : `模型实际读取 **${coverage.qualitativelyAnalyzedDocumentCount}** 个独立文档（${coverage.evidenceChunkCount} 个知识片段），并未逐篇分析全部文档`;
  return [
    '> **数据范围说明**',
    `> ${collectionState} **${coverage.collectedDocumentCount}** 个去重文档；本次为快速分析，${readScope}。当前阶段尚未执行全量统计；除入库总量外，报告中的数量、比例和分布仅描述本次读取的材料，不能视为全部数据的统计结果。`,
  ].join('\n');
}

export function buildReferencesSection(sources: RagAnswer['sources']): string {
  if (!sources || sources.length === 0) return '';

  const listItems = sources.map((s, idx) => {
    const title = (s.title || '未命名资料').replace(/\r?\n/g, ' ');
    const link = s.sourceUrl ? `[${title}](${s.sourceUrl})` : `${title} [${s.id}]`;
    return `${idx + 1}. ${link} · ${s.source}/${s.kind}`;
  });

  return [
    '',
    '<details>',
    `<summary>检索知识库，参考 ${sources.length} 篇资料 ›</summary>`,
    '',
    ...listItems,
    '</details>',
  ].join('\n');
}

export class RagService {
  constructor(
    private readonly index = knowledgeIndex,
    private readonly model = modelService,
  ) {}

  async answer(
    question: string,
    options: RagAnswerOptions = {},
    onDelta?: (delta: string) => void,
  ): Promise<RagAnswer> {
    const { analysisScope, ...searchOptions } = options;
    const results = this.index.search(question, { ...searchOptions, limit: searchOptions.limit || 8 });
    const sources = results.map((result, index) => ({
      id: `S${index + 1}`,
      chunkId: result.chunkId,
      documentId: result.documentId,
      title: result.title || '未命名资料',
      source: result.source,
      kind: result.kind,
      keyword: result.keyword,
      subject: result.subject,
      sourceUrl: result.sourceUrl,
      excerpt: result.content.slice(0, 500),
      score: result.score,
    }));
    if (!sources.length) {
      const rawAnswer = '知识库中没有检索到可以支持回答的资料。';
      const coverage = analysisScope ? buildAnalysisCoverage(analysisScope, [], rawAnswer) : undefined;
      return {
        answer: coverage ? `${buildAnalysisBoundary(coverage)}\n\n${rawAnswer}` : rawAnswer,
        ...(coverage ? { coverage } : {}),
        sources: [],
      };
    }

    const referencesSection = buildReferencesSection(sources);

    const profile = this.model.getProfile(false);
    if (!profile.apiKeyConfigured) {
      const rawAnswer = [
          '当前未配置可用的 AI 模型，因此先返回最相关的知识库片段：',
          '',
          ...sources.slice(0, 5).map((source) => `- [${source.id}] ${source.title}：${source.excerpt.slice(0, 180)}`),
          referencesSection,
        ].join('\n');
      const coverage = analysisScope ? buildAnalysisCoverage(analysisScope, sources, rawAnswer) : undefined;
      return {
        answer: coverage ? `${buildAnalysisBoundary(coverage)}\n\n${rawAnswer}` : rawAnswer,
        ...(coverage ? { coverage } : {}),
        sources,
      };
    }

    const materials = {
      texts: sources.map((source) => ({
        label: `[${source.id}] ${source.title}`,
        content: [
          source.excerpt,
          `平台：${source.source}`,
          `类型：${source.kind}`,
          `主体：${source.subject.name || source.subject.id || '未知'} (${source.subject.type})`,
          source.keyword ? `关键词：${source.keyword}` : '',
          `来源：${source.sourceUrl || source.source}`,
        ].filter(Boolean).join('\n'),
      })),
      images: [],
    };
    const scopeInstruction = analysisScope
      ? [
          `本任务${analysisScope.partial ? '当前' : ''}已入库 ${analysisScope.collectedDocumentCount} 个去重文档。`,
          `你实际收到的是 ${new Set(sources.map((source) => source.documentId)).size} 个独立文档、${sources.length} 个知识片段。`,
          '这是快速抽样分析，不是全量统计。不得声称逐篇分析了全部文档；不得把证据材料中的计数、比例或平台分布表述为全部数据的统计结果。',
        ].join('\n')
      : '';
    if (analysisScope && onDelta) {
      const initialCoverage = buildAnalysisCoverage(analysisScope, sources, '');
      onDelta(`${buildAnalysisBoundary(initialCoverage)}\n\n`);
    }
    const rawAnswer = await this.model.converse([
      {
        role: 'user',
        content: `${question}\n\n${scopeInstruction ? `${scopeInstruction}\n\n` : ''}请只根据提供的知识库资料回答。每个关键事实后使用 [S1]、[S2] 格式标注来源；资料不足时明确说明，不要补造。`,
      },
    ], { materials, onDelta });

    const answer = rawAnswer.trim();
    const coverage = analysisScope ? buildAnalysisCoverage(analysisScope, sources, answer) : undefined;
    return {
      answer: coverage ? `${buildAnalysisBoundary(coverage)}\n\n${answer}` : answer,
      ...(coverage ? { coverage } : {}),
      sources,
    };
  }
}

export const ragService = new RagService();
