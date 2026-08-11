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
  sources: Array<{
    id: string;
    title: string;
    source: string;
    sourceUrl?: string;
    fetchedAt: string;
    evidenceType: ResearchEvidence['evidenceType'];
    contentQuality?: ResearchEvidence['contentQuality'];
  }>;
  stopReason: string;
  steps: number;
  degraded: boolean;
  knowledgeScope: 'thread' | 'global';
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

export function isSearchRedirectUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return (host === 'baidu.com' && url.pathname.startsWith('/link'))
      || (host === 'sogou.com' && url.pathname.startsWith('/link'))
      || (host === 'so.com' && url.pathname.startsWith('/link'))
      || host === 'ai.so.com';
  } catch {
    return false;
  }
}

export function requiresFullPageEvidence(question: string): boolean {
  return /核验|查证|核实|是否真实|是否已经?.*(?:发布|上线|宣布)|真假|骗局|是不是|还是不是|是否为|是否属于|合作(?:伙伴|关系)?|资质|认证|授权|代理|牌照|供应商|入驻/i.test(question);
}

export function requiresPrimaryEvidence(question: string): boolean {
  return /官方|官网|第一方|是否已经?.*(?:公开)?(?:发布|上线|宣布)|有没有发布|合作(?:伙伴|关系)?|资质|认证|授权|代理/i.test(question);
}

export function shouldUseGlobalKnowledgeScope(question: string): boolean {
  return /(?:全局|全系统|跨任务|跨对话|所有任务|全部任务|全部|所有|整个|全库).{0,8}(?:知识库|已入库|本地资料)|(?:知识库|已入库|本地资料).{0,8}(?:全局|全系统|跨任务|跨对话|所有任务|全部任务|全部|所有|整个|全库)/i.test(question);
}

export function requiresKnowledgeRetrieval(question: string): boolean {
  return /知识库|本地资料|已采集资料|已入库资料/i.test(question);
}

export function requiresWebRetrieval(question: string): boolean {
  return /网页|联网|网络信息|公开信息|最新信息|实时信息|网上资料|网络资料/i.test(question);
}

export function requiredSourceQuery(question: string): string {
  const subject = /关于\s*([^，。；,;]+?)(?:\s*的资料|\s*资料|，|,|并|和最新|与最新)/i.exec(question)?.[1]?.trim();
  if (subject) return subject.slice(0, 300);
  return question
    .replace(/请|深入|深度|研究|调研|查询|检索/g, ' ')
    .replace(/(?:本地|全部|所有|整个|全局|全系统)?\s*知识库(?:中|里|内)?/g, ' ')
    .replace(/(?:并|以及)?\s*(?:和|与)?\s*(?:最新)?(?:网页|网络|公开)信息(?:进行)?交叉验证/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || question.slice(0, 300);
}

export function normalizeRelativeResearchQuery(question: string, query: string, nowMs = Date.now()): string {
  if (!/(?:下个?月|最新|当前|现在|近期)/i.test(question)) return query;
  const now = new Date(nowMs);
  const target = /下个?月/i.test(question)
    ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
    : now;
  const dateLabel = `${target.getFullYear()}年${target.getMonth() + 1}月`;
  let normalized = query.replace(/20\d{2}年(?:\d{1,2}月)?/g, dateLabel);
  if (!normalized.includes(dateLabel)) normalized = `${normalized} ${dateLabel}`;
  return normalized.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function isLikelyPrimaryEvidence(item: ResearchEvidence): boolean {
  if (item.evidenceType !== 'web_page' || item.contentQuality !== 'full') return false;
  try {
    const host = new URL(item.sourceUrl || '').hostname.toLowerCase();
    return /(?:^|\.)(?:gov\.cn|gov|apple\.com|microsoft\.com|openai\.com|google\.com|github\.com|sap\.com|oracle\.com|huawei\.com|aliyun\.com|tencent\.com)$/.test(host)
      || /官网|官方/i.test(item.title);
  } catch {
    return false;
  }
}

function fallbackResearchAnswer(question: string, evidence: ResearchEvidence[], reason: string): string {
  const clean = (value: string) => value
    .replace(/\uFFFD+/g, '')
    .replace(/(?:^|\s)(?:播报|暂停|继续播放)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const scamVerification = /骗局|诈骗|骗人|欺诈/i.test(question);
  const favorable = /不是(?:骗局|诈骗|骗人的)|非骗局|正规|可靠|靠谱|资质|认证|成功(?:就业|入职|转型)|真实经历|获得.*offer/i;
  const concerning = /投诉|退款|维权|夸大|虚假宣传|无资质|不靠谱|骗局|诈骗|避雷|争议|失败|收费.*(?:高|贵)/i;
  const render = (title: string, items: ResearchEvidence[]) => items.length
    ? [
      `### ${title}`,
      '',
      ...items.slice(0, 4).map((item) => `- [${item.id}] ${clean(item.title)}：${clean(item.excerpt).slice(0, 150)}`),
      '',
    ]
    : [];
  const firstPartyMissing = requiresPrimaryEvidence(question) && !evidence.some(isLikelyPrimaryEvidence);
  if (!scamVerification) {
    const knowledge = evidence.filter((item) => item.evidenceType === 'knowledge');
    const webPages = evidence.filter((item) => item.evidenceType === 'web_page');
    const search = evidence.filter((item) => item.evidenceType === 'search');
    const marketForecast = /黄金|白银|股票|股价|基金|汇率|比特币|加密货币|价格走势|上涨|下跌/i.test(question);
    const boundary = firstPartyMissing
      ? '- 尚未读取到足以确认发布状态的第一方官方页面，不能据此断言已经或尚未正式发布。'
      : marketForecast
        ? '- 未来市场价格无法被现有材料可靠确定；过时预测只能作为历史观点，搜索摘要也不能替代带日期的行情和专业机构原文。'
      : /交叉验证|对比|比对/i.test(question)
        ? '- 当前只能确认已取得两类材料；最终语义综合未完成，因此不能自动断言本地资料与网页信息完全一致或互相冲突。'
        : '- 以下内容是已取得材料的整理，不代表所有关键事实都已经获得独立来源验证。';
    return [
      '本轮取得了部分证据，但最终 AI 综合未能在时限内完成。以下按来源类型整理已有材料，不对用户未提出的命题作额外推断。',
      '',
      ...render('本地知识库材料', knowledge),
      ...render('已读取的网页内容', webPages),
      ...render('最新网页搜索摘要', search),
      '### 当前验证边界',
      '',
      boundary,
      `- 降级原因：${reason}。`,
      '- 未检索到的材料不能被推断为不存在；搜索摘要的证据强度低于网页正文。',
    ].join('\n');
  }

  const groups = { favorable: [] as ResearchEvidence[], concerning: [] as ResearchEvidence[], neutral: [] as ResearchEvidence[] };
  for (const item of evidence) {
    const text = clean(`${item.title} ${item.excerpt}`);
    const favorableMatch = favorable.test(text);
    const concerningMatch = concerning.test(text.replace(/不是(?:骗局|诈骗|骗人的)|非骗局/g, ''));
    if (favorableMatch && !concerningMatch) groups.favorable.push(item);
    else if (concerningMatch && !favorableMatch) groups.concerning.push(item);
    else groups.neutral.push(item);
  }
  return [
    '本轮取得了部分证据，但最终 AI 综合未能在时限内完成。下面按证据方向整理已有材料；分组仅表示材料的说法，不代表其内容已经被独立证实。',
    '',
    ...render('反对“骗局”说法的材料', groups.favorable),
    ...render('支持质疑或提示风险的材料', groups.concerning),
    ...render('中立或尚待核实的材料', groups.neutral),
    '### 当前判断边界',
    '',
    '- 当前材料仍不足以单独证明“骗局”或“非骗局”；机构合规、宣传真实性、合同争议和服务效果需要分别核验。',
    `- 降级原因：${reason}。`,
    '- 未检索到的材料不能被推断为不存在，营销文章和个人经历也不能替代工商、司法、监管或官方认证记录。',
  ].join('\n');
}

function evidenceKey(value: Pick<ResearchEvidence, 'sourceUrl' | 'key'>): string {
  return normalizedUrl(value.sourceUrl) || value.key;
}

function evidenceContentFingerprint(item: ResearchEvidence): string {
  return `${item.title}\n${item.excerpt}`
    .toLowerCase()
    .replace(/[#*_`>()]/g, '')
    .replace(/\[|\]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 600);
}

function evidenceStrength(item: ResearchEvidence): number {
  const typeScore = { search: 1, knowledge: 2, web_page: 3 }[item.evidenceType];
  const qualityScore = { metadata_only: 0, partial: 1, full: 2 }[item.contentQuality || 'metadata_only'];
  return typeScore * 10 + qualityScore;
}

export function invalidResearchAnswerReason(answer: string, evidence: ResearchEvidence[]): string | null {
  const value = answer.trim();
  if (!value) return '最终回答为空';
  if (/<\/?(?:tool_result|tool|parameter|function_call)\b|\b(?:tool_call|function_call)\b/i.test(value)) {
    return '最终回答包含伪工具调用协议';
  }
  const validIds = new Set(evidence.map((item) => item.id.toUpperCase()));
  const citations = [...value.matchAll(/\[S(\d+)\]/gi)].map((match) => `S${match[1]}`.toUpperCase());
  if (!citations.length) return '最终回答没有引用已有证据';
  if (citations.some((id) => !validIds.has(id))) return '最终回答引用了不存在的证据';
  return null;
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
      onStatus?: (status: {
        phase: 'web_search' | 'reasoning';
        message: string;
        sources?: any[];
        retrieval?: string;
        analysis_coverage?: any;
        keywords?: string[];
      }) => void;
      maxSteps?: number;
      timeoutMs?: number;
    },
  ): Promise<ResearchLoopResult> {
    const started = this.now();
    const maxSteps = Math.max(1, Math.min(5, options.maxSteps || 5));
    const timeoutMs = Math.max(5_000, Math.min(240_000, options.timeoutMs || 180_000));
    const explorationTimeoutMs = Math.min(100_000, Math.max(15_000, Math.floor(timeoutMs * 0.55)));
    const explorationTimeoutSignal = AbortSignal.timeout(explorationTimeoutMs);
    const operationSignal = options.signal ? AbortSignal.any([options.signal, explorationTimeoutSignal]) : explorationTimeoutSignal;
    const evidence = new Map<string, ResearchEvidence>();
    const discoveredUrls = new Set(
      Array.from(question.matchAll(/https?:\/\/[^\s，。；;]+/g), (match) => normalizedUrl(match[0])),
    );
    let searchCalls = 0;
    let readUrls = 0;
    const attemptedReadUrls = new Set<string>();
    let consecutiveNoEvidence = 0;
    let hadRecoverableFailure = false;
    let stopReason = '达到最大步数';
    let steps = 0;
    const knowledgeScope = shouldUseGlobalKnowledgeScope(question) ? 'global' : 'thread';
    const mustQueryKnowledge = requiresKnowledgeRetrieval(question);
    const mustQueryWeb = requiresWebRetrieval(question);
    const requiredQuery = requiredSourceQuery(question);
    let knowledgeAttempted = false;
    let webSearchAttempted = false;

    const addEvidence = (items: ResearchEvidence[]): number => {
      let changed = 0;
      for (const item of items) {
        const key = evidenceKey(item);
        const current = evidence.get(key);
        if (!current
          || evidenceStrength(item) > evidenceStrength(current)
          || (evidenceStrength(item) === evidenceStrength(current) && item.excerpt.length > current.excerpt.length)) {
          evidence.set(key, { ...item, key });
          changed++;
        }
      }
      return changed;
    };

    for (let step = 1; step <= maxSteps; step++) {
      options.signal?.throwIfAborted();
      if (explorationTimeoutSignal.aborted) {
        stopReason = '探索阶段达到时间上限，使用已有证据回答';
        hadRecoverableFailure = true;
        break;
      }
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
      let decision: ResearchStepDecision;
      if (mustQueryKnowledge && !knowledgeAttempted) {
        decision = {
          action: 'knowledge_query',
          query: requiredQuery,
          reason: `用户明确要求查询${knowledgeScope === 'global' ? '全部' : '当前任务'}知识库`,
        };
      } else if (mustQueryWeb && !webSearchAttempted) {
        decision = {
          action: 'live_search',
          query: `${requiredQuery} 最新信息`.slice(0, 300),
          reason: '用户明确要求使用最新网页信息进行交叉验证',
        };
      } else {
        try {
          decision = await this.model.decideResearchStep(question, [...evidence.values()], state, operationSignal);
        } catch (error: any) {
          if (options.signal?.aborted) throw error;
          hadRecoverableFailure = true;
          stopReason = explorationTimeoutSignal.aborted
            ? '探索阶段达到时间上限，使用已有证据回答'
            : `研究决策失败，使用已有证据回答：${error.message || '未知错误'}`;
          break;
        }
      }
      if (decision.query) {
        decision.query = normalizeRelativeResearchQuery(question, decision.query, this.now());
      }
      steps = step;
      if (decision.action === 'live_search' && searchCalls > 0 && requiresFullPageEvidence(question)) {
        const currentEvidence = [...evidence.values()];
        const hasFullPage = currentEvidence.some((item) => item.evidenceType === 'web_page' && item.contentQuality === 'full');
        const readableUrls = currentEvidence
          .filter((item) => item.evidenceType === 'search')
          .map((item) => normalizedUrl(item.sourceUrl))
          .filter((url) => url && !isSearchRedirectUrl(url) && !attemptedReadUrls.has(url))
          .slice(0, Math.max(0, Math.min(3, 5 - readUrls)));
        if (!hasFullPage && readableUrls.length) {
          decision = {
            action: 'direct_web_read',
            urls: readableUrls,
            reason: '核验任务已经取得搜索摘要，下一步优先读取原始页面而不是继续堆叠摘要',
          };
        }
      }
      if (decision.action === 'finish') {
        const currentEvidence = [...evidence.values()];
        const needsFullPage = requiresFullPageEvidence(question)
          && !currentEvidence.some((item) => item.evidenceType === 'web_page' && item.contentQuality === 'full');
        const needsPrimary = requiresPrimaryEvidence(question) && !currentEvidence.some(isLikelyPrimaryEvidence);
        const readableUrls = currentEvidence
          .map((item) => normalizedUrl(item.sourceUrl))
          .filter((url) => url && !isSearchRedirectUrl(url) && !attemptedReadUrls.has(url))
          .slice(0, Math.max(0, Math.min(3, 5 - readUrls)));
        if ((needsFullPage || needsPrimary) && readableUrls.length) {
          decision = { action: 'direct_web_read', urls: readableUrls, reason: '核验任务需要读取已发现的原始页面，不能只依赖搜索摘要' };
        } else if ((needsFullPage || needsPrimary) && searchCalls < 3 && step < maxSteps) {
          decision = {
            action: 'live_search',
            query: `${question} 官方 官网 第一方来源`,
            reason: '尚缺少可读取的第一方或网页正文证据，继续定向搜索',
          };
        } else {
          stopReason = needsFullPage || needsPrimary
            ? '已达到研究预算，但未取得足够的第一方或网页正文证据'
            : decision.reason || '模型判断证据已经足够';
          options.trace.recordLoopStep(step, 'finish', stopReason, 0);
          break;
        }
      }

      let newEvidence = 0;
      try {
        if (decision.action === 'knowledge_query') {
          knowledgeAttempted = true;
          const results = await this.executor.execute<
            { query: string; limit?: number; scope?: 'global' | 'thread' }, KnowledgeToolEvidence[]
          >('knowledge_query', { query: decision.query || question, limit: 8, scope: knowledgeScope }, {
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
          webSearchAttempted = true;
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
            .filter((url) => discoveredUrls.has(url) && !isSearchRedirectUrl(url) && !attemptedReadUrls.has(url))
            .slice(0, Math.max(0, Math.min(3, 5 - readUrls)));
          if (!urls.length) {
            consecutiveNoEvidence++;
            options.trace.recordLoopStep(step, decision.action, '没有可读取的已发现公开 URL', 0);
            if (consecutiveNoEvidence >= 2) { stopReason = '连续两步没有新增证据'; break; }
            continue;
          }
          readUrls += urls.length;
          urls.forEach((url) => attemptedReadUrls.add(url));
          const result = await this.executor.execute<
            { urls: string[]; timeoutMs?: number }, DirectWebReadResult
          >('direct_web_read', { urls, timeoutMs: 15_000 }, { threadId: options.threadId, signal: operationSignal }, options.trace);
          newEvidence = addEvidence(result.articles.map((item) => ({
            id: '', key: normalizedUrl(item.content_url), title: item.title, excerpt: item.description.slice(0, 8_000),
            source: item.site_name || 'web_reader', sourceUrl: item.content_url,
            publishedAt: item.published_at === undefined ? undefined : String(item.published_at), evidenceType: 'web_page' as const,
            contentQuality: item.content_quality || 'partial',
          })));
        }
      } catch (error: any) {
        if (options.signal?.aborted) throw error;
        if (explorationTimeoutSignal.aborted) {
          stopReason = '探索阶段达到时间上限，使用已有证据回答';
          hadRecoverableFailure = true;
          break;
        }
        consecutiveNoEvidence++;
        hadRecoverableFailure = true;
        options.trace.recordLoopStep(step, decision.action, `工具失败，保留已有证据继续：${error.message || '未知错误'}`, 0);
        if (consecutiveNoEvidence >= 2) {
          stopReason = '连续两步没有新增证据';
          break;
        }
        continue;
      }

      consecutiveNoEvidence = newEvidence > 0 ? 0 : consecutiveNoEvidence + 1;
      options.trace.recordLoopStep(step, decision.action, decision.reason, newEvidence);
      if (consecutiveNoEvidence >= 2) {
        stopReason = '连续两步没有新增证据';
        break;
      }
    }

    const finalCandidates = [...evidence.values()];
    const selectedEvidence: ResearchEvidence[] = [];
    const selectedKeys = new Set<string>();
    const selectedFingerprints = new Set<string>();
    const take = (items: ResearchEvidence[], limit: number) => {
      for (const item of items) {
        if (selectedEvidence.length >= 10 || limit <= 0) break;
        const key = evidenceKey(item);
        const fingerprint = evidenceContentFingerprint(item);
        if (selectedKeys.has(key) || selectedFingerprints.has(fingerprint)) continue;
        selectedEvidence.push(item);
        selectedKeys.add(key);
        selectedFingerprints.add(fingerprint);
        limit--;
      }
    };
    take(finalCandidates.filter((item) => item.evidenceType === 'web_page' && item.contentQuality === 'full'), 3);
    take(finalCandidates.filter((item) => item.evidenceType === 'knowledge'), 4);
    take(finalCandidates.filter((item) => item.evidenceType === 'search'), 3);
    take(finalCandidates.sort((left, right) => evidenceStrength(right) - evidenceStrength(left)), 10 - selectedEvidence.length);
    const finalizedEvidence = selectedEvidence.map((item, index) => ({ ...item, id: `S${index + 1}` }));
    if (!finalizedEvidence.length) {
      stopReason = stopReason === '达到最大步数' ? '没有检索到可用证据' : stopReason;
      options.trace.finish(stopReason);
      return {
        answer: '这次没有检索到足以支持结论的本地或网页证据。可以换一个更具体的对象、时间范围或核验问题后重试。',
        evidence: [], sources: [], stopReason, steps, degraded: false, knowledgeScope,
      };
    }
    const fetchedAt = new Date().toISOString();
    const finalizedSources = finalizedEvidence.map((item) => ({
      id: item.id, title: item.title, source: item.source, sourceUrl: item.sourceUrl, fetchedAt,
      evidenceType: item.evidenceType, contentQuality: item.contentQuality,
    }));

    let emittedSources = false;
    const emitSourcesOnce = () => {
      if (!emittedSources && finalizedSources.length) {
        emittedSources = true;
        try {
          options.onStatus?.({
            phase: 'reasoning',
            message: '正在综合深度研究结果…',
            sources: finalizedSources,
            retrieval: 'research_loop',
          });
        } catch {}
      }
    };

    options.onStatus?.({
      phase: 'reasoning',
      message: '正在综合深度研究结果…',
      retrieval: 'research_loop',
    });

    let answer: string;
    let degraded = hadRecoverableFailure;
    const remainingAnswerMs = Math.max(35_000, timeoutMs - (this.now() - started) - 1_000);
    const answerTimeoutSignal = AbortSignal.timeout(remainingAnswerMs);
    const answerSignal = options.signal ? AbortSignal.any([options.signal, answerTimeoutSignal]) : answerTimeoutSignal;
    let streamedAnyDelta = false;
    try {
      answer = await this.model.answerResearch(
        options.messages,
        finalizedEvidence,
        answerSignal,
        (delta) => {
          streamedAnyDelta = true;
          emitSourcesOnce();
          options.onDelta?.(delta);
        },
      );
      const invalidReason = invalidResearchAnswerReason(answer, finalizedEvidence);
      if (invalidReason) {
        degraded = true;
        stopReason = `${stopReason}；${invalidReason}`;
        answer = fallbackResearchAnswer(question, finalizedEvidence, stopReason);
      }
    } catch (error: any) {
      if (options.signal?.aborted) throw error;
      degraded = true;
      const answerFailure = answerTimeoutSignal.aborted ? '最终回答生成超时' : `最终回答生成失败：${error.message || '未知错误'}`;
      stopReason = `${stopReason}；${answerFailure}`;
      answer = fallbackResearchAnswer(question, finalizedEvidence, stopReason);
    }
    if (!streamedAnyDelta) {
      emitSourcesOnce();
      options.onDelta?.(answer);
    }
    options.trace.finish(stopReason);
    return {
      answer: answer.trim(),
      evidence: finalizedEvidence,
      sources: finalizedSources,
      stopReason,
      steps,
      degraded,
      knowledgeScope,
    };
  }
}

export const researchLoop = new ResearchLoop();
