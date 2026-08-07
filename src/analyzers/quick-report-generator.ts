import type { DatasetProfile } from './dataset-profiler';
import { renderDatasetProfile } from './dataset-profiler';
import { EvidenceSelector, evidenceSelector, type EvidenceSelection, type SelectedEvidence } from '../knowledge/evidence-selector';
import { modelService } from '../server/services/ModelService';
import { agentRepository } from '../server/services/AgentRepository';

export interface QuickAnalysisCoverage {
  mode: 'quick';
  collectedDocumentCount: number;
  statisticallyAnalyzedDocumentCount: number;
  qualitativelyAnalyzedDocumentCount: number;
  evidenceDocumentCount: number;
  evidenceChunkCount: number;
  citedDocumentCount: number;
  fullDatasetStatistics: true;
  partial: boolean;
}

export interface QuickReportRequest {
  threadId?: string;
  workflowId?: string;
  workflowGoal: string;
  reportName: string;
  userRequest: string;
  analysisGoals: string[];
  skillName?: string;
  skillInstructions?: string;
  datasetProfile: DatasetProfile;
  partial?: boolean;
  signal?: AbortSignal;
  onRetry?: (retryCount: number, maxRetries: number, delaySec: number, reason: string) => void;
  onStatus?: (status: { phase: 'web_search' | 'reasoning'; message: string; sources?: any[]; retrieval?: string; analysis_coverage?: any }) => void;
  onDelta?: (delta: string) => void;
}

export interface QuickReportResult {
  title: string;
  answer: string;
  sources: Array<{
    id: string;
    chunkId: string;
    documentId: string;
    title: string;
    source: string;
    kind: string;
    keyword?: string;
    subject: SelectedEvidence['subject'];
    sourceUrl?: string;
    excerpt: string;
    score: number;
    matchedQueries: string[];
    selectionReason: SelectedEvidence['selectionReason'];
  }>;
  coverage: QuickAnalysisCoverage;
  evidenceSelection: Omit<EvidenceSelection, 'evidence'>;
}

function citedSourceIds(answer: string, sourceIds: Set<string>): Set<string> {
  const cited = new Set<string>();
  for (const match of answer.matchAll(/\[([^\]]+)\]/gi)) {
    const inner = match[1].trim();
    const parts = inner.split(/[\s,;/&、，]+/).filter(Boolean);
    for (const part of parts) {
      const rangeMatch = part.match(/^S?(\d+)\s*[-–—]\s*S?(\d+)$/i);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (!isNaN(start) && !isNaN(end) && end >= start && end - start <= 50) {
          for (let i = start; i <= end; i++) {
            const id = `S${i}`;
            if (sourceIds.has(id)) cited.add(id);
          }
        }
      } else {
        const singleMatch = part.match(/^S?(\d+)$/i);
        if (singleMatch) {
          const id = `S${singleMatch[1]}`.toUpperCase();
          if (sourceIds.has(id)) cited.add(id);
        }
      }
    }
  }
  return cited;
}

export function buildQuickAnalysisCoverage(
  profile: DatasetProfile,
  evidence: SelectedEvidence[],
  answer: string,
  partial = false,
): QuickAnalysisCoverage {
  const documentIds = new Set(evidence.map((item) => item.documentId));
  const sourceDocuments = new Map(evidence.map((item) => [item.id.toUpperCase(), item.documentId]));
  const citedDocuments = new Set(
    [...citedSourceIds(answer, new Set(sourceDocuments.keys()))]
      .map((sourceId) => sourceDocuments.get(sourceId))
      .filter((documentId): documentId is string => Boolean(documentId)),
  );
  return {
    mode: 'quick',
    collectedDocumentCount: profile.documentCount,
    statisticallyAnalyzedDocumentCount: profile.documentCount,
    qualitativelyAnalyzedDocumentCount: documentIds.size,
    evidenceDocumentCount: documentIds.size,
    evidenceChunkCount: evidence.length,
    citedDocumentCount: citedDocuments.size,
    fullDatasetStatistics: true,
    partial,
  };
}

export function buildQuickReportBoundary(coverage: QuickAnalysisCoverage): string {
  const collectionState = coverage.partial ? '当前已入库' : '本任务已入库';
  const qualitative = coverage.qualitativelyAnalyzedDocumentCount === coverage.collectedDocumentCount
    ? `模型读取了全部 **${coverage.collectedDocumentCount}** 个文档`
    : `模型定性阅读了分层选取的 **${coverage.qualitativelyAnalyzedDocumentCount}** 个独立文档`;
  return [
    '> **数据范围说明**',
    `> ${collectionState} **${coverage.collectedDocumentCount}** 个去重文档，全部参与确定性统计；${qualitative}。报告中的数量、比例、分布、时间范围和字段覆盖来自全量统计，主题、观点、原因和建议来自代表性证据。`,
  ].join('\n');
}

export class QuickReportGenerator {
  constructor(
    private readonly selector: Pick<EvidenceSelector, 'select'> = evidenceSelector,
    private readonly model = modelService,
  ) {}

  async generate(request: QuickReportRequest): Promise<QuickReportResult> {
    const selection = this.selector.select({
      threadId: request.threadId,
      workflowId: request.workflowId,
      workflowGoal: request.workflowGoal,
      userRequest: request.userRequest,
      analysisGoals: request.analysisGoals,
      datasetProfile: request.datasetProfile,
    });
    const sources = selection.evidence.map((item) => ({
      id: item.id,
      chunkId: item.chunkId,
      documentId: item.documentId,
      title: item.title,
      source: item.source,
      kind: item.kind,
      keyword: item.keyword,
      subject: item.subject,
      sourceUrl: item.sourceUrl,
      excerpt: item.content.slice(0, 700),
      score: item.score,
      matchedQueries: item.matchedQueries,
      selectionReason: item.selectionReason,
    }));

    const initialCoverage = buildQuickAnalysisCoverage(request.datasetProfile, selection.evidence, '', Boolean(request.partial));
    const boundary = buildQuickReportBoundary(initialCoverage);
    const profile = this.model.getProfile(false);
    const draftMessageId = request.workflowId ? `draft-report-${request.workflowId}` : undefined;

    let accumulatedText = '';
    let lastDbUpdateMs = 0;
    let body: string;

    try {
      if (!profile.apiKeyConfigured) {
        body = [
          renderDatasetProfile(request.datasetProfile),
          '',
          '## 代表性证据',
          '',
          ...(sources.length
            ? sources.slice(0, 10).map((source) => `- [${source.id}] ${source.title}：${source.excerpt.slice(0, 180)}`)
            : ['- 知识库中没有检索到代表性证据。']),
          '',
          '当前未配置可用的 AI 模型，因此仅展示程序生成的全量统计与代表性证据。',
        ].join('\n');
      } else {
        const materials = {
          texts: [
            { label: '全部文档的确定性统计结果', content: JSON.stringify(request.datasetProfile) },
            ...sources.map((source) => ({
              label: `[${source.id}] ${source.title}`,
              content: [
                source.excerpt,
                `平台：${source.source}`,
                `类型：${source.kind}`,
                `主体：${source.subject.name || source.subject.id || '未知'} (${source.subject.type})`,
                source.keyword ? `关键词：${source.keyword}` : '',
                `选择原因：${source.selectionReason}`,
                `来源：${source.sourceUrl || source.source}`,
              ].filter(Boolean).join('\n'),
            })),
          ],
          images: [],
        };
        let emittedStatus = false;
        body = (await this.model.converse([{
          role: 'user',
          content: [
            `请生成“${request.reportName}”。`,
            `原任务：${request.workflowGoal}`,
            `用户本轮要求：${request.userRequest}`,
            request.analysisGoals.length
              ? `分析重点：${request.analysisGoals.join('、')}`
              : '分析方式：未预设分析维度，请根据实际采集证据动态归纳最有信息量的主题，不要根据行业关键词套用固定模板。',
            request.skillName ? `业务 Skill：${request.skillName}` : '',
            request.skillInstructions ? `业务分析规则：${request.skillInstructions}` : '',
            request.partial ? '任务仍在采集中，只能生成阶段性报告。' : '',
            '',
            '写作规则：',
            '1. 样本量、数量、比例、平台和类型分布、时间范围、字段覆盖、缺失率及数值指标，只能使用“全部文档的确定性统计结果”。',
            '2. 主题、观点、原因、风险、机会和建议只能根据代表性证据归纳，并在关键事实后标注 [S1] 格式来源。引用编号只能使用 [S1] 开始的有效证据编号，严禁把行业代码、数据主键或原始数字（如 100021）当作来源编号标注。',
            '3. 不得声称逐篇阅读了全部文档，不得根据代表性证据重新估算总体比例，不得补造资料中没有的字段。',
            '4. 明确区分数据发现、证据不足和建议；不要重复输出数据范围说明，也不要自行添加参考资料列表。',
          ].filter(Boolean).join('\n'),
        }], {
          materials,
          signal: request.signal,
          onRetry: request.onRetry,
          onDelta: (delta) => {
            if (!emittedStatus) {
              emittedStatus = true;
              try {
                request.onStatus?.({
                  phase: 'reasoning',
                  message: '',
                  sources,
                  retrieval: 'stratified_hybrid_rag',
                  analysis_coverage: initialCoverage,
                });
              } catch {}
            }
            accumulatedText += delta;
            if (request.threadId && draftMessageId) {
              const now = Date.now();
              if (now - lastDbUpdateMs > 100) {
                lastDbUpdateMs = now;
                try {
                  agentRepository.upsertDraftMessage(request.threadId, draftMessageId, 'analysis', accumulatedText, {
                    streaming: true,
                    plan_id: request.workflowId,
                    sources,
                    retrieval: 'stratified_hybrid_rag',
                    analysis_coverage: initialCoverage,
                  });
                } catch {}
              }
            }
            request.onDelta?.(delta);
          },
        })).trim();
      }
    } finally {
      if (request.threadId && draftMessageId) {
        try {
          agentRepository.deleteMessage(draftMessageId);
        } catch {}
      }
    }

    const coverage = buildQuickAnalysisCoverage(request.datasetProfile, selection.evidence, body, Boolean(request.partial));
    return {
      title: request.reportName,
      answer: body,
      sources,
      coverage,
      evidenceSelection: {
        targetDocumentCount: selection.targetDocumentCount,
        candidateDocumentCount: selection.candidateDocumentCount,
        selectedDocumentCount: selection.selectedDocumentCount,
        queries: selection.queries,
        preferredKinds: selection.preferredKinds,
        byPlatform: selection.byPlatform,
        byKind: selection.byKind,
      },
    };
  }
}

export const quickReportGenerator = new QuickReportGenerator();
