import fs from 'fs';
import { crawlerManager } from './CrawlerManager';
import { agentRepository, type ContentEnrichmentOptions, type QueryExpansionConfig, type ResearchPlan } from './AgentRepository';
import { extractWebUrls, hasExplicitCollectionDepth, inferCollectionDepth, inferExcludedPlatforms, inferExplicitResearchKeywords, inferQueryExpansionMode, inferResearchKeywords, inferResearchPlatforms, isAdditivePlatformRequest, isExclusivePlatformRequest, isSimpleConversation, localIntentDecision, type AgentDecision } from './AgentIntent';
import { modelService, type ConversationMaterials, type ConversationMemory } from './ModelService';
import { connectorLabels, getConnectorManifest, listConnectorManifests } from '../../connectors/registry';
import { DEPTH_LABELS, describeDepthForCapabilities, type DepthLevel } from '../../connectors/depth';
import { fallbackTitleFromText, isMeaningfulTitleInput, sanitizeThreadTitle, titleFromPlan } from './ThreadTitle';
import { inferExplicitAnalysisGoals, normalizeAnalysisGoals } from './ResearchAnalysis';
import { directParserService } from './DirectParserService';
import { workflowRuntime } from '../../workflow/workflow-runtime';
import { knowledgeIndex } from '../../knowledge/knowledge-index';
import { exportService } from '../../exporters/registry';
import { skillRegistry } from '../../skills/registry';
import type { SkillDefinition } from '../../core/skills/types';
import { toLiveSourceCitations, type SearchEvidence } from './LiveSearchService';
import { analysisService } from '../../analyzers/registry';
import { quickReportGenerator } from '../../analyzers/quick-report-generator';
import { reportArtifactService } from '../../analyzers/report-artifact-service';
import { directWebSourceCitations, type DirectWebReadResult } from './DirectWebReadService';
import { agentToolExecutor } from '../agent/AgentTools';
import { AgentRunTrace, currentAgentRunTrace, runWithAgentTrace } from '../agent/AgentToolRegistry';
import { researchLoop, shouldUseExperimentalResearchLoop } from '../agent/ResearchLoop';
import { connectorHealthService } from '../../connectors/health-service';
import { qualityGateService } from '../../analyzers/quality-gate-service';

const SUPPORTED = listConnectorManifests().map((connector) => connector.id);
const LABELS = connectorLabels();

function aiHotOptions(userText: string, current: Record<string, unknown> = {}): Record<string, unknown> {
  const result = { ...current };
  if (/日报|daily/i.test(userText)) result.content_mode = 'latest_daily';
  else if (/热点|热榜|hot\s*topics?/i.test(userText)) result.content_mode = 'hot_topics';
  else if (result.content_mode === undefined) result.content_mode = 'items';
  if (/最近?\s*7\s*天|近一周|一周内/i.test(userText)) result.window = '7d';
  if (/公开池|全部资讯|所有资讯/i.test(userText)) result.items_mode = 'all';
  if (/论文|paper/i.test(userText)) result.category = 'paper';
  else if (/模型发布|AI\s*模型/i.test(userText)) result.category = 'ai-models';
  else if (/产品发布|AI\s*产品/i.test(userText)) result.category = 'ai-products';
  else if (/行业动态/i.test(userText)) result.category = 'industry';
  else if (/技巧|观点/i.test(userText)) result.category = 'tip';
  return result;
}

const AI_HOT_GENERIC_KEYWORDS = new Set([
  'ai',
  'aihot',
  'ai资讯',
  'ai资讯搜索',
  'ai行业资讯',
  'ai新闻',
  'ai圈动态',
  'ai热点',
  'ai热榜',
  'ai日报',
  'ai资讯搜索aihot',
]);

function isAiHotGenericKeyword(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[\s()（）·_—-]+/g, '');
  return AI_HOT_GENERIC_KEYWORDS.has(normalized);
}

function explicitlyRequestsEmptyKeywords(value: string): boolean {
  return /(?:不限定|不限|不限制|不设|无需|不需要|不要|无)(?:任何)?(?:搜索)?关键词|关键词\s*(?:留空|为空|清空|不限|不限定|不限制|设为无)/i.test(value);
}

function allowsEmptyKeywords(plan: Pick<ResearchPlan, 'platforms' | 'capability'>): boolean {
  return plan.capability === 'keyword_search'
    && plan.platforms.length === 1
    && plan.platforms[0] === 'aihot';
}

function normalizeContentEnrichment(
  input: unknown,
  userText: string,
  platforms: string[],
  capability: ResearchPlan['capability'],
  depth: ResearchPlan['collectionDepth'],
  skill: SkillDefinition | null,
): ContentEnrichmentOptions {
  const hasWebSearch = capability === 'keyword_search'
    && platforms.some((platform) => getConnectorManifest(platform)?.category === 'web_search');
  const configured = input && typeof input === 'object'
    ? input as Partial<ContentEnrichmentOptions>
    : skill?.defaults?.contentEnrichment;
  let mode: ContentEnrichmentOptions['mode'] = hasWebSearch ? 'auto' : 'snippet';
  if (configured && ['snippet', 'auto', 'full'].includes(String(configured.mode))) {
    mode = configured.mode as ContentEnrichmentOptions['mode'];
  }
  if (/(?:只看|仅看|保留)(?:搜索)?摘要|不要(?:读取)?正文|不读正文/i.test(userText)) mode = 'snippet';
  else if (/(?:阅读|读取|抓取|提取)(?:完整)?正文|阅读全文|完整网页|深度阅读/i.test(userText)) mode = 'full';
  if (!hasWebSearch) mode = 'snippet';

  const budget = depth === 'deep' ? 30 : depth === 'standard' ? 16 : 8;
  const number = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
  };
  return {
    mode,
    maxReadItems: mode === 'snippet' ? 0 : number(configured?.maxReadItems, budget, 1, 100),
    maxPerDomain: number(configured?.maxPerDomain, 2, 1, 20),
    concurrency: number(configured?.concurrency, 3, 1, 8),
    timeoutMsPerUrl: number(configured?.timeoutMsPerUrl, 15_000, 1_000, 30_000),
  };
}

function skillPlanningContext(skill: SkillDefinition | null): string {
  if (!skill) return '';
  return JSON.stringify({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    requiredInputs: skill.inputs.filter((input) => input.required),
    targetGuidance: skill.targetGuidance,
    defaults: skill.defaults,
    limitations: skill.limitations,
  });
}

export function shouldAutoStartSkill(skill: SkillDefinition | null, explicitlyInvoked: boolean): boolean {
  return Boolean(explicitlyInvoked && skill?.mentionable && skill.execution.autoStartWhenExplicitlyInvoked);
}

/**
 * A collection request already expresses the user's intent to run it, so do
 * not add a redundant confirmation turn. Keep awaiting_confirmation only as
 * an explicit "show me the plan first" mode.
 */
export function shouldAutoStartPlan(
  plan: ResearchPlan,
  userText: string,
  skill: SkillDefinition | null = null,
  explicitlyInvokedSkill = false,
): boolean {
  if (plan.healthPolicy?.requiresConfirmation) return false;
  if (/(?:先别|不要|暂不|先不)(?:自动)?(?:开始|执行|运行|采集|搜索)|(?:先|只)(?:给我)?看(?:一下)?(?:采集)?计划|等待确认|确认后再/i.test(userText)) return false;
  if (shouldAutoStartSkill(skill, explicitlyInvokedSkill)) return true;
  return true;
}

function applyConnectorHealthPolicy(plan: ResearchPlan, userText: string, mentionedConnectors: string[]): ResearchPlan {
  const explicitPlatforms = Array.from(new Set([...mentionedConnectors, ...inferResearchPlatforms(userText)]));
  const healthPolicy = connectorHealthService.evaluatePlan(plan.platforms, explicitPlatforms, plan.capability || 'keyword_search');
  return { ...plan, platforms: healthPolicy.selectedPlatforms, healthPolicy };
}

export function normalizePlan(
  input: any,
  userText: string,
  fallbackPlan?: ResearchPlan,
  preserveFallbackDepth = false,
  skill: SkillDefinition | null = null,
  mentionedConnectors: string[] = [],
): ResearchPlan {
  // A structured @ selection is already carried in `skill`. Do not interpret
  // words inside its display name as free-form platform instructions (for
  // example, the “全网” in “@全网综合解析” used to expand to every connector).
  const platformIntentText = skill
    ? userText.replace(new RegExp(`@?${skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), ' ')
    : userText;
  const platformAliases: Record<string, string> = {
    小红书: 'xhs', 抖音: 'douyin', 快手: 'kuaishou', B站: 'bili', 哔哩哔哩: 'bili', 微博: 'weibo', 百度贴吧: 'tieba', 贴吧: 'tieba', 知乎: 'zhihu',
    dy: 'douyin', ks: 'kuaishou', wb: 'weibo',
    百度: 'baidu', 百度搜索: 'baidu', 必应: 'bing', 必应中国: 'bing', 必应搜索: 'bing', '360': 'so360', '360搜索': 'so360', 搜狗: 'sogou', 搜狗搜索: 'sogou', 头条: 'toutiao', 头条搜索: 'toutiao',
    神马: 'quark', 神马搜索: 'quark', 夸克: 'quark', 夸克搜索: 'quark', quark: 'quark',
    中国搜索: 'chinaso', 国搜: 'chinaso', chinaso: 'chinaso',
    arXiv: 'arxiv', Arxiv: 'arxiv', arxiv: 'arxiv', 论文库: 'arxiv',
    GitHub: 'github_repositories', Github: 'github_repositories', github: 'github_repositories', GitHub仓库: 'github_repositories', GitHub趋势: 'github_repositories',
    DeepSeek: 'deepseek', Kimi: 'kimi', 'Kimi AI': 'kimi', 豆包: 'doubao', Doubao: 'doubao',
    千问: 'qwen', 通义千问: 'qwen', Qwen: 'qwen', 元宝: 'yuanbao', 腾讯元宝: 'yuanbao',
    纳米AI: 'nami', '纳米 AI': 'nami', 纳米AI搜索: 'nami',
    文心: 'wenxin', 文心一言: 'wenxin', 文心言: 'wenxin', 文小言: 'wenxin',
    黑猫: 'heimao', 黑猫投诉: 'heimao', boss: 'boss', Boss: 'boss', BOSS: 'boss', BOSS直聘: 'boss', 'BOSS 直聘': 'boss', 'zhipin.com': 'boss',
    智联: 'zhaopin', 智联招聘: 'zhaopin', 前程无忧: 'job51', '51job': 'job51', 猎聘: 'liepin', 猎聘网: 'liepin',
    'AI 资讯搜索（AI HOT）': 'aihot', 'AI 资讯搜索 (AI HOT)': 'aihot', 'AI HOT': 'aihot', AIHOT: 'aihot', AI资讯搜索: 'aihot', AI行业资讯: 'aihot', AI新闻: 'aihot', AI圈动态: 'aihot', AI热点: 'aihot', AI热榜: 'aihot', AI日报: 'aihot',
  };
  const platforms = Array.from(new Set((Array.isArray(input?.platforms) ? input.platforms : [])
    .map((p: any) => platformAliases[String(p)] || String(p))
    .filter((p: string) => SUPPORTED.includes(p)))) as string[];
  const inferredPlatforms = inferResearchPlatforms(platformIntentText);
  const excludedPlatforms = inferExcludedPlatforms(platformIntentText);
  const isExclusive = isExclusivePlatformRequest(platformIntentText);
  const isAdditive = isAdditivePlatformRequest(platformIntentText);
  const rawKeywords = (Array.isArray(input?.keywords) ? input.keywords : [])
    .map((value: any) => String(value).trim()).filter(Boolean);
  const explicitUserKeywords = inferExplicitResearchKeywords(platformIntentText);
  let keywords = explicitUserKeywords.length
    ? explicitUserKeywords
    : Array.from(new Set(rawKeywords.flatMap((keyword: string) => {
    // Models occasionally echo the merged clarification scaffold into a keyword,
    // e.g. "采集抖音 用户补充：codex学习". Re-run only command-like values
    // through the deterministic subject extractor.
    if (/用户补充|^(?:请|帮我|采集|收集|抓取|搜索|调研)|(?:小红书|抖音|快手|哔哩哔哩|微博|贴吧|知乎|百度|必应|360|搜狗|BOSS\s*直聘|zhipin\.com).*(?:采集|搜索)/i.test(keyword)) {
      return inferResearchKeywords(keyword);
    }
    return [keyword];
  }))).slice(0, 12) as string[];

  if (!keywords.length && fallbackPlan?.keywords?.length) {
    keywords = fallbackPlan.keywords;
  }
  const capabilityIds = ['keyword_search', 'content_detail', 'creator_profile', 'comments', 'url_resolve'];
  const inferredCapability = /解析.*(?:链接|URL)|短链|真实链接/i.test(userText)
    ? 'url_resolve'
    : /(?:作者|博主|UP主|创作者|用户|主页).*(?:作品|内容|帖子|视频)|采集.*主页/i.test(userText)
      ? 'creator_profile'
      : /(?:这个|这些|指定|链接|URL).*(?:评论|回复|楼层)/i.test(userText)
        ? 'comments'
        : /(?:详情|指定作品|指定内容)|https?:\/\//i.test(userText)
          ? 'content_detail'
          : 'keyword_search';
  const requestedCapability = input?.capability ?? skill?.defaults?.capability;
  const capability = capabilityIds.includes(String(requestedCapability)) ? requestedCapability : inferredCapability;
  const inputTargets = Array.isArray(input?.targets) ? input.targets : [];
  const textTargets = Array.from(userText.matchAll(/https?:\/\/[^\s，。；;]+/g)).map((match) => match[0]);
  const targets = Array.from(new Set([...inputTargets, ...textTargets].map((value) => String(value).trim()).filter(Boolean))).slice(0, 30);
  const goal = String(input?.goal || userText).slice(0, 300);
  const explicitAnalysis = inferExplicitAnalysisGoals(userText);
  const suppliedAnalysis = Array.isArray(input?.analysis) && input.analysis.some((value: unknown) => String(value).trim());
  const analysisSource = ['ai', 'fallback', 'user'].includes(String(input?.analysisSource))
    ? input.analysisSource
    : explicitAnalysis.length ? 'user' : suppliedAnalysis ? 'ai' : undefined;

  // Do not let the planner silently enlarge a new run. The user's own words are
  // authoritative; absent an explicit scope, every new plan starts at quick.
  // A revision that only changes another field keeps the pending plan's depth.
  const collectionDepth: 'quick' | 'standard' | 'deep' | 'custom' = hasExplicitCollectionDepth(userText)
    ? inferCollectionDepth(userText)
    : preserveFallbackDepth && fallbackPlan?.collectionDepth
      ? fallbackPlan.collectionDepth
      : 'quick';

  const explicitlyMentionedPlatforms = Array.from(new Set(mentionedConnectors.filter((platform) => SUPPORTED.includes(platform))));

  let basePlatforms: string[];
  if (explicitlyMentionedPlatforms.length > 0) {
    basePlatforms = explicitlyMentionedPlatforms;
  } else if (isExclusive) {
    basePlatforms = inferredPlatforms.length ? inferredPlatforms : platforms;
  } else if (skill?.defaults?.platforms?.length) {
    const defaultPlatforms = skill.defaults.platforms.filter((p) => SUPPORTED.includes(p));
    // URL resolver tools own the target URL. Its origin (for example a Douyin
    // link) describes what media_parser should parse, not an additional social
    // connector that should crawl the same URL a second time.
    if (defaultPlatforms.includes('media_parser')) {
      basePlatforms = defaultPlatforms;
    } else if (inferredPlatforms.length > 0) {
      basePlatforms = Array.from(new Set([...defaultPlatforms, ...inferredPlatforms]));
    } else {
      basePlatforms = defaultPlatforms;
    }
  } else if (isAdditive && fallbackPlan?.platforms?.length) {
    const extraPlatforms = inferredPlatforms.length ? inferredPlatforms : platforms;
    basePlatforms = Array.from(new Set([...fallbackPlan.platforms, ...extraPlatforms]));
  } else {
    basePlatforms = inferredPlatforms.length ? inferredPlatforms : platforms;
  }

  const selectedPlatforms = basePlatforms.filter((platform) => !excludedPlatforms.includes(platform));
  const requiresAuth = selectedPlatforms.some((pid) => getConnectorManifest(pid)?.auth.required);
  const loginType = requiresAuth ? 'qrcode' : 'none';
  const suppliedGoals = Array.isArray(input?.analysis) ? input.analysis : [];
  const analysis = skill?.category === 'business' && skill.defaults
    ? normalizeAnalysisGoals([...skill.defaults.analysis, ...explicitAnalysis, ...suppliedGoals], goal)
    : normalizeAnalysisGoals([...explicitAnalysis, ...suppliedGoals], goal);
  // Generic Agent collection always produces an automatic evidence-led report.
  // Deterministic tools keep their explicit "collect only" contract unless the
  // user supplied an analysis goal; business Skills always use their template.
  const autoAnalyze = skill?.category === 'business'
    || (!skill || skill.id === 'multi-source-research')
    || analysis.length > 0;

  const connectorOptions = input?.connectorOptions && typeof input.connectorOptions === 'object'
    ? { ...input.connectorOptions }
    : {};
  const jobPlatforms = selectedPlatforms.filter((platform) => ['boss', 'zhaopin', 'job51', 'liepin'].includes(platform));
  const explicitJobLocation = jobPlatforms.length
    ? userText.match(/(?:在|城市(?:是|为|[:：])?|地区(?:是|为|[:：])?|地域(?:是|为|[:：])?|地点(?:是|为|[:：])?)\s*([\u4e00-\u9fa5]{2,12}?)(?:市)?(?=\s*(?:的|招聘|找|工作|岗位|职位|平均薪资|薪资|工资|，|,|。|；|;|$))/)?.[1]?.trim()
    : '';
  // Semantic extraction belongs to the planner. This deterministic validation
  // fallback keeps an explicit recruitment location from being silently omitted
  // (and thereby broadening the crawl) if one nested model field is missing.
  if (explicitJobLocation) {
    for (const platform of jobPlatforms) {
      const existing = connectorOptions[platform] && typeof connectorOptions[platform] === 'object'
        ? connectorOptions[platform]
        : {};
      if (!String(existing.location || '').trim()) {
        connectorOptions[platform] = { ...existing, location: explicitJobLocation };
      }
    }
  }
  if (selectedPlatforms.includes('aihot')) {
    connectorOptions.aihot = aiHotOptions(userText, connectorOptions.aihot || {});
  }
  // An explicit request to remove keyword filtering is authoritative for an
  // AI HOT-only run. Clear both stale fallback keywords and planner echoes.
  // The planner may also echo the source category itself as a query, for example
  // “最近的 AI 新闻” -> keywords=["AI新闻"]. For an AI HOT-only request that
  // should mean “return the latest items”, not a literal search for the phrase
  // “AI新闻”. Keep explicitly labelled user keywords and real subjects such as
  // OpenAI, Sora or AI Agent untouched.
  if (selectedPlatforms.length === 1
    && selectedPlatforms[0] === 'aihot'
    && String(connectorOptions.aihot?.content_mode || 'items') === 'items') {
    if (explicitlyRequestsEmptyKeywords(platformIntentText)) keywords = [];
    else if (explicitUserKeywords.length === 0) keywords = keywords.filter((keyword) => !isAiHotGenericKeyword(keyword));
  }

  const contentEnrichment = normalizeContentEnrichment(
    input?.contentEnrichment,
    userText,
    selectedPlatforms,
    capability,
    collectionDepth,
    skill,
  );

  const rawExpansionMode = input?.queryExpansion?.mode;
  const inferredExpansionMode = inferQueryExpansionMode(userText);
  const expansionMode: 'strict' | 'fallback' | 'broad' = ['strict', 'fallback', 'broad'].includes(String(rawExpansionMode))
    ? rawExpansionMode
    : inferredExpansionMode;
  const queryExpansion: QueryExpansionConfig = {
    mode: expansionMode,
    maxQueriesPerKeyword: Math.max(1, Math.min(Number(input?.queryExpansion?.maxQueriesPerKeyword) || 2, 3)),
    preserveOriginal: input?.queryExpansion?.preserveOriginal !== false,
  };

  return {
    skillId: skill?.id || fallbackPlan?.skillId || 'multi-source-research',
    goal,
    platforms: selectedPlatforms,
    keywords,
    capability,
    targets,
    connectorOptions,
    contentEnrichment,
    queryExpansion,
    collectionDepth: hasExplicitCollectionDepth(userText) || preserveFallbackDepth
      ? collectionDepth
      : skill?.defaults?.collectionDepth || collectionDepth,
    loginType,
    headless: Boolean(input?.headless),
    analysis,
    analysisSource,
    autoAnalyze,
    outputs: skill?.defaults?.outputs?.length
      ? skill.defaults.outputs
      : Array.isArray(input?.outputs) ? input.outputs.map(String).slice(0, 5) : ['csv'],
  };
}

export function looksLikeSimulatedPlanReply(text: string): boolean {
  return /确认后(?:开始|执行)|确认无误.*(?:开始|执行)/s.test(text)
    || /平台\s*[:：].{0,120}(?:关键词|目标|采集范围)\s*[:：]/s.test(text)
    || /(?:计划|任务)(?:已|已经)(?:生成|创建|进入队列|开始执行)/.test(text)
    || /(?:正在执行(?:中)?|已开始采集|正在采集|采集中)/.test(text);
}

function mergePlan(base: ResearchPlan, patch: Partial<ResearchPlan>): ResearchPlan {
  const collectionDepth = patch.collectionDepth || base.collectionDepth;
  return {
    ...base,
    ...patch,
    platforms: Array.isArray(patch.platforms) ? patch.platforms : base.platforms,
    keywords: Array.isArray(patch.keywords) ? patch.keywords : base.keywords,
    targets: Array.isArray(patch.targets) ? patch.targets : base.targets,
    connectorOptions: patch.connectorOptions && typeof patch.connectorOptions === 'object' ? patch.connectorOptions : base.connectorOptions,
    contentEnrichment: patch.contentEnrichment || base.contentEnrichment,
    collectionDepth,
    analysis: Array.isArray(patch.analysis) ? patch.analysis : base.analysis,
    outputs: Array.isArray(patch.outputs) ? patch.outputs : base.outputs,
  };
}

function conversationalTurnsSinceReminder(messages: any[]): number {
  let turns = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (message.metadata?.redirect_reminded || message.metadata?.action !== 'chat') break;
    turns++;
  }
  return turns;
}

function ensureMessageNotAborted(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

function conversationMessages(thread: any): Array<{ role: 'user' | 'assistant'; content: string }> {
  return (thread.messages || [])
    .filter((message: any) => ['user', 'assistant'].includes(message.role))
    .slice(-20)
    .map((message: any) => ({
      role: message.role as 'user' | 'assistant',
      content: String(message.content).slice(0, 8_000),
    }));
}

export class AgentService {
  private workflowTick: Promise<void> | null = null;
  private memoryCaptureQueue: Promise<void> = Promise.resolve();
  private processedMemoryMessageIds = new Set<string>();
  private timer: NodeJS.Timeout;
  constructor() {
    this.timer = setInterval(() => this.tick().catch((error) => console.error('[AgentService]', error)), 1500);
    this.timer.unref();
  }

  private collectMaterials(thread: any, includePlanId?: string): ConversationMaterials {
    const attachmentIds = new Set<string>();
    const referenceMap = new Map<string, Set<string>>();
    for (const message of thread.messages || []) {
      if (message.role !== 'user') continue;
      for (const attachment of message.metadata?.attachments || []) {
        if (typeof attachment?.attachment_id === 'string') attachmentIds.add(attachment.attachment_id);
      }
      for (const reference of message.metadata?.task_references || []) {
        if (typeof reference?.plan_id !== 'string') continue;
        const selected = referenceMap.get(reference.plan_id) || new Set<string>();
        for (const platform of reference.platforms || []) if (SUPPORTED.includes(platform)) selected.add(platform);
        referenceMap.set(reference.plan_id, selected);
      }
    }
    const allPlans = agentRepository.listPlans(thread.thread_id);
    if (includePlanId) {
      const targetPlan = agentRepository.getPlan(includePlanId);
      if (targetPlan && ['completed', 'partially_completed'].includes(targetPlan.status) && !referenceMap.has(includePlanId)) {
        referenceMap.set(includePlanId, new Set());
      }
    }
    if (referenceMap.size === 0) {
      for (const plan of allPlans) {
        if (['completed', 'partially_completed'].includes(plan.status)) {
          referenceMap.set(plan.plan_id, new Set());
        }
      }
    }

    const texts: ConversationMaterials['texts'] = [];
    const images: ConversationMaterials['images'] = [];
    let remainingChars = 32_000;
    for (const attachment of agentRepository.getAttachments(thread.thread_id, [...attachmentIds])) {
      if (attachment.kind === 'image' && attachment.storage_path) {
        try {
          const data = fs.readFileSync(attachment.storage_path).toString('base64');
          images.push({ label: attachment.file_name, dataUrl: `data:${attachment.mime_type};base64,${data}` });
        } catch {}
        continue;
      }
      if (remainingChars <= 0) break;
      const value = attachment.text_content.slice(0, remainingChars);
      if (value) texts.push({ label: `上传文件：${attachment.file_name}`, content: value });
      remainingChars -= value.length;
    }
    for (const [planId, platforms] of referenceMap) {
      if (remainingChars <= 0) break;
      const plan = agentRepository.getPlan(planId);
      if (!plan || !['completed', 'partially_completed'].includes(plan.status)) continue;
      const rows = agentRepository.getPlanContents(planId, 60, [...platforms]);
      const value = JSON.stringify({ goal: plan.goal, selected_platforms: [...platforms], records: rows }).slice(0, remainingChars);
      texts.push({ label: `采集任务：${plan.goal}`, content: value });
      remainingChars -= value.length;
    }
    return { texts, images: images.slice(0, 5) };
  }

  private recallMemories(query: string): ConversationMemory[] {
    return agentRepository.retrieveMemories(query).map((memory) => ({
      category: memory.category,
      content: memory.content,
      source: memory.memory_key.startsWith('user_manual_') ? 'manual' : 'automatic',
    }));
  }

  private scheduleMemoryCapture(threadId: string, latestUserText: string) {
    const settings = agentRepository.getMemorySettings();
    if (!settings.enabled || !settings.autoCapture) return;

    // 过滤无实质意义的简单字符
    const trimmed = latestUserText.trim();
    if (!trimmed || /^(好|嗯|对|是的|收到|ok|1|666|Thanks|谢谢)$/i.test(trimmed)) return;

    const sourceThread = agentRepository.getThread(threadId);
    const sourceMessage = [...(sourceThread?.messages || [])]
      .reverse()
      .find((message: any) => message.role === 'user' && String(message.content).trim() === trimmed);
    if (!sourceMessage) return;
    const sourceMessageId = String(sourceMessage.message_id);

    this.memoryCaptureQueue = this.memoryCaptureQueue.then(async () => {
      if (this.processedMemoryMessageIds.has(sourceMessageId)) return;
      const recentUserMessages = (sourceThread?.messages || [])
        .filter((message: any) => message.role === 'user' && typeof message.content === 'string' && message.content.trim())
        .slice(-4);
      const recent = recentUserMessages.length
        ? recentUserMessages.map((m: any) => ({
            messageId: String(m.message_id),
            content: String(m.content).trim().slice(0, 1200),
          }))
        : [{ messageId: sourceMessageId, content: trimmed.slice(0, 1200) }];

      const allMemories = agentRepository.listMemories();
      const existingMemories = allMemories
        .filter((memory) => !memory.memory_key.startsWith('user_manual_'))
        .map((memory) => ({
          memoryKey: memory.memory_key,
          category: memory.category,
          content: memory.content,
          status: memory.status === 'candidate' ? 'candidate' as const : 'active' as const,
          confidence: memory.confidence,
          evidenceCount: memory.evidence_count || 1,
        }));
      const manualMemories = allMemories
        .filter((memory) => memory.memory_key.startsWith('user_manual_'))
        .map((memory) => memory.content);
      const result = await modelService.consolidateMemories(recent, existingMemories, manualMemories, settings.captureMode);
      if (!result) return;

      agentRepository.applyAutomaticMemoryMutations(
        result.mutations,
        settings.captureMode,
        threadId,
      );
      this.processedMemoryMessageIds.add(sourceMessageId);
    }).catch((error) => console.warn('[MemoryCapture]', error.message || error));
  }

  private scheduleThreadTitle(threadId: string) {
    const thread = agentRepository.getThread(threadId);
    if (!thread || thread.title_locked || ['manual', 'generated'].includes(String(thread.title_source))) return;
    const conversation = (thread.messages || [])
      .filter((message: any) => ['user', 'assistant'].includes(message.role))
      .map((message: any) => ({
        role: message.role as 'user' | 'assistant',
        content: String(message.content),
      }));
    const firstMeaningfulUser = conversation.findIndex((message: any) =>
      message.role === 'user' && isMeaningfulTitleInput(message.content),
    );
    if (firstMeaningfulUser < 0) return;
    const messages = conversation
      .slice(firstMeaningfulUser)
      .slice(0, 6)
      .filter((message: any) => message.role !== 'user' || isMeaningfulTitleInput(message.content));

    void modelService.generateThreadTitle(messages).then((value) => {
      const title = sanitizeThreadTitle(value);
      if (title && isMeaningfulTitleInput(title)) agentRepository.updateAutomaticTitle(threadId, title, 'generated');
    }).catch((error) => console.warn('[ThreadTitle]', error.message || error));
  }

  async sendMessage(
    threadId: string,
    content: string,
    context: {
      attachment_ids?: string[];
      task_references?: Array<{ plan_id: string; platforms?: string[] }>;
      mentioned_connectors?: string[];
      mentioned_skills?: string[];
    } = {},
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
    onStatus?: (status: { phase: 'web_search' | 'reasoning'; message: string; sources?: any[]; retrieval?: string; analysis_coverage?: any; keywords?: string[] }) => void,
    options: { skipAddUserMessage?: boolean } = {},
  ) {
    const trace = new AgentRunTrace(threadId);
    return runWithAgentTrace(trace, () => this.sendMessageWithinTrace(
      threadId, content, context, signal, onDelta, onStatus, options,
    ));
  }

  private async sendMessageWithinTrace(
    threadId: string,
    content: string,
    context: {
      attachment_ids?: string[];
      task_references?: Array<{ plan_id: string; platforms?: string[] }>;
      mentioned_connectors?: string[];
      mentioned_skills?: string[];
    } = {},
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
    onStatus?: (status: { phase: 'web_search' | 'reasoning'; message: string; sources?: any[]; retrieval?: string; analysis_coverage?: any; keywords?: string[] }) => void,
    options: { skipAddUserMessage?: boolean } = {},
  ) {
    ensureMessageNotAborted(signal);
    const thread = agentRepository.getThread(threadId);
    if (!thread) throw new Error('任务不存在');
    const runTrace = currentAgentRunTrace() || new AgentRunTrace(threadId);
    const attachmentIds = Array.from(new Set((context.attachment_ids || []).map(String))).slice(0, 5);
    const attachments = agentRepository.getAttachments(threadId, attachmentIds);
    if (attachments.length !== attachmentIds.length) throw new Error('部分附件不存在或不属于当前任务');
    const taskReferences = (context.task_references || []).slice(0, 3).map((reference) => {
      const plan = agentRepository.getPlan(String(reference.plan_id || ''));
      if (!plan || !['completed', 'partially_completed'].includes(plan.status)) throw new Error('引用的采集任务不存在或尚未产生可分析结果');
      const available = new Set(plan.steps.map((step: any) => step.platform));
      const platforms = Array.from(new Set((reference.platforms || []).map(String)))
        .filter((platform) => SUPPORTED.includes(platform) && available.has(platform));
      return { plan_id: plan.plan_id, goal: plan.goal, platforms };
    });
    const mentionedConnectors = Array.from(new Set((context.mentioned_connectors || []).map(String)))
      .filter((connector) => SUPPORTED.includes(connector));
    const mentionedSkillIds = Array.from(new Set((context.mentioned_skills || []).map(String)));
    if (mentionedSkillIds.length > 1) throw new Error('每次只能调用一个技能或工具');
    const explicitlySelectedSkill = skillRegistry.find(mentionedSkillIds[0]);
    if (mentionedSkillIds.length && (!explicitlySelectedSkill || !explicitlySelectedSkill.mentionable)) {
      throw new Error('选择的技能或工具不存在或不能直接调用');
    }
    const messageMetadata = {
      attachments: attachments.map((attachment) => ({
        attachment_id: attachment.attachment_id, file_name: attachment.file_name,
        mime_type: attachment.mime_type, kind: attachment.kind, size_bytes: attachment.size_bytes,
      })),
      task_references: taskReferences,
      mentioned_connectors: mentionedConnectors,
      mentioned_skills: explicitlySelectedSkill ? [explicitlySelectedSkill.id] : [],
    };
    if (!options.skipAddUserMessage) {
      agentRepository.addMessage(threadId, 'user', 'text', content, messageMetadata);
    }
    const previousMeaningfulMessage = thread.messages.some((message: any) =>
      message.role === 'user' && isMeaningfulTitleInput(String(message.content)),
    );
    if (!previousMeaningfulMessage && isMeaningfulTitleInput(content) && !thread.title_locked) {
      agentRepository.updateAutomaticTitle(threadId, fallbackTitleFromText(content), 'fallback');
    }

    const latest = agentRepository.getLatestPlan(threadId);
    const previousMessage = thread.messages.at(-1);
    const lastUserMessage = [...thread.messages].reverse().find((message: any) => message.role === 'user');
    const lastAssistantMessage = [...thread.messages].reverse().find((message: any) => message.role === 'assistant');
    const awaitingClarification = previousMessage?.role === 'assistant' && previousMessage?.kind === 'clarify';
    const previousUserMessage = awaitingClarification
      ? lastUserMessage
      : null;
    const inheritedSkillId = awaitingClarification
      ? String(lastUserMessage?.metadata?.mentioned_skills?.[0] || '')
      : '';
    const activeSkill = explicitlySelectedSkill
      || skillRegistry.find(inheritedSkillId)
      || (latest?.status === 'awaiting_confirmation' ? skillRegistry.find(latest?.plan?.skillId) : null)
      || null;
    const explicitlyInvokedSkill = Boolean(explicitlySelectedSkill || inheritedSkillId);
    const inheritedConnectors = awaitingClarification && Array.isArray(lastUserMessage?.metadata?.mentioned_connectors)
      ? lastUserMessage.metadata.mentioned_connectors.map(String)
      : [];
    const activeMentionedConnectors = mentionedConnectors.length ? mentionedConnectors : inheritedConnectors;
    const planningText = previousUserMessage ? `${previousUserMessage.content}\n用户补充：${content}` : content;
    const localDecision = localIntentDecision(content, {
      planStatus: latest?.status,
      awaitingClarification,
      previousUserText: lastUserMessage?.content,
      previousAssistantText: lastAssistantMessage?.content,
      hasPreviousPlanKeywords: Boolean(latest?.plan?.keywords?.length),
      hasCollectedData: agentRepository.getThreadContents(threadId, 1).length > 0,
      mentionedConnectors: activeMentionedConnectors,
      mentionedSkills: explicitlySelectedSkill || inheritedSkillId ? [activeSkill?.id || ''].filter(Boolean) : [],
    });
    runTrace.recordRoute(localDecision.action, 'local');

    if (localDecision.action === 'direct_parse') {
      try {
        const result = await directParserService.parseSingleText(content);
        ensureMessageNotAborted(signal);
        const reply = directParserService.formatMarkdownReply(content, result);
        agentRepository.addMessage(threadId, 'assistant', 'text', reply, {
          action: 'direct_parse',
          succ: result.succ,
        });
        this.scheduleThreadTitle(threadId);
        this.scheduleMemoryCapture(threadId, content);
        return agentRepository.getThread(threadId);
      } catch (error: any) {
        ensureMessageNotAborted(signal);
        agentRepository.addMessage(threadId, 'assistant', 'status', `无水印解析请求发生异常：${error.message || '系统错误'}`, {
          action: 'direct_parse_error',
        });
        return agentRepository.getThread(threadId);
      }
    }

    const onRetry = (retryCount: number, maxRetries: number, delaySec: number, reason: string) => {
      crawlerManager.emit('log', {
        id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
        level: 'warning',
        message: `AI 接口调用失败，正在自动重试 ${retryCount} / ${maxRetries}（等待 ${delaySec}s）...`,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        platform: 'system',
        thread_id: threadId,
        retry_count: retryCount,
        max_retries: maxRetries,
        delay_sec: delaySec,
        retry_reason: reason,
      });
    };

    const profile = modelService.getProfile(false);
    if (!profile.apiKeyConfigured) {
      agentRepository.addMessage(threadId, 'assistant', 'text', '还没有配置 AI 模型 API Key。请打开“模型设置”完成配置，然后重新发送这条问题。', {
        action: 'model_setup_required',
        error: 'unconfigured',
      });
      return agentRepository.getThread(threadId);
    }

    if (shouldUseExperimentalResearchLoop(content, {
      mentionedConnectors: activeMentionedConnectors,
      mentionedSkills: mentionedSkillIds,
    })) {
      runTrace.recordRoute('research_loop', 'explicit_opt_in');
      try {
        onStatus?.({ phase: 'web_search', message: '正在进行深度研究…', retrieval: 'research_loop' });
        const updatedThread = agentRepository.getThread(threadId);
        const result = await researchLoop.run(content, {
          threadId,
          messages: conversationMessages(updatedThread),
          trace: runTrace,
          signal,
          onDelta,
          onStatus,
        });
        ensureMessageNotAborted(signal);
        const evidenceCounts = result.sources.reduce((counts, source) => {
          counts[source.evidenceType]++;
          if (source.evidenceType === 'web_page' && source.contentQuality === 'full') counts.full_web_page++;
          return counts;
        }, { knowledge: 0, search: 0, web_page: 0, full_web_page: 0 });
        agentRepository.addMessage(threadId, 'assistant', 'text', result.answer, {
          action: 'research_loop',
          retrieval: 'research_loop',
          sources: result.sources,
          research_steps: result.steps,
          stop_reason: result.stopReason,
          research_degraded: result.degraded,
          knowledge_scope: result.knowledgeScope,
          evidence_counts: evidenceCounts,
        });
        this.scheduleThreadTitle(threadId);
        this.scheduleMemoryCapture(threadId, content);
        return agentRepository.getThread(threadId);
      } catch (error: any) {
        ensureMessageNotAborted(signal);
        runTrace.finish(`研究失败：${error.message || '未知错误'}`);
        agentRepository.addMessage(threadId, 'assistant', 'status', `多来源研究失败：${error.message || '未知错误'}`, {
          action: 'research_loop_error',
          retrieval: 'research_loop',
          error: error.message || '未知错误',
        });
        return agentRepository.getThread(threadId);
      }
    }

    if (localDecision.action === 'direct_web_read') {
      const urls = extractWebUrls(content);
      try {
        onStatus?.({ phase: 'web_search', message: '正在读取网页正文…' });
        const result = await agentToolExecutor.execute<
          { urls: string[]; timeoutMs?: number },
          DirectWebReadResult
        >('direct_web_read', { urls, timeoutMs: 20_000 }, { threadId, signal }, runTrace);
        ensureMessageNotAborted(signal);
        const updatedThread = agentRepository.getThread(threadId);
        const messages = conversationMessages(updatedThread);
        const sources = directWebSourceCitations(result.articles);
        onStatus?.({ phase: 'reasoning', message: '正在总结网页内容…' });
        let emittedSources = false;
        const answer = (await modelService.answerWithWebPages(messages, result.articles, {
          onRetry,
          signal,
          onDelta: (delta) => {
            if (!emittedSources && sources.length) {
              emittedSources = true;
              try { onStatus?.({ phase: 'reasoning', message: '正在总结网页内容…', sources, retrieval: 'direct_web_read' }); } catch {}
            }
            onDelta?.(delta);
          },
        })).trim();
        ensureMessageNotAborted(signal);
        if (!answer) throw new Error('模型没有返回文本内容');
        agentRepository.addMessage(threadId, 'assistant', 'text', answer, {
          action: 'direct_web_read',
          retrieval: 'direct_web_read',
          sources: directWebSourceCitations(result.articles),
          failed_urls: result.failures,
        });
        this.scheduleThreadTitle(threadId);
        this.scheduleMemoryCapture(threadId, content);
        return agentRepository.getThread(threadId);
      } catch (error: any) {
        ensureMessageNotAborted(signal);
        agentRepository.addMessage(threadId, 'assistant', 'status', `网页读取或总结失败：${error.message || '未知错误'}`, {
          action: 'direct_web_read_error',
          retrieval: 'direct_web_read',
          urls,
          error: error.message || '未知错误',
        });
        return agentRepository.getThread(threadId);
      }
    }

    let decision: AgentDecision;
    if (['model_info', 'live_answer', 'execute', 'stop', 'status', 'analyze', 'export'].includes(localDecision.action)) {
      decision = localDecision;
    } else if (localDecision.action === 'chat' && ((attachments.length > 0 || taskReferences.length > 0) || isSimpleConversation(content))) {
      try {
        const updatedThread = agentRepository.getThread(threadId);
        const messages = conversationMessages(updatedThread);
        const redirectToResearch = conversationalTurnsSinceReminder(updatedThread.messages) + 1 >= 3;
        const materials = this.collectMaterials(updatedThread);
        const memories = this.recallMemories(content);
        const reply = (await modelService.converse(messages, { redirectToResearch, materials, memories, onRetry, signal, onDelta })).trim();
        ensureMessageNotAborted(signal);
        if (!reply) throw new Error('模型没有返回文本内容');
        agentRepository.addMessage(threadId, 'assistant', 'text', reply, {
          action: 'chat',
          redirect_reminded: redirectToResearch,
        });
        this.scheduleThreadTitle(threadId);
        this.scheduleMemoryCapture(threadId, content);
        return agentRepository.getThread(threadId);
      } catch (error: any) {
        ensureMessageNotAborted(signal);
        const reason = modelService.getRuntimeStatus().lastError || error.message || '未知错误';
        agentRepository.addMessage(threadId, 'assistant', 'status', `AI 服务连接失败：${reason}\n\n本次没有生成 AI 回复，请到“模型设置”检查配置并测试连接。`, {
          action: 'model_error',
          error: reason,
        });
        return agentRepository.getThread(threadId);
      }
    } else {
      const updatedThread = agentRepository.getThread(threadId);
      const messages = conversationMessages(updatedThread);
      try {
        const memories = this.recallMemories(content);
        decision = await modelService.decide(
          messages,
          latest ? { status: latest.status, plan: latest.plan } : null,
          onRetry,
          signal,
          skillPlanningContext(activeSkill),
          memories,
        );
        runTrace.recordRoute(decision.action, 'model');
        ensureMessageNotAborted(signal);
        if (
          localDecision.action === 'create_plan'
          && ['chat', 'live_answer', 'clarify', 'status', 'analyze', 'export'].includes(decision.action)
          && !(activeSkill && decision.action === 'clarify' && !/平台/.test(decision.reply))
        ) {
          // localDecision already confirmed both a subject and a platform are
          // present in this text (that's the only way it reaches create_plan),
          // so a model reply that instead reads it as a status/analyze/export
          // query is a misroute, not a legitimate alternative reading. Without
          // this, the model can silently discard an otherwise-complete
          // collection request and answer as if no plan exists.
          const generated = await modelService.createPlan(messages, planningText, onRetry, signal, skillPlanningContext(activeSkill));
          ensureMessageNotAborted(signal);
          decision = { action: 'create_plan', reply: '', plan: generated };
        } else if (localDecision.action === 'create_plan' && decision.action === 'revise_plan' && latest && !['awaiting_confirmation', 'queued', 'running'].includes(latest.status)) {
          decision = { ...decision, action: 'create_plan' };
        } else if (
          localDecision.action === 'execute'
          && latest?.status === 'awaiting_confirmation'
          && ['chat', 'clarify', 'status'].includes(decision.action)
        ) {
          // The user typed an unambiguous confirmation ("开始搜索"、"确认"…) while a
          // plan is sitting in awaiting_confirmation. That is the one moment where
          // starting execution is exactly what was asked, so a model reply that
          // instead chats or reports progress is a misroute. Only non-mutating
          // model actions are overridden here — a genuine revise_plan/stop/export
          // still wins, and this never creates a plan that the user has not seen.
          decision = localDecision;
        } else if (['status', 'analyze', 'export'].includes(localDecision.action)) {
          // These intents are backed by local state.  Do not let a model turn a
          // request to inspect real results into ordinary chat (and then claim it
          // cannot see the very records the application has just loaded).
          decision = localDecision;
        } else if (decision.action === 'create_plan' && localDecision.action !== 'create_plan') {
          // Creating a plan changes persistent state. The model may use the full
          // conversation for semantic routing, but it must not turn assistant
          // introductions or ordinary chat into collection parameters.
          decision = localDecision;
        }
      } catch (error: any) {
        ensureMessageNotAborted(signal);
        if (localDecision.action === 'create_plan') {
          try {
            const generated = await modelService.createPlan(messages, planningText, onRetry, signal, skillPlanningContext(activeSkill));
            ensureMessageNotAborted(signal);
            decision = { action: 'create_plan', reply: '', plan: generated };
          } catch (planError: any) {
            ensureMessageNotAborted(signal);
            const reason = modelService.getRuntimeStatus().lastError || planError.message || error.message || '未知错误';
            agentRepository.addMessage(threadId, 'assistant', 'status', `AI 计划解析失败：${reason}\n\n本次没有创建或执行任何任务，请重新描述采集平台和关键词后再试。`, {
              action: 'model_error', error: reason,
            });
            return agentRepository.getThread(threadId);
          }
        } else if (localDecision.action === 'clarify') {
          decision = localDecision;
        } else if (localDecision.action === 'execute' && latest?.status === 'awaiting_confirmation') {
          // Confirming an existing plan needs no model call — the plan is already
          // on screen and the user just approved it.
          decision = localDecision;
        } else if (localDecision.action === 'status') {
          // Status is read-only, so the deterministic result is a safe fallback
          // when the model cannot return a valid structured decision.
          decision = localDecision;
        } else {
          const reason = modelService.getRuntimeStatus().lastError || error.message || '未知错误';
          agentRepository.addMessage(threadId, 'assistant', 'status', `AI 服务连接失败：${reason}\n\n本次没有生成 AI 回复，请到“模型设置”检查配置并测试连接。`, {
            action: 'model_error', error: reason,
          });
          return agentRepository.getThread(threadId);
        }
      }
    }

    if (decision.action === 'model_info') {
      const profile = modelService.getProfile(false);
      const runtime = modelService.getRuntimeStatus();
      const providerName = profile.provider === 'custom' ? '自定义兼容接口' : profile.provider === 'minimax' ? 'MiniMax' : 'DeepSeek';
      const health = !profile.apiKeyConfigured
        ? '目前尚未配置 API Key，AI 对话不可用。'
        : runtime.lastError
          ? `不过最近一次模型调用失败：${runtime.lastError}。AI 对话当前不可用，请在“模型设置”中更新配置并测试连接。`
          : 'API Key 已配置；可以在“模型设置”中运行连接测试确认当前是否可用。';
      agentRepository.addMessage(threadId, 'assistant', 'text', `当前配置的是 ${profile.model}（${providerName}）。${health}`, { action: 'model_info' });
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'live_answer') {
      const query = String(decision.query || content).replace(/\s+/g, ' ').trim().slice(0, 300);
      try {
        onStatus?.({ phase: 'web_search', message: '正在联网搜索…' });
        const wantsFullText = /全文|正文|详细内容|核实(?:细节|原文)|总结(?:这些|搜索到的)?文章/i.test(content);
        const evidence = await agentToolExecutor.execute<
          { query: string; limit?: number; readMode?: 'snippet' | 'auto'; maxReadItems?: number },
          SearchEvidence[]
        >('live_search', {
          query,
          limit: 8,
          readMode: wantsFullText ? 'auto' : 'snippet',
          maxReadItems: wantsFullText ? 3 : 0,
        }, { threadId, signal }, runTrace);
        ensureMessageNotAborted(signal);
        if (!evidence.length) {
          agentRepository.addMessage(threadId, 'assistant', 'text', '这次没有检索到足够可靠的实时网页摘要，暂时无法据此回答。你可以补充更具体的地点、对象或时间后重试。', {
            action: 'live_answer', retrieval: 'live_search', query, sources: [],
          });
          this.scheduleThreadTitle(threadId);
          return agentRepository.getThread(threadId);
        }

        const updatedThread = agentRepository.getThread(threadId);
        const messages = conversationMessages(updatedThread);
        const sources = toLiveSourceCitations(evidence);
        onStatus?.({ phase: 'reasoning', message: '正在分析搜索结果…' });
        let emittedSources = false;
        const answer = (await modelService.answerWithLiveEvidence(messages, evidence, {
          onRetry,
          signal,
          onDelta: (delta) => {
            if (!emittedSources && sources.length) {
              emittedSources = true;
              try { onStatus?.({ phase: 'reasoning', message: '正在分析搜索结果…', sources, retrieval: 'live_search' }); } catch {}
            }
            onDelta?.(delta);
          },
        })).trim();
        ensureMessageNotAborted(signal);
        if (!answer) throw new Error('模型没有返回文本内容');
        agentRepository.addMessage(threadId, 'assistant', 'text', answer, {
          action: 'live_answer',
          retrieval: 'live_search',
          query,
          fetched_at: evidence[0].fetchedAt,
          sources: toLiveSourceCitations(evidence),
        });
        this.scheduleThreadTitle(threadId);
        return agentRepository.getThread(threadId);
      } catch (error: any) {
        ensureMessageNotAborted(signal);
        const reason = modelService.getRuntimeStatus().lastError || error.message || '未知错误';
        agentRepository.addMessage(threadId, 'assistant', 'status', `实时检索回答失败：${reason}`, {
          action: 'live_answer_error', retrieval: 'live_search', error: reason,
        });
        return agentRepository.getThread(threadId);
      }
    }

    if (decision.action === 'chat' || decision.action === 'clarify') {
      const updatedThread = agentRepository.getThread(threadId);
      const messages = conversationMessages(updatedThread);
      const redirectToResearch = conversationalTurnsSinceReminder(updatedThread.messages) + 1 >= 3;
      const materials = this.collectMaterials(updatedThread);
      const memories = this.recallMemories(content);

      let reply = decision.reply.trim();
      if (decision.action === 'chat') {
        try {
          const converseReply = (await modelService.converse(messages, { redirectToResearch, materials, memories, onRetry, signal, onDelta })).trim();
          if (converseReply) {
            reply = looksLikeSimulatedPlanReply(converseReply)
              ? '我还没有创建真实采集任务。请把平台和关键词放在一句话里告诉我，例如“采集 GitHub AI 热点”，我会直接创建并按安全策略开始执行。'
              : converseReply;
          }
        } catch {}
      }

      if (!reply) {
        agentRepository.addMessage(threadId, 'assistant', 'status', 'AI 模型没有返回有效回复。本次没有生成本地兜底内容，请检查模型配置后重试。', {
          action: 'model_error',
          error: 'empty_response',
        });
        return agentRepository.getThread(threadId);
      }
      agentRepository.addMessage(threadId, 'assistant', decision.action === 'clarify' ? 'clarify' : 'text', reply, {
        action: decision.action,
        missing_fields: decision.missingFields || [],
      });
      this.scheduleThreadTitle(threadId);
      this.scheduleMemoryCapture(threadId, content);
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'execute') {
      if (!latest || latest.status !== 'awaiting_confirmation') {
        const inferredPlatforms = inferResearchPlatforms(planningText);
        const inferredKeywords = inferResearchKeywords(planningText);
        if (inferredPlatforms.length > 0 && inferredKeywords.length > 0) {
          try {
            const updatedThread = agentRepository.getThread(threadId);
            const messages = conversationMessages(updatedThread);
            const generated = await modelService.createPlan(messages, planningText, onRetry, signal, skillPlanningContext(activeSkill));
            ensureMessageNotAborted(signal);
            const plan = applyConnectorHealthPolicy(
              normalizePlan(generated, planningText, latest?.plan, false, activeSkill, activeMentionedConnectors),
              planningText,
              activeMentionedConnectors,
            );
            if (plan.platforms.length > 0 && (plan.keywords.length > 0 || (plan.targets && plan.targets.length > 0) || allowsEmptyKeywords(plan))) {
              const created = agentRepository.createPlan(threadId, plan);
              this.executePlan(created.plan_id);
              agentRepository.addMessage(threadId, 'assistant', 'status', decision.reply || '好的，已生成采集计划并自动进入本地执行队列。', { plan_id: created.plan_id, action: 'execute' });
              const currentThread = agentRepository.getThread(threadId);
              if (!latest && ['default', 'fallback'].includes(String(currentThread?.title_source))) {
                agentRepository.updateAutomaticTitle(threadId, titleFromPlan(plan), 'plan');
              }
              this.scheduleThreadTitle(threadId);
              this.scheduleMemoryCapture(threadId, content);
              return agentRepository.getThread(threadId);
            }
          } catch { ensureMessageNotAborted(signal); }
        }
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前没有生成或挂起等待确认的采集计划。如果你想发起采集，请告诉我具体的平台和关键词（例如：“在小红书搜索 某品牌”）。', { action: 'chat' });
      } else {
        this.executePlan(latest.plan_id);
        agentRepository.addMessage(threadId, 'assistant', 'status', decision.reply || '好的，任务已进入本地执行队列。', { plan_id: latest.plan_id, action: 'execute' });
        this.scheduleThreadTitle(threadId);
        this.scheduleMemoryCapture(threadId, content);
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'stop') {
      if (!latest || !['queued', 'running'].includes(latest.status)) {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前没有正在执行的采集任务。', { action: 'chat' });
      } else {
        await this.stopPlan(latest);
        agentRepository.addMessage(threadId, 'assistant', 'status', decision.reply || '当前采集任务已停止。', { plan_id: latest.plan_id, action: 'stop' });
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'status') {
      if (!latest) {
        agentRepository.addMessage(threadId, 'assistant', 'status', '当前还没有采集任务，因此暂时没有已采集的信息。你可以先告诉我想调研的主题。', { action: 'status' });
      } else {
        agentRepository.addMessage(threadId, 'assistant', 'status', this.describePlanStatus(latest), { plan_id: latest.plan_id, action: 'status' });
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'export') {
      if (!latest || !latest.steps.some((step: any) => step.run_id)) {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前还没有可以导出的采集数据。请先完成一次采集任务。', { action: 'export' });
      } else {
        const stats = agentRepository.getPlanStats(latest.plan_id);
        const requestedExporter = /obsidian/i.test(content)
          ? 'obsidian'
          : /\bima\b/i.test(content)
            ? 'ima'
            : /json/i.test(content)
              ? 'json'
              : /markdown|md\b/i.test(content)
                ? 'markdown'
                : null;
        if (requestedExporter) {
          try {
            const result = await exportService.run(requestedExporter, latest.plan_id);
            ensureMessageNotAborted(signal);
            agentRepository.addMessage(
              threadId,
              'assistant',
              'export',
              `${requestedExporter.toUpperCase()} 导出完成，共 ${result.item_count} 篇资料。\n保存位置：${result.output_path}`,
              { action: 'export', exporter_id: requestedExporter, plan_id: latest.plan_id, ...result },
            );
          } catch (error: any) {
            ensureMessageNotAborted(signal);
            agentRepository.addMessage(threadId, 'assistant', 'status', `导出失败：${error.message}`, { action: 'export_error' });
          }
          return agentRepository.getThread(threadId);
        }
        agentRepository.addMessage(
          threadId,
          'assistant',
          'export',
          `当前任务的 Excel 表格已准备好，共 ${stats.content_count} 条内容。点击下方按钮下载；桌面版会保存到系统“下载”目录，并在完成后自动定位文件。`,
          { action: 'export', plan_id: latest.plan_id, record_count: stats.content_count },
        );
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'analyze') {
      const allThreadPlans = agentRepository.listPlans(threadId);
      const hasActiveOrCompletedPlan = allThreadPlans.some((p) => ['queued', 'running', 'completed', 'partially_completed'].includes(p.status));
      if (!hasActiveOrCompletedPlan && !latest) {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前还没有已完成的采集结果可以分析。', { action: 'chat' });
        return agentRepository.getThread(threadId);
      }
      // Prefer the specialised thread-level dataset profile and report generation.
      const datasetProfileReport = await analysisService.run('dataset.profile', undefined, { threadId });
      const datasetProfile = datasetProfileReport.metadata.datasetProfile;
      const documentCount = datasetProfile.documentCount;
      if (documentCount) {
        try {
          const analysisSkill = skillRegistry.find(latest?.plan?.skillId);
          const isPartialAnalysis = allThreadPlans.some((p) => ['queued', 'running'].includes(p.status));
          knowledgeIndex.rebuild({ threadId });
          const threadGoals = Array.from(new Set(allThreadPlans.map((p) => p.goal).filter(Boolean))).join('；');
          const threadAnalysisGoals = Array.from(new Set(allThreadPlans.flatMap((p) => p.plan?.analysis || [])));
          const report = await quickReportGenerator.generate({
            threadId,
            workflowId: latest?.plan_id,
            workflowGoal: threadGoals || latest?.goal || content,
            reportName: analysisSkill?.name || '采集结果分析',
            userRequest: content,
            analysisGoals: threadAnalysisGoals.length ? threadAnalysisGoals : (latest?.plan?.analysis || []),
            skillName: analysisSkill?.name,
            skillInstructions: analysisSkill?.analysisInstructions,
            datasetProfile,
            qualityGate: latest?.plan_id ? qualityGateService.latestFinal(latest.plan_id) || undefined : undefined,
            partial: isPartialAnalysis,
            signal,
            onRetry,
            onStatus,
            onDelta,
          });
          ensureMessageNotAborted(signal);
          const analysisReport = analysisService.saveReport({
            analyzerId: 'quick.report',
            analyzerVersion: '1.0.0',
            workflowId: latest?.plan_id,
            title: report.title,
            content: report.answer,
            metadata: {
              datasetProfileReportId: datasetProfileReport.report_id,
              coverage: report.coverage,
              evidenceSelection: report.evidenceSelection,
              sources: report.sources,
            },
          });
          const reportArtifact = reportArtifactService.create({
            reportId: analysisReport.report_id,
            threadId,
            workflowId: latest?.plan_id,
            title: report.title,
            content: report.answer,
            sources: report.sources,
            reproducibility: {
              analyzerId: 'quick.report', analyzerVersion: '1.0.0',
              datasetProfileReportId: datasetProfileReport.report_id,
              coverage: report.coverage,
              evidenceSelection: report.evidenceSelection,
            },
          });
          agentRepository.addMessage(threadId, 'assistant', 'analysis', report.answer, {
            retrieval: report.evidenceSelection.retrievalMode,
            sources: report.sources,
            partial: isPartialAnalysis,
            analysis_coverage: report.coverage,
            evidence_selection: report.evidenceSelection,
            dataset_profile_report_id: datasetProfileReport.report_id,
            analysis_report_id: analysisReport.report_id,
            report_artifact_id: reportArtifact.artifactId,
            graph_id: reportArtifact.graphId,
          });
        } catch (error: any) {
          ensureMessageNotAborted(signal);
          agentRepository.addMessage(threadId, 'assistant', 'status', `AI 分析失败：${error.message}`, { action: 'model_error', error: error.message });
        }
        return agentRepository.getThread(threadId);
      }

      const updatedThread = agentRepository.getThread(threadId);
      const referencedMaterials = this.collectMaterials(updatedThread, latest.plan_id);
      if (referencedMaterials.texts.length || referencedMaterials.images.length) {
        try {
          const messages = conversationMessages(updatedThread);
          let emittedStatus = false;
          const answer = await modelService.converse(messages, {
            materials: referencedMaterials,
            analysisGoals: latest.plan.analysis,
            skillInstructions: skillRegistry.find(latest.plan.skillId)?.analysisInstructions,
            onRetry, signal,
            onDelta: (delta) => {
              if (!emittedStatus && latest?.plan?.keywords?.length) {
                emittedStatus = true;
                onStatus?.({
                  phase: 'reasoning',
                  message: '正在分析采集数据…',
                  keywords: latest.plan.keywords,
                });
              }
              onDelta?.(delta);
            },
          });
          ensureMessageNotAborted(signal);
          agentRepository.addMessage(threadId, 'assistant', 'analysis', answer, { action: 'material_analysis' });
        } catch (error: any) {
          ensureMessageNotAborted(signal);
          agentRepository.addMessage(threadId, 'assistant', 'status', `AI 分析失败：${error.message}`, {
            action: 'model_error',
            error: error.message,
          });
        }
      } else {
        agentRepository.addMessage(threadId, 'assistant', 'analysis', '当前任务没有可分析的数据。可以先检查采集结果，或重试失败的平台。');
      }
      return agentRepository.getThread(threadId);
    }

    if (decision.action === 'create_plan' && latest) {
      if (latest.status === 'awaiting_confirmation') {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前轮次仍在等待确认。你可以继续修改范围，或确认后开始执行。', {
          action: 'plan_already_exists', plan_id: latest.plan_id,
        });
        return agentRepository.getThread(threadId);
      }
      if (['queued', 'running'].includes(latest.status)) {
        agentRepository.addMessage(threadId, 'assistant', 'text', '当前采集轮次仍在执行。完成后可以直接在这个任务里发起下一轮采集。', {
          action: 'plan_round_active', plan_id: latest.plan_id,
        });
        return agentRepository.getThread(threadId);
      }
    }

    let plan: ResearchPlan;
    if (decision.action === 'revise_plan' && latest?.status === 'awaiting_confirmation') {
      let patch = decision.plan;
      if (!patch || typeof patch !== 'object') {
        const fallbackPlatforms = inferResearchPlatforms(planningText);
        const fallbackKeywords = inferResearchKeywords(planningText);
        const fallbackDepth = inferCollectionDepth(planningText);
        patch = {
          ...(fallbackPlatforms.length ? { platforms: fallbackPlatforms } : {}),
          ...(fallbackKeywords.length ? { keywords: fallbackKeywords } : {}),
          collectionDepth: fallbackDepth,
        };
      }
      const candidate = mergePlan(latest.plan, patch);
      plan = normalizePlan(candidate, planningText, latest?.plan, true, activeSkill, activeMentionedConnectors);
    } else if (decision.action === 'create_plan') {
      if (decision.plan) plan = normalizePlan(decision.plan, planningText, latest?.plan, false, activeSkill, activeMentionedConnectors);
      else {
        const updatedThread = agentRepository.getThread(threadId);
        const messages = conversationMessages(updatedThread);
        try {
          const generated = await modelService.createPlan(messages, planningText, onRetry, signal, skillPlanningContext(activeSkill));
          ensureMessageNotAborted(signal);
          plan = normalizePlan(generated, planningText, latest?.plan, false, activeSkill, activeMentionedConnectors);
        }
        catch {
          ensureMessageNotAborted(signal);
          const fallbackKeywords = inferResearchKeywords(planningText);
          plan = normalizePlan({
            platforms: inferResearchPlatforms(planningText),
            keywords: fallbackKeywords,
          }, planningText, latest?.plan, false, activeSkill, activeMentionedConnectors);
        }
      }
    } else {
      const reply = decision.reply.trim();
      if (!reply) {
        agentRepository.addMessage(threadId, 'assistant', 'status', 'AI 模型没有返回有效回复，请检查模型配置后重试。', {
          action: 'model_error',
          error: 'empty_response',
        });
        return agentRepository.getThread(threadId);
      }
      agentRepository.addMessage(threadId, 'assistant', 'text', reply, { action: 'chat' });
      return agentRepository.getThread(threadId);
    }
    plan = applyConnectorHealthPolicy(plan, planningText, activeMentionedConnectors);
    if (!plan.platforms.length) {
      if (latest && ['completed', 'partially_completed'].includes(latest.status)) {
        const updatedThread = agentRepository.getThread(threadId);
        const referencedMaterials = this.collectMaterials(updatedThread, latest.plan_id);
        if (referencedMaterials.texts.length || referencedMaterials.images.length) {
          try {
            const messages = conversationMessages(updatedThread);
            let emittedStatus = false;
            const answer = await modelService.converse(messages, {
              materials: referencedMaterials,
              analysisGoals: latest.plan.analysis,
              skillInstructions: skillRegistry.find(latest.plan.skillId)?.analysisInstructions,
              onRetry, signal,
              onDelta: (delta) => {
                if (!emittedStatus && latest?.plan?.keywords?.length) {
                  emittedStatus = true;
                  onStatus?.({
                    phase: 'reasoning',
                    message: '正在分析采集数据…',
                    keywords: latest.plan.keywords,
                  });
                }
                onDelta?.(delta);
              },
            });
            ensureMessageNotAborted(signal);
            agentRepository.addMessage(threadId, 'assistant', 'analysis', answer, { action: 'material_analysis' });
            return agentRepository.getThread(threadId);
          } catch { ensureMessageNotAborted(signal); }
        }
      }
      agentRepository.addMessage(threadId, 'assistant', 'clarify', '你想采集哪些平台？可以直接说“小红书和微博”或“全部平台”。', {
        action: 'clarify', missing_fields: ['platforms'],
      });
      return agentRepository.getThread(threadId);
    }
    if (plan.capability === 'keyword_search' && !plan.keywords.length && !allowsEmptyKeywords(plan)) {
      agentRepository.addMessage(threadId, 'assistant', 'clarify', '你最想调研的具体品牌、产品、事件或主题是什么？', {
        action: 'clarify', missing_fields: ['subject'],
      });
      return agentRepository.getThread(threadId);
    }
    if (plan.capability && plan.capability !== 'keyword_search' && !(plan.targets || []).length) {
      agentRepository.addMessage(threadId, 'assistant', 'clarify', '这个任务需要明确的内容链接、作品 ID 或主页链接。请把要处理的目标发给我。', {
        action: 'clarify', missing_fields: ['targets'], capability: plan.capability,
      });
      return agentRepository.getThread(threadId);
    }
    const created = decision.action === 'revise_plan' && latest
      ? agentRepository.updatePendingPlan(latest.plan_id, plan)
      : agentRepository.createPlan(threadId, plan);
    const planSkill = skillRegistry.find(plan.skillId);
    const platformNames = plan.platforms.map((p) => LABELS[p]).join('、');
    const autoStart = shouldAutoStartPlan(plan, planningText, planSkill, explicitlyInvokedSkill);
    const lead = autoStart
      ? planSkill?.category === 'business'
        ? '已按该 Skill 的方案创建任务并开始采集。'
        : '已创建任务并开始采集。'
      : decision.action === 'revise_plan'
      ? '已按你的补充更新采集范围。'
      : '已识别并创建待确认的采集计划。';
    const messageKind = 'plan';
    const targetDescription = plan.capability === 'keyword_search'
      ? plan.keywords.join('、')
      : (plan.targets || []).join('、') || '待识别目标';

    const isOnlyAiQA = plan.platforms.length > 0 && plan.platforms.every((p: string) => {
      const manifest = getConnectorManifest(p);
      return manifest?.category === 'ai_web_qa'
        || ['deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin'].includes(p);
    });

    let scopeLine = '';
    if (!isOnlyAiQA) {
      const depth = plan.collectionDepth || 'quick';
      // Explicit per-platform overrides are the only thing left that can deviate from
      // the depth preset, so they are what's worth spelling out to the user.
      const overrides = Object.values(plan.connectorOptions || {});
      const overrideMaxItems = overrides.map((option) => Number(option?.max_items)).find((value) => Number.isFinite(value) && value > 0);
      const overrideStartPage = overrides.map((option) => Number(option?.start_page)).find((value) => Number.isFinite(value) && value > 1);
      let depthSummary: string;

      if (plan.customScopeDescription) {
        depthSummary = plan.customScopeDescription;
      } else if (depth === 'custom' || overrideMaxItems || overrideStartPage) {
        const details: string[] = [];
        if (overrideMaxItems) details.push(`每个关键词最多 ${overrideMaxItems} 条`);
        if (overrideStartPage) details.push(`从第 ${overrideStartPage} 页开始`);
        depthSummary = details.length ? details.join('，') : '自定义';
      } else {
        // Spell out what the depth actually resolves to. "范围：标准" alone told
        // the user nothing and did not match what the planner prompt promised.
        const capabilities = plan.platforms
          .map((platform: string) => getConnectorManifest(platform)?.capabilities
            .find((item) => item.id === (plan.capability || 'keyword_search')))
          .filter((item: any): item is NonNullable<typeof item> => Boolean(item));
        const detail = describeDepthForCapabilities(capabilities, depth);
        const label = DEPTH_LABELS[depth as DepthLevel] || '快速';
        depthSummary = depth === 'quick' && !hasExplicitCollectionDepth(planningText)
          ? `${label}（默认推荐${detail ? `；${detail}` : ''}）`
          : `${label}${detail ? `（${detail}）` : ''}`;
      }
      scopeLine = `\n范围：${depthSummary}`;
      const locations = Array.from(new Set(overrides
        .map((option) => String(option?.location || '').trim())
        .filter(Boolean)));
      if (locations.length) scopeLine += `\n地域：${locations.join('、')}`;
      if (plan.contentEnrichment.mode !== 'snippet') {
        const modeLabel = plan.contentEnrichment.mode === 'full' ? '尽量阅读全文' : '自动深度阅读';
        scopeLine += `\n正文：${modeLabel}，最多读取 ${plan.contentEnrichment.maxReadItems} 个网页，每域名最多 ${plan.contentEnrichment.maxPerDomain} 个`;
      } else if (plan.platforms.some((platform) => getConnectorManifest(platform)?.category === 'web_search')) {
        scopeLine += '\n正文：仅保留搜索摘要';
      }
    }

    // A fresh create_plan for a new round can silently pull in more platforms/keywords
    // than the previous round covered (the model is free to expand for better coverage).
    // Surface that expansion instead of letting the user confirm a broadened scope unknowingly.
    let diffLine = '';
    if (decision.action === 'create_plan' && latest) {
      const addedPlatforms = plan.platforms.filter((p) => !latest.plan.platforms.includes(p));
      const addedKeywords = plan.capability === 'keyword_search'
        ? plan.keywords.filter((k) => !latest.plan.keywords.includes(k))
        : [];
      const parts: string[] = [];
      if (addedPlatforms.length) parts.push(`平台新增 ${addedPlatforms.map((p) => LABELS[p]).join('、')}`);
      if (addedKeywords.length) parts.push(`关键词新增 ${addedKeywords.join('、')}`);
      if (parts.length) diffLine = `\n（相比上一轮，${parts.join('，')}；如果不需要可以直接告诉我去掉）`;
    }

    const skillLine = planSkill?.category === 'business' ? `\nSkill：${planSkill.name}` : '';
    const healthLines = (plan.healthPolicy?.decisions || [])
      .filter((item) => item.action !== 'use')
      .map((item) => item.action === 'replace'
        ? `${LABELS[item.connectorId] || item.connectorId} → ${LABELS[item.replacementId || ''] || item.replacementId}：${item.reason}`
        : `${LABELS[item.connectorId] || item.connectorId}：${item.reason}`);
    const healthLine = healthLines.length ? `\n连接器状态：${healthLines.join('；')}` : '';
    if (autoStart) this.executePlan(created.plan_id);
    const shouldAutoAnalyze = Boolean(
      plan.autoAnalyze || plan.analysis.length || planSkill?.execution.autoAnalyzeOnCompletion,
    );
    const nextStep = autoStart
      ? shouldAutoAnalyze
        ? '\n\n任务已进入执行队列，采集结束后会自动完成计划中的分析；如需调整，可以随时暂停。'
        : '\n\n任务已进入执行队列；如需调整，可以随时暂停。采集完成后可继续让我分析结果。'
      : '\n\n如果确认无误，直接告诉我可以开始；需要调整也可以继续补充。';
    const analysisLine = plan.analysis.length ? `\n分析重点：${plan.analysis.join('、')}` : '';
    agentRepository.addMessage(threadId, 'assistant', messageKind, `${lead}${skillLine}\n平台：${platformNames}\n${plan.capability === 'keyword_search' ? '关键词' : '目标'}：${targetDescription}${scopeLine}${healthLine}${diffLine}${analysisLine}${nextStep}`, {
      plan_id: created.plan_id,
      skill_id: planSkill?.id,
      action: autoStart ? 'execute' : decision.action,
      auto_started: autoStart,
    });
    // 计划只负责提供默认标题兜底，不覆盖用户首句或已经生成的会话标题。
    // 平台信息属于任务元数据，放在标题中会让同一平台的任务高度雷同。
    const currentThread = agentRepository.getThread(threadId);
    if (!latest && ['default', 'fallback'].includes(String(currentThread?.title_source))) {
      agentRepository.updateAutomaticTitle(threadId, titleFromPlan(plan), 'plan');
    }
    this.scheduleThreadTitle(threadId);
    this.scheduleMemoryCapture(threadId, content);
    return agentRepository.getThread(threadId);
  }

  async regenerateMessage(
    threadId: string,
    messageId: string,
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
    onStatus?: (status: { phase: 'web_search' | 'reasoning'; message: string; sources?: any[]; retrieval?: string; analysis_coverage?: any; keywords?: string[] }) => void,
  ) {
    ensureMessageNotAborted(signal);
    const target = agentRepository.deleteAssistantMessageForRegenerate(threadId, messageId);
    if (!target) throw new Error('未找到需要刷新回答的 AI 消息');

    const userMeta = target.userMessage.metadata || {};
    const context = {
      attachment_ids: Array.isArray(userMeta.attachments)
        ? userMeta.attachments.map((a: any) => String(a.attachment_id)).filter(Boolean)
        : [],
      task_references: Array.isArray(userMeta.task_references) ? userMeta.task_references : [],
      mentioned_connectors: Array.isArray(userMeta.mentioned_connectors) ? userMeta.mentioned_connectors : [],
      mentioned_skills: Array.isArray(userMeta.mentioned_skills) ? userMeta.mentioned_skills : [],
    };

    return this.sendMessage(
      threadId,
      target.userMessage.content,
      context,
      signal,
      onDelta,
      onStatus,
      { skipAddUserMessage: true },
    );
  }

  private async stopPlan(plan: any) {
    await workflowRuntime.cancel(plan.plan_id);
  }

  private describeStepFailures(plan: any): string {
    const failures = plan.steps
      .filter((step: any) => (step.status === 'failed' || step.status === 'cancelled') && step.error_message)
      .map((step: any) => `${LABELS[step.platform] || step.platform}：${step.error_message}`);
    return failures.length ? `\n失败原因：${failures.join('；')}` : '';
  }

  private describePlanStatus(plan: any): string {
    const stats = agentRepository.getPlanStats(plan.plan_id);
    const completed = plan.steps.filter((step: any) => step.status === 'completed').length;
    const targetPlatforms = (plan.plan?.platforms || []).map((p: string) => LABELS[p] || p).join('、');
    const targetInfo = targetPlatforms ? `（目标平台：${targetPlatforms}）` : '';
    const distribution = stats.by_platform.length
      ? `\n平台分布：${stats.by_platform.map((item) => `${item.platform_label || LABELS[item.platform] || item.platform} ${item.count} 条`).join('，')}。`
      : targetPlatforms ? `\n目标平台：${targetPlatforms}（暂无成功入库条目）。` : '';
    const failureReasons = this.describeStepFailures(plan);

    if (plan.status === 'awaiting_confirmation') return `当前计划${targetInfo}还在等待确认，尚未开始采集，所以已入库 0 条内容。`;
    if (plan.status === 'queued') return `任务正在排队${targetInfo}，目前已入库 ${stats.content_count} 条内容。${distribution}`.trim();
    if (plan.status === 'running') return `任务仍在采集中${targetInfo}，目前已入库 ${stats.content_count} 条内容，已完成 ${completed}/${plan.steps.length} 个采集阶段。${distribution}`.trim();
    if (plan.status === 'completed' && stats.content_count === 0) {
      return `本次任务${targetInfo}已完成，实际入库为 0 条内容。这通常表示搜索无匹配结果或数据未能写入；建议查看采集控制台日志。`.trim();
    }
    if (plan.status === 'completed') return `本次任务${targetInfo}已完成，共采集到 ${stats.content_count} 条内容。${distribution}`.trim();
    if (plan.status === 'partially_completed') return `本次任务${targetInfo}部分完成，共采集到 ${stats.content_count} 条内容，成功 ${completed}/${plan.steps.length} 个采集阶段。${distribution}${failureReasons}`.trim();
    if (plan.status === 'failed') return `本次任务${targetInfo}执行失败，目前实际入库 ${stats.content_count} 条内容。${distribution}${failureReasons || '\n建议查看采集控制台日志后重试。'}`.trim();
    if (plan.status === 'stopped') return `任务已停止${targetInfo}，停止前共入库 ${stats.content_count} 条内容。${distribution}`.trim();
    return `当前任务状态为 ${plan.status}${targetInfo}，已入库 ${stats.content_count} 条内容。${distribution}`.trim();
  }

  executePlan(planId: string, options?: { stepKeys?: string[]; platforms?: string[] }) {
    const plan = workflowRuntime.queue(planId, options);
    void this.tick();
    return plan;
  }

  updatePlan(planId: string, updates: {
    keywords?: string[];
    analysis?: string[];
    collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom';
    contentEnrichment?: Partial<ContentEnrichmentOptions>;
  }) {
    const current = agentRepository.getPlan(planId);
    if (!current) throw new Error('计划不存在');
    if (current.status !== 'awaiting_confirmation') throw new Error('只有等待确认的计划可以修改参数');
    const updatedPlan = { ...current.plan };
    if (Array.isArray(updates.keywords)) {
      const keywords = Array.from(new Set(updates.keywords.map((v) => String(v).trim()).filter(Boolean))).slice(0, 12);
      if (keywords.length > 0) updatedPlan.keywords = keywords;
    }
    if (Array.isArray(updates.analysis)) {
      updatedPlan.analysis = normalizeAnalysisGoals(updates.analysis, current.plan.goal);
      updatedPlan.analysisSource = 'user';
    }
    if (updates.collectionDepth && ['quick', 'standard', 'deep', 'custom'].includes(updates.collectionDepth)) {
      updatedPlan.collectionDepth = updates.collectionDepth;
    }
    if (updates.contentEnrichment && typeof updates.contentEnrichment === 'object') {
      updatedPlan.contentEnrichment = normalizeContentEnrichment(
        { ...current.plan.contentEnrichment, ...updates.contentEnrichment },
        '',
        current.plan.platforms,
        current.plan.capability,
        updatedPlan.collectionDepth,
        skillRegistry.find(current.plan.skillId),
      );
    }
    return agentRepository.updatePendingPlan(planId, updatedPlan);
  }

  updatePlanAnalysis(planId: string, analysis: unknown) {
    const current = agentRepository.getPlan(planId);
    if (!current) throw new Error('计划不存在');
    if (current.status !== 'awaiting_confirmation') throw new Error('只有等待确认的计划可以修改分析目标');
    if (!Array.isArray(analysis)) throw new Error('分析目标格式不正确');
    const goals = normalizeAnalysisGoals(analysis, current.plan.goal);
    return agentRepository.updatePendingPlan(planId, { ...current.plan, analysis: goals, analysisSource: 'user' });
  }

  async tick() {
    if (this.workflowTick) return;
    this.workflowTick = this.runWorkflowTick()
      .catch((error) => console.error('[WorkflowRuntime] Tick failed:', error))
      .finally(() => { this.workflowTick = null; });
  }

  private async runWorkflowTick(): Promise<void> {
    let needsProcessorRetry = false;
    for (const result of await workflowRuntime.tickAll()) {
      needsProcessorRetry ||= result.workflow.steps.some((step: any) =>
        step.kind === 'processor' && step.status === 'queued' && Number(step.attempt) > 0,
      );
      if (!result.becameTerminal) continue;
      const final = agentRepository.getPlan(result.workflow.workflow_id);
      if (!final) continue;
      const connectorSteps = final.steps.filter((step: any) => step.kind === 'connector');
      const completed = connectorSteps.filter((step: any) => step.status === 'completed').length;
      const status = final.status;
      const totalItems = final.stats?.content_count ?? 0;
      const autoAnalyzed = result.workflow.steps.some((step: any) =>
        step.step_key === 'business-analysis'
          && step.status === 'completed'
          && !step.output?.failed
          && !step.output?.skipped,
      );
      if (autoAnalyzed) continue;

      if (['completed', 'partially_completed'].includes(status) && totalItems > 0
        && (final.plan?.autoAnalyze || final.plan?.analysis?.length)) {
        const existingReport = agentRepository.getThread(final.thread_id)?.messages?.some((message: any) =>
          message.kind === 'analysis' && message.metadata?.plan_id === final.plan_id,
        );
        if (!existingReport) {
          try {
            const datasetProfileReport = await analysisService.run('dataset.profile', undefined, { threadId: final.thread_id });
            const datasetProfile = datasetProfileReport.metadata.datasetProfile;
            if (datasetProfile?.documentCount) {
              const analysisSkill = skillRegistry.find(final.plan.skillId);
              knowledgeIndex.rebuild({ threadId: final.thread_id });
              const report = await quickReportGenerator.generate({
                threadId: final.thread_id,
                workflowId: final.plan_id,
                workflowGoal: final.goal,
                reportName: analysisSkill?.name || '采集结果分析',
                userRequest: `分析本次“${final.goal}”的采集结果`,
                analysisGoals: final.plan.analysis,
                skillName: analysisSkill?.name,
                skillInstructions: analysisSkill?.analysisInstructions,
                datasetProfile,
                qualityGate: qualityGateService.latestFinal(final.plan_id) || undefined,
              });
              const analysisReport = analysisService.saveReport({
                analyzerId: 'quick.report',
                analyzerVersion: '1.0.0',
                workflowId: final.plan_id,
                title: report.title,
                content: report.answer,
                metadata: {
                  datasetProfileReportId: datasetProfileReport.report_id,
                  coverage: report.coverage,
                  evidenceSelection: report.evidenceSelection,
                  sources: report.sources,
                },
              });
              const reportArtifact = reportArtifactService.create({
                reportId: analysisReport.report_id,
                threadId: final.thread_id,
                workflowId: final.plan_id,
                title: report.title,
                content: report.answer,
                sources: report.sources,
                reproducibility: {
                  analyzerId: 'quick.report', analyzerVersion: '1.0.0',
                  datasetProfileReportId: datasetProfileReport.report_id,
                  coverage: report.coverage,
                  evidenceSelection: report.evidenceSelection,
                },
              });
              agentRepository.addMessage(final.thread_id, 'assistant', 'analysis', report.answer, {
                plan_id: final.plan_id,
                retrieval: report.evidenceSelection.retrievalMode,
                sources: report.sources,
                dataset_profile_report_id: datasetProfileReport.report_id,
                analysis_report_id: analysisReport.report_id,
                report_artifact_id: reportArtifact.artifactId,
                graph_id: reportArtifact.graphId,
              });
              continue;
            }
          } catch (e) {
            console.error('[AgentService] Auto analysis on completion failed:', e);
          }
        }
      }

      const text = status === 'completed'
        ? `采集完成：${completed} 个平台均已成功，共采集到 ${totalItems} 条数据。你可以继续问我“分析这些结果”，或前往结果看板查看和导出。`
        : `采集已结束：${completed} 个平台成功，${connectorSteps.length - completed} 个平台失败或停止，共采集到 ${totalItems} 条数据。成功数据仍可分析，也可以重试失败步骤。`;
      agentRepository.addMessage(final.thread_id, 'assistant', 'status', text, { plan_id: final.plan_id, status });
    }
    if (needsProcessorRetry) {
      const retryTimer = setTimeout(() => { void this.tick(); }, 1000);
      retryTimer.unref();
    }
  }
}

export const agentService = new AgentService();
