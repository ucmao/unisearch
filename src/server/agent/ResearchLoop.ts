import type { DirectWebReadResult } from '../services/DirectWebReadService';
import type { SearchEvidence } from '../services/LiveSearchService';
import { modelService } from '../services/ModelService';
import { agentToolExecutor, type KnowledgeToolEvidence } from './AgentTools';
import type { AgentRunTrace, AgentToolExecutor } from './AgentToolRegistry';
import type { ResearchEvidence, ResearchLoopState, ResearchStepDecision } from './ResearchTypes';

export interface ResearchLoopModel {
  decideResearchStep(
    question: string,
    evidence: ResearchEvidence[],
    state: ResearchLoopState,
    signal?: AbortSignal,
  ): Promise<ResearchStepDecision>;
  answerResearch(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    evidence: ResearchEvidence[],
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
  ): Promise<string>;
}

export interface ResearchLoopResult {
  answer: string;
  evidence: ResearchEvidence[];
  sources: Array<{ id: string; title: string; source: string; sourceUrl?: string; fetchedAt: string }>;
  stopReason: string;
  steps: number;
}

const EXPLICIT_RESEARCH = /(?:深入|深度)(?:研究|调研|查证|核验)|多来源(?:对比|核验|研究|查证)|交叉(?:验证|核验)|证据(?:冲突|核验)|全面(?:核实|查证)/i;
const COLLECTION_ACTION = /采集|收集|抓取|监测|批量|导出|下载/i;

export function shouldUseExperimentalResearchLoop(
  text: string,
  context: { mentionedConnectors?: string[]; mentionedSkills?: string[] } = {},
): boolean {
  return EXPLICIT_RESEARCH.test(text)
    && !COLLECTION_ACTION.test(text)
    && !(context.mentionedConnectors?.length || context.mentionedSkills?.length);
}

function normalizedUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

function evidenceKey(value: Pick<ResearchEvidence, 'sourceUrl' | 'key'>): string {
  return normalizedUrl(value.sourceUrl) || value.key;
}

export class ResearchLoop {
  constructor(
    private readonly model: ResearchLoopModel = modelService,
    private readonly executor: AgentToolExecutor = agentToolExecutor,
    private readonly now: () => number = Date.now,
  ) {}

  async run(
    question: string,
    options: {
      threadId: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      trace: AgentRunTrace;
      signal?: AbortSignal;
      onDelta?: (delta: string) => void;
      maxSteps?: number;
      timeoutMs?: number;
    },
  ): Promise<ResearchLoopResult> {
    const started = this.now();
    const maxSteps = Math.max(1, Math.min(5, options.maxSteps || 5));
    const timeoutMs = Math.max(5_000, Math.min(60_000, options.timeoutMs || 60_000));
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const operationSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    const evidence = new Map<string, ResearchEvidence>();
    const discoveredUrls = new Set(
      Array.from(question.matchAll(/https?:\/\/[^\s，。；;]+/g), (match) => normalizedUrl(match[0])),
    );
    let searchCalls = 0;
    let readUrls = 0;
    let consecutiveNoEvidence = 0;
    let stopReason = '达到最大步数';
    let steps = 0;

    const addEvidence = (items: ResearchEvidence[]): number => {
      let changed = 0;
      for (const item of items) {
        const key = evidenceKey(item);
        const current = evidence.get(key);
        if (!current || item.excerpt.length > current.excerpt.length) {
          evidence.set(key, { ...item, key });
          changed++;
        }
      }
      return changed;
    };

    for (let step = 1; step <= maxSteps; step++) {
      operationSignal.throwIfAborted();
      const elapsedMs = this.now() - started;
      if (elapsedMs >= timeoutMs) {
        stopReason = `达到 ${Math.round(timeoutMs / 1_000)} 秒时间上限`;
        break;
      }
      const state: ResearchLoopState = {
        step,
        maxSteps,
        searchCalls,
        maxSearchCalls: 3,
        readUrls,
        maxReadUrls: 5,
        consecutiveNoEvidence,
        elapsedMs,
      };
      const decision = await this.model.decideResearchStep(question, [...evidence.values()], state, operationSignal);
      steps = step;
      if (decision.action === 'finish') {
        stopReason = decision.reason || '模型判断证据已经足够';
        options.trace.recordLoopStep(step, 'finish', stopReason, 0);
        break;
      }

      let newEvidence = 0;
      if (decision.action === 'knowledge_query') {
        const results = await this.executor.execute<
          { query: string; limit?: number; scope?: 'global' | 'thread' }, KnowledgeToolEvidence[]
        >('knowledge_query', { query: decision.query || question, limit: 8, scope: 'global' }, {
          threadId: options.threadId, signal: operationSignal,
        }, options.trace);
        results.forEach((item) => discoveredUrls.add(normalizedUrl(item.sourceUrl)));
        newEvidence = addEvidence(results.map((item) => ({
          id: '', key: `knowledge:${item.documentId}:${item.chunkId}`, title: item.title,
          excerpt: item.content, source: item.source, sourceUrl: item.sourceUrl, evidenceType: 'knowledge' as const,
        })));
      } else if (decision.action === 'live_search') {
        if (searchCalls >= 3) {
          stopReason = '达到搜索次数上限';
          options.trace.recordLoopStep(step, decision.action, stopReason, 0);
          break;
        }
        searchCalls++;
        const results = await this.executor.execute<
          { query: string; limit?: number; readMode?: 'snippet' | 'auto'; maxReadItems?: number }, SearchEvidence[]
        >('live_search', { query: decision.query || question, limit: 8, readMode: 'snippet', maxReadItems: 0 }, {
          threadId: options.threadId, signal: operationSignal,
        }, options.trace);
        results.forEach((item) => discoveredUrls.add(normalizedUrl(item.sourceUrl)));
        newEvidence = addEvidence(results.map((item) => ({
          id: '', key: normalizedUrl(item.sourceUrl), title: item.title, excerpt: item.excerpt,
          source: item.source, sourceUrl: item.sourceUrl, publishedAt: item.publishedAt, evidenceType: 'search' as const,
        })));
      } else if (decision.action === 'direct_web_read') {
        const urls = Array.from(new Set((decision.urls || []).map(normalizedUrl)))
          .filter((url) => discoveredUrls.has(url))
          .slice(0, Math.max(0, Math.min(3, 5 - readUrls)));
        if (!urls.length) {
          consecutiveNoEvidence++;
          options.trace.recordLoopStep(step, decision.action, '没有可读取的已发现公开 URL', 0);
          if (consecutiveNoEvidence >= 2) { stopReason = '连续两步没有新增证据'; break; }
          continue;
        }
        readUrls += urls.length;
        const result = await this.executor.execute<
          { urls: string[]; timeoutMs?: number }, DirectWebReadResult
        >('direct_web_read', { urls, timeoutMs: 15_000 }, { threadId: options.threadId, signal: operationSignal }, options.trace);
        newEvidence = addEvidence(result.articles.map((item) => ({
          id: '', key: normalizedUrl(item.content_url), title: item.title, excerpt: item.description.slice(0, 8_000),
          source: item.site_name || 'web_reader', sourceUrl: item.content_url,
          publishedAt: item.published_at === undefined ? undefined : String(item.published_at), evidenceType: 'web_page' as const,
        })));
      }

      consecutiveNoEvidence = newEvidence > 0 ? 0 : consecutiveNoEvidence + 1;
      options.trace.recordLoopStep(step, decision.action, decision.reason, newEvidence);
      if (consecutiveNoEvidence >= 2) {
        stopReason = '连续两步没有新增证据';
        break;
      }
    }

    const finalizedEvidence = [...evidence.values()].slice(0, 20).map((item, index) => ({ ...item, id: `S${index + 1}` }));
    if (!finalizedEvidence.length) {
      stopReason = stopReason === '达到最大步数' ? '没有检索到可用证据' : stopReason;
      options.trace.finish(stopReason);
      return {
        answer: '这次没有检索到足以支持结论的本地或网页证据。可以换一个更具体的对象、时间范围或核验问题后重试。',
        evidence: [], sources: [], stopReason, steps,
      };
    }
    const answer = await this.model.answerResearch(options.messages, finalizedEvidence, operationSignal, options.onDelta);
    options.trace.finish(stopReason);
    const fetchedAt = new Date().toISOString();
    return {
      answer: answer.trim(),
      evidence: finalizedEvidence,
      sources: finalizedEvidence.map((item) => ({
        id: item.id, title: item.title, source: item.source, sourceUrl: item.sourceUrl, fetchedAt,
      })),
      stopReason,
      steps,
    };
  }
}

export const researchLoop = new ResearchLoop();
