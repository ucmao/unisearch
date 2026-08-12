import type { ResearchPlan } from './AgentRepository';
import { isAnalysisRevisionRequest } from './ResearchAnalysis';

export type AgentAction = 'chat' | 'live_answer' | 'clarify' | 'model_info' | 'create_plan' | 'revise_plan' | 'execute' | 'stop' | 'status' | 'analyze' | 'export' | 'direct_parse' | 'direct_web_read';

export interface AgentDecision {
  action: AgentAction;
  reply: string;
  missingFields?: string[];
  plan?: Partial<ResearchPlan> | null;
  /** Search phrase proposed by the model for a one-shot live answer. */
  query?: string;
}

export interface IntentContext {
  planStatus?: string | null;
  awaitingClarification?: boolean;
  previousUserText?: string;
  previousAssistantText?: string;
  hasPreviousPlanKeywords?: boolean;
  /** The thread already owns persisted collection results, regardless of the latest plan status. */
  hasCollectedData?: boolean;
  /** Connector ids the user explicitly picked from the "@" mention menu (see useMentionCommands). */
  mentionedConnectors?: string[];
  /** Business Skill ids the user explicitly picked from the "@" mention menu. */
  mentionedSkills?: string[];
}

const GREETING = /^(?:hi|hello|hey|ni\s*hao|你好(?:呀|啊)?|您好|嗨|哈喽|在吗|早上好|早安|下午好|晚上好|晚安)[!！,.，。?？~～\s]*$/i;
const THANKS = /^(?:谢谢|感谢|多谢|好的谢谢|谢啦|thanks|thank you)[!！,.，。~～\s]*$/i;
const GOODBYE = /^(?:再见|拜拜|回头见|bye|goodbye)[!！,.，。~～\s]*$/i;
const CAPABILITY = /你(?:可以|能|会)(?:做|干)?什么|你有(?:什么|哪些)功能|(?:可以|能)提供(?:什么|哪些)功能|怎么用|使用帮助|功能介绍|what can you do|\bhelp\b/i;
const PLATFORM_CAPABILITY = /(?:支持|可以|能).*(?:采集|抓取|搜索)?.*(?:什么|哪些)平台|(?:什么|哪些)平台.*(?:支持|可以|能)|支持的平台/i;
const RESEARCH_HOW_TO = /(?:采集|收集|搜索|调研|任务).*(?:怎么做|怎么用|如何操作|操作流程|步骤)|(?:怎么|如何).*(?:采集|收集|搜索|调研|创建任务)/i;
const MODEL_INFO = /(?:你|当前|现在)?(?:用的|使用的|配置的)?(?:是)?什么模型|模型(?:名称|版本|信息)|which model/i;
const WEATHER = /天气|气温|下雨|降雨|温度|weather/i;
const CURRENT_FACT = /(?:今天|现在|当前|最新|最近).*(?:汇率|价格|行情|新闻|资讯|比分|排名)|(?:汇率|价格|行情|新闻|资讯|比分|排名).*(?:今天|现在|当前|最新|最近)/i;
const LOCATION = /^(?:我在|我住在|城市是|地点是)?\s*[\u4e00-\u9fa5]{2,12}(?:市)?[!！,.，。\s]*$/;
const CONFIRM_PARTICLE = '(?:呀|啊|吧|呗|哈|咯|呐|哦|捏)?';
// “开始/立即/马上……” 后面接采集类动词（搜索、采集、跑……）同样是确认，而不是一条新的调研请求。
// 少了这一条，“开始搜索。”会先落到 RESEARCH 分支被当成缺平台的新需求，用户看起来就像“对话里没法启动任务”。
const CONFIRM_VERB = '(?:采集|搜索|搜|抓取|收集|执行|跑|干活)';
const CONFIRM = new RegExp(`^(?:确认|确认并执行|(?:开始|立即|马上|现在|直接|这就)?(?:就)?${CONFIRM_VERB}(?:吧|了)?|开始|开始吧|直接开始|开搜|按默认|按默认直接开始|按默认 直接开始|按照默认|按照默认直接开始|按照默认 直接开始|执行这个计划|开跑|跑起来|可以|可以的|好的?|行|没问题|就这样|ok|okay|就按(?:这个|该计划|上面的计划)(?:来|执行|开始)?|按(?:这个|该计划|上面的计划)(?:来|执行|开始)?)${CONFIRM_PARTICLE}[!！,.，。~～\\s]*$`, 'i');
const FORCE_EXECUTE = new RegExp(`^(?:执行|开跑|跑起来)${CONFIRM_PARTICLE}[!！,.，。~～\\s]*$`, 'i');
const STOP = /(?:停止|停下|停一下|暂停|取消)(?:采集|任务|执行)?|(?:stop|cancel)(?:\s+(?:task|run))?/i;
// Keep the local status fast path deliberately narrow. Natural-language
// collection goals often contain words such as “多少” (“采集招聘网站，平均薪资
// 是多少”), but that does not make them questions about an existing run. Only
// phrases that explicitly refer to task state/progress or already-collected
// result counts are deterministic enough to bypass semantic routing.
const STATUS_QUERY = /(?:任务).*(?:情况|状态|进度|怎么样|完成)|(?:采集|收集|抓取)(?:任务)?(?:到|了|得).*(?:多少|几条|情况|状态|进度|怎么样|完成)|(?:采集|收集|抓取)(?:进度|情况|状态|结果|数据).*(?:多少|几条|怎么样|如何|完成)|(?:多少|几条).*(?:已采集|已收集|已抓取|采集结果|收集结果|抓取结果)|采集到了吗|(?:执行|开始|开跑|跑起来)(?:了)?吗/i;
const EXPORT = /(?:导出|下载|生成).*(?:Excel|XLSX|CSV|表格|数据|结果|Markdown|Obsidian|JSON|IMA)|(?:Excel|XLSX|CSV|表格|Markdown|Obsidian|JSON|IMA).*(?:导出|下载|生成)/i;
const ANALYZE = /分析|总结|结论|对比|洞察|报告|简报|提炼|挖掘|梳理|剖析|交叉(?:验证|核验)|原因|评价|评价如何|怎么看|归纳|舆情|趋势|正负面|正面|负面|都要|全都要|侧重/i;
const REVISE_ACTION = '(?:加上|增加|添加|再加|也要|去掉|删除|移除|不要|改成|改为|换成|换一个|更换|替换|修改|调整|只要)';
const REVISE_FIELD = '(?:RSS|Atom|订阅源|GitHub|小红书|抖音|快手|B站|哔哩哔哩|微博|贴吧|知乎|百度|必应|360|搜狗|头条搜索|arXiv|论文库|AI HOT|AI热点|AI热榜|DeepSeek|Kimi|豆包|千问|通义千问|Qwen|元宝|腾讯元宝|纳米AI|纳米 AI|文心|文心一言|文心言|文小言|BOSS\\s*直聘|zhipin\\.com|平台|关键词|评论|页|后台|分析目标|分析维度|关注重点)';
const REVISE = new RegExp(`(?:${REVISE_ACTION}.*${REVISE_FIELD}|${REVISE_FIELD}.*${REVISE_ACTION})`, 'i');
const RESEARCH = /采集|收集|抓取|搜索|搜(?:一下)?|查询|检索|查(?:找|一下)|调查|调研|研究|监测|做(?:个|一份)?报告|(?:我)?(?:想|要|想要)了解|帮我(?:查|搜|看看)|(?:网上|全网|各平台|社交媒体).*(?:口碑|评价|讨论|反馈|怎么说)|(?:看看|了解)(?:大家|网友|用户).*(?:评价|看法|反馈|怎么说)|(?:RSS|Atom|订阅源).*(?:新闻|更新|文章|资讯)|(?:GitHub|AI HOT|AI热点|AI热榜).*(?:趋势|热门|仓库|项目|热点|日报|新闻|资讯|动态|消息)|(?:去|到|在)?(?:RSS|Atom|订阅源|GitHub|小红书|抖音|快手|B站|哔哩哔哩|微博|百度贴吧|贴吧|知乎|百度|必应|360|搜狗|头条搜索|arXiv|论文库|AI HOT|AI热点|AI热榜|DeepSeek|Kimi|豆包|千问|通义千问|Qwen|元宝|腾讯元宝|纳米AI|纳米 AI|文心|文心一言|文心言|文小言|BOSS\s*直聘|(?:[\w-]+\.)*zhipin\.com)(?:上|里)?(?:搜|找|查|查询|检索|问|看看|读取)/i;
const ONE_SHOT_WEB_SEARCH = /(?:联网|上网|网上)(?:搜索|检索|查询|查找|搜|查)(?:一下)?/i;
const PERSISTENT_RESEARCH = /采集|收集|抓取|批量|数据集|监测|调研|研究|建立任务|创建任务|做(?:个|一份)?报告/i;
const BOSS_STRONG_MENTION = /(?:BOSS\s*直聘|(?:^|[^\w.-])(?:https?:\/\/)?(?:[\w-]+\.)*zhipin\.com\b)/i;
const BOSS_CONTEXTUAL_MENTION = /(?:在|去|到|从|用|通过|打开|访问)\s*@?\bboss\b(?=\s*(?:直聘|招聘(?:平台|网站)|平台|网站|app|上|里|中|搜索|搜|查询|查|找|采集|抓取))|(?:^|[\s，。；;、@])boss\b(?=\s*(?:直聘|招聘(?:平台|网站)|平台|网站|app|上|里|中|搜索|搜|查询|查|找|采集|抓取))/i;
// A bare "BOSS" is also unambiguous when it is one item in a platform list,
// e.g. "智联、猎聘、BOSS、前程无忧". Requiring list separators on both
// sides preserves ordinary English uses such as "Boss 招聘员工".
const BOSS_LIST_MENTION = /(?:^|[、,，和与])\s*@?boss\b(?=\s*(?:[、,，和与]|$))/i;
const DIRECT_WEB_READ = /阅读|读取|阅读全文|查看(?:一下)?(?:这个|该|以下)?(?:网页|页面|文章|链接|网址|URL)?|看看?(?:这个|该|以下)?(?:网页|页面|文章|链接|网址|URL)|网页正文|正文内容|总结|概括|归纳|解读|告诉我|介绍(?:一下)?|讲了什么|(?:是什么|有哪些|怎么样|如何|为何|为什么|是否|能否|亮点|核心|重点|主要内容)/i;
const ALL_PLATFORM_IDS = [
  'xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu', 'baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso',
  'arxiv', 'github_repositories', 'rss_news', 'aihot', 'deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin', 'heimao', 'boss', 'zhaopin', 'job51', 'liepin',
];

function hasBossPlatformMention(text: string): boolean {
  return BOSS_STRONG_MENTION.test(text) || BOSS_CONTEXTUAL_MENTION.test(text) || BOSS_LIST_MENTION.test(text);
}

function hasExcludedBossMention(segment: string): boolean {
  return BOSS_STRONG_MENTION.test(segment)
    || /(?:^|[、,，和与])\s*@?boss\b(?=\s*(?:直聘|招聘|平台|网站|app)?\s*(?:[、,，和与]|$))/i.test(segment);
}

export function extractWebUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s,，。；;！？"'“”‘’()<>[\]{}]+/gi) || [];
  return Array.from(new Set(matches
    .map((url) => url.trim().replace(/[.，;；!！?？。)\\\]]+$/, ''))
    .filter((url) => /^https?:\/\/[^/\s]+\//i.test(url) || /^https?:\/\/[^/\s]+$/i.test(url))))
    .slice(0, 3);
}

export function isDirectWebReadRequest(text: string): boolean {
  return extractWebUrls(text).length > 0 && DIRECT_WEB_READ.test(text);
}

export function isSimpleConversation(text: string): boolean {
  const value = text.trim();
  return GREETING.test(value) || THANKS.test(value) || GOODBYE.test(value) || CAPABILITY.test(value)
    || PLATFORM_CAPABILITY.test(value) || WEATHER.test(value);
}

export function hasResearchSubject(text: string): boolean {
  return inferResearchKeywords(text).length > 0;
}

function requestedKeywordCount(text: string): number | null {
  const match = text.match(/(\d{1,2}|一|二|两|三|四|五|六|七|八|九|十)\s*个?\s*关键词/i);
  if (!match) return null;
  const chineseNumbers: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const count = chineseNumbers[match[1]] || Number(match[1]);
  return Number.isInteger(count) && count > 0 && count <= 12 ? count : null;
}

function splitExplicitKeywords(value: string, sourceText: string): string[] {
  const normalized = value.trim().replace(/^(?:是|为)\s*/, '');
  const separated = normalized.split(/[、,，和与]/).map((item) => item.trim()).filter(Boolean);
  if (separated.length > 1) return separated.slice(0, 12);

  // Spaces are ambiguous because a keyword itself may contain spaces (for example
  // "MiniMax M3"). Only treat them as separators when the user also gives an
  // exact count and the token count agrees with it.
  const requestedCount = requestedKeywordCount(sourceText);
  const spaceSeparated = normalized.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  if (requestedCount && spaceSeparated.length === requestedCount) return spaceSeparated.slice(0, 12);
  return separated.slice(0, 12);
}

function cleanResearchSubject(text: string): string {
  const withoutBossPlatform = text
    .replace(/(?:不要|不采|不抓|不搜|排除|除去|除|移除|删除|去掉)(?:采集|抓取|搜索|查询)?\s*@?(?:BOSS\s*直聘|(?:https?:\/\/)?(?:[\w-]+\.)*zhipin\.com\b|boss\b(?=\s*(?:直聘|招聘|平台|网站|app)?(?:[\s，。；;、]|$)))/gi, ' ')
    .replace(/(?:BOSS\s*直聘|(?:https?:\/\/)?(?:[\w-]+\.)*zhipin\.com\b|(?:^|[\s，。；;、@])boss\b)\s*(?:除外|不用|不要|不采|不抓|不搜)/gi, ' ')
    .replace(/https?:\/\/(?:[\w-]+\.)*zhipin\.com\b[^\s，。；;]*/gi, ' ')
    .replace(/BOSS\s*直聘|(^|[^\w.-])(?:[\w-]+\.)*zhipin\.com\b/gi, '$1')
    .replace(/(^|[、,，和与])\s*@?boss\b(?=\s*(?:[、,，和与]|$))/gi, '$1')
    .replace(/(^|[\s，。；;、@])boss\b(?=\s*(?:直聘|招聘(?:平台|网站)|平台|网站|app|上|里|中|搜索|搜|查询|查|找|采集|抓取))/gi, '$1');

  return withoutBossPlatform
    // "@" 提及菜单插入的是 "@连接器名 " 这种无空格 token，与其余清洗规则无关，先整体去掉
    .replace(/@\S+/g, ' ')
    .replace(/(?:用\s*)?(?:RSS\s*(?:新闻|资讯)?|Atom(?:\s*Feed)?|订阅源)(?:\s*(?:查|搜索|读取))?/gi, ' ')
    .replace(/GitHub(?:仓库|趋势|热门项目)?/gi, ' ')
    .replace(/(?:不要|不采|不抓|不搜|排除|除去|除|移除|删除|去掉)(?:采集|抓取|搜索|查询)?\s*(?:黑猫投诉|黑猫|智联招聘|智联|前程无忧|51job|猎聘网|猎聘|arXiv|论文库|学术论文|学术文献|科研论文|AI\s*HOT|AI热点|AI热榜|小红书|抖音|快手|B站|哔哩哔哩|微博|百度贴吧|贴吧|知乎|百度网页|百度搜索|百度|必应中国|必应|360搜索|360|搜狗搜索|搜狗|头条搜索|DeepSeek|Kimi(?:\s*AI)?|豆包|Doubao|通义千问|千问|Qwen|腾讯元宝|元宝|纳米\s*AI(?:搜索)?|文心一言|文心言|文小言|文心|平台)+/gi, ' ')
    .replace(/(?:黑猫投诉|黑猫|智联招聘|智联|前程无忧|51job|猎聘网|猎聘|arXiv|论文库|学术论文|学术文献|科研论文|AI\s*HOT|AI热点|AI热榜|小红书|抖音|快手|B站|哔哩哔哩|微博|百度贴吧|贴吧|知乎|百度网页|百度搜索|百度|必应中国|必应|360搜索|360|搜狗搜索|搜狗|头条搜索|DeepSeek|Kimi(?:\s*AI)?|豆包|Doubao|通义千问|千问|Qwen|腾讯元宝|元宝|纳米\s*AI(?:搜索)?|文心一言|文心言|文小言|文心)(?:除外|不用|不要|不采|不抓|不搜)?/gi, ' ')
    .replace(/关键词(?:[:：]|\s)+/gi, ' ')
    .replace(/(?:这|这些|上述)?\s*(?:[\d一二两三四五六七八九十]+\s*个?)?\s*AI\s*平台/gi, ' ')
    .replace(/关键词/gi, ' ')
    .replace(/用户补充[:：]?/gi, ' ')
    .replace(/请|麻烦|帮我|我想要|我想|我需要|想要|我要|准备|开始|一下|看看|了解|关于|进行|做个|做一份|一个|一份|这个|那个|任务|项目|需求|加|再|也|还|额外|另外|此外/gi, ' ')
    .replace(/采集|收集|抓取|搜索|搜|查询|检索|查找|查一下|调查|调研|研究|监测|分析/gi, ' ')
    .replace(/(?:的)?(?:舆情|口碑|竞品|评论|评价|帖子|论文|内容|信息|数据|讨论|报告)/gi, ' ')
    .replace(/(^|\s)(?:在|从|上|里|中)(?=\s|$)/g, ' ')
    .replace(/[，。！？、,.!?;；:：()（）[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^的|的$/g, '')
    .replace(/(?:了|啦|吧|呢|呀|啊)+$/g, '')
    .trim();
}

export function isExclusivePlatformRequest(text: string): boolean {
  const explicitExclusive = /(?:只|仅|只要)(?:采集|抓取|搜索|看|用|在|查)?\s*(?:RSS(?:新闻|资讯)?|Atom(?:\s*Feed)?|订阅源|GitHub(?:仓库|趋势|热门项目)?|arXiv|论文库|AI\s*HOT|AI热点|AI热榜|小红书|抖音|快手|B站|哔哩哔哩|微博|百度贴吧|贴吧|知乎|百度网页|百度搜索|百度|必应中国|必应|360搜索|360|搜狗搜索|搜狗|头条搜索|DeepSeek|Kimi(?:\s*AI)?|豆包|Doubao|通义千问|千问|Qwen|腾讯元宝|元宝|纳米\s*AI(?:搜索)?|文心一言|文心言|文小言|文心|黑猫投诉|黑猫|智联招聘|智联|BOSS\s*直聘|(?:[\w-]+\.)*zhipin\.com|平台)/i.test(text);
  return explicitExclusive || (/(?:只|仅|只要)/.test(text) && hasBossPlatformMention(text));
}

export function isAdditivePlatformRequest(text: string): boolean {
  return /(?:多|加|再|包含|额外|同时)(?:采集|抓取|搜索|加|用|在|查|入)?/i.test(text);
}

/**
 * Keywords the user explicitly authored. These are authoritative plan inputs,
 * unlike the broader fallback subject inferred from a natural-language request.
 */
export function inferExplicitResearchKeywords(text: string): string[] {
  const quoted = Array.from(text.matchAll(/[“"']([^”"']{1,30})[”"']/g)).map((match) => match[1].trim());
  if (quoted.length) return Array.from(new Set(quoted)).slice(0, 12);

  const explicit = text.match(/关键词\s*(?:(?:改成|改为|换成|更换为|替换为)\s*|[:：]\s*|\s+)([^，。；;\n]{1,80})/);
  if (explicit?.[1]) {
    return splitExplicitKeywords(explicit[1], text);
  }

  // Recruitment requests commonly separate the actual search phrase from the
  // requested analysis: “岗位是 FDE 工程师，告诉我……平均薪资是多少”. Prefer the
  // explicitly labelled job title so platform names, location and deliverables
  // cannot leak into the crawler keyword.
  const explicitJobTitle = text.match(/(?:岗位|职位)(?:名称)?\s*(?:是|为|[:：])\s*([^，。；;！？?\n]{2,60})/i);
  if (explicitJobTitle?.[1]) {
    const jobTitle = explicitJobTitle[1].trim().replace(/^(?:一个|一份)\s*/, '').replace(/\s*(?:岗位|职位)$/, '').trim();
    if (jobTitle.length >= 2) return [jobTitle.slice(0, 40)];
  }

  return [];
}

export function inferResearchKeywords(text: string): string[] {
  const explicitKeywords = inferExplicitResearchKeywords(text);
  if (explicitKeywords.length) return explicitKeywords;

  const academicQueries = Array.from(text.matchAll(
    /(?:查询|查找|搜索|检索)(?:一下)?(?:关于|有关)?\s*([^，。；;！？?\n]{2,60}?)(?:的)?(?:学术论文|学术文献|科研论文)/gi,
  )).map((match) => match[1].trim()).filter(Boolean);
  if (academicQueries.length) return [academicQueries.at(-1)!].slice(0, 12);

  const cleaned = cleanResearchSubject(text);
  return cleaned.length >= 2 ? [cleaned.slice(0, 40)] : [];
}

export function inferExcludedPlatforms(text: string): string[] {
  const prefixPattern = /(?:不要|不采|不抓|不搜|排除|除去|除|移除|删除|去掉)(?:采集|抓取|搜索|查询)?\s*([^\n，。；;]+)/gi;
  const suffixPattern = /([^\n，。；;]+?)\s*(?:除外|不用|不要|不采|不抓|不搜)/gi;

  const excluded = new Set<string>();
  const aliases: Array<[RegExp, string]> = [
    [/(?:小红书|xiaohongshu\.com|xhslink\.com|rednote\.com)/i, 'xhs'],
    [/(?:抖音|douyin\.com|v\.douyin\.com)/i, 'douyin'],
    [/(?:快手|kuaishou\.com|v\.kuaishou\.com)/i, 'kuaishou'],
    [/(?:B站|哔哩哔哩|bilibili\.com|b23\.tv)/i, 'bili'],
    [/(?:微博|weibo\.com|weibo\.cn)/i, 'weibo'],
    [/(?:百度贴吧|贴吧|tieba\.baidu\.com)/i, 'tieba'],
    [/(?:知乎|zhihu\.com|zhuanlan\.zhihu\.com)/i, 'zhihu'],
    [/(?:百度(?!贴吧)|百度网页|百度搜索|百度首页|www\.baidu\.com)/i, 'baidu'],
    [/(?:必应中国|必应|bing\.com|bing)/i, 'bing'],
    [/(?:360搜索|360|so\.com)/i, 'so360'],
    [/(?:搜狗搜索|搜狗|sogou\.com)/i, 'sogou'],
    [/(?:头条搜索|头条|so\.toutiao\.com)/i, 'toutiao'],
    [/(?:神马搜索|神马|夸克搜索|夸克|quark\.sm\.cn|sm\.cn)/i, 'quark'],
    [/(?:中国搜索|国搜|chinaso\.com|chinaso)/i, 'chinaso'],
    [/(?:arXiv|arxiv\.org|论文库|学术论文|学术文献|科研论文)/i, 'arxiv'],
    [/(?:GitHub(?:仓库|趋势|热门项目)?|github\.com)/i, 'github_repositories'],
    [/(?:RSS(?:新闻|资讯)?|Atom(?:\s*Feed)?|订阅源)/i, 'rss_news'],
    [/(?:AI\s*HOT|AI热点|AI热榜|aihot\.virxact\.com)/i, 'aihot'],
    [/(?:DeepSeek|chat\.deepseek\.com)/i, 'deepseek'],
    [/(?:Kimi(?:\s*AI)?|kimi\.moonshot\.cn|kimi\.com)/i, 'kimi'],
    [/(?:豆包|Doubao|doubao\.com)/i, 'doubao'],
    [/(?:通义千问|千问|Qwen|qianwen\.com|chat\.qwen\.ai)/i, 'qwen'],
    [/(?:腾讯元宝|元宝|yuanbao\.tencent\.com)/i, 'yuanbao'],
    [/(?:纳米\s*AI(?:搜索)?|纳米搜索|www\.n\.cn)/i, 'nami'],
    [/(?:文心一言|文心言|文小言|文心|wenxin\.baidu\.com|yiyan\.baidu\.com)/i, 'wenxin'],
    [/(?:黑猫投诉|黑猫|tousu\.sina\.com\.cn)/i, 'heimao'],
    [BOSS_STRONG_MENTION, 'boss'],
    [/(?:智联招聘|智联|zhaopin\.com)/i, 'zhaopin'],
    [/(?:前程无忧|51job|51job\.com)/i, 'job51'],
    [/(?:猎聘网|猎聘|liepin\.com)/i, 'liepin'],
  ];

  for (const match of text.matchAll(prefixPattern)) {
    const segment = match[1];
    if (hasExcludedBossMention(segment)) excluded.add('boss');
    for (const [pattern, code] of aliases) {
      if (pattern.test(segment)) {
        excluded.add(code);
      }
    }
  }

  for (const match of text.matchAll(suffixPattern)) {
    const segment = match[1];
    if (hasExcludedBossMention(segment)) excluded.add('boss');
    for (const [pattern, code] of aliases) {
      if (pattern.test(segment)) {
        excluded.add(code);
      }
    }
  }

  return Array.from(excluded);
}

export function inferResearchPlatforms(text: string): string[] {
  const excluded = inferExcludedPlatforms(text);
  let matchedPlatforms: string[] = [];

  if (/(?:所有|全部|全|主流)?\s*(?:搜索引擎|搜索平台|网页搜索)/i.test(text)) {
    matchedPlatforms = ['baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso'];
  } else if (/(?:所有|全部|全|主流)?\s*(?:社交平台|社交媒体|内容平台)/i.test(text)) {
    matchedPlatforms = ['xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu'];
  } else if (/(?:所有|全部|全|主流)?\s*(?:招聘平台|招聘网站)/i.test(text)) {
    matchedPlatforms = ['boss', 'zhaopin', 'job51', 'liepin'];
  } else if (/(?:所有|全部|全|主流)\s*AI\s*(?:搜索|问答|类|Web\s*QA)/i.test(text)) {
    matchedPlatforms = ['deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin'];
  } else if (
    /(?:全部|所有|全)(?:支持的)?(?:\s*\d+\s*个)?平台|全网|^(?:全部|所有|全)[。！!？?\s]*$/i.test(text.trim())
    || /(?:采集|收集|抓取|搜索|查询|检索|调查|调研|研究|监测|了解|看看).{0,20}各平台|各平台.{0,20}(?:采集|收集|抓取|搜索|查询|检索|调查|调研|研究|监测|了解|看看)/i.test(text)
  ) {
    matchedPlatforms = [...ALL_PLATFORM_IDS];
  } else {
    const aliases: Array<[RegExp, string]> = [
      [/(?:小红书|xiaohongshu\.com|xhslink\.com|rednote\.com)/i, 'xhs'],
      [/(?:抖音|douyin\.com|v\.douyin\.com)/i, 'douyin'],
      [/(?:快手|kuaishou\.com|v\.kuaishou\.com)/i, 'kuaishou'],
      [/(?:B站|哔哩哔哩|bilibili\.com|b23\.tv)/i, 'bili'],
      [/(?:微博|weibo\.com|weibo\.cn)/i, 'weibo'],
      [/(?:百度贴吧|贴吧|tieba\.baidu\.com)/i, 'tieba'],
      [/(?:知乎|zhihu\.com|zhuanlan\.zhihu\.com)/i, 'zhihu'],
      [/(?:百度(?!贴吧)|百度网页|百度搜索|百度首页|www\.baidu\.com)/i, 'baidu'],
      [/(?:必应中国|必应|bing\.com|bing)/i, 'bing'],
      [/(?:360搜索|360|so\.com)/i, 'so360'],
      [/(?:搜狗搜索|搜狗|sogou\.com)/i, 'sogou'],
      [/(?:头条搜索|头条|so\.toutiao\.com)/i, 'toutiao'],
      [/(?:神马搜索|神马|夸克搜索|夸克|quark\.sm\.cn|sm\.cn)/i, 'quark'],
      [/(?:中国搜索|国搜|chinaso\.com|chinaso)/i, 'chinaso'],
      [/(?:arXiv|arxiv\.org|论文库|学术论文|学术文献|科研论文)/i, 'arxiv'],
      [/(?:GitHub(?:仓库|趋势|热门项目)?|github\.com)/i, 'github_repositories'],
      [/(?:RSS(?:新闻|资讯)?|Atom(?:\s*Feed)?|订阅源)/i, 'rss_news'],
      [/(?:AI\s*HOT|AI热点|AI热榜|aihot\.virxact\.com)/i, 'aihot'],
      [/(?:DeepSeek|chat\.deepseek\.com)/i, 'deepseek'],
      [/(?:Kimi(?:\s*AI)?|kimi\.moonshot\.cn|kimi\.com)/i, 'kimi'],
      [/(?:豆包|Doubao|doubao\.com)/i, 'doubao'],
      [/(?:通义千问|千问|Qwen|qianwen\.com|chat\.qwen\.ai)/i, 'qwen'],
      [/(?:腾讯元宝|元宝|yuanbao\.tencent\.com)/i, 'yuanbao'],
      [/(?:纳米\s*AI(?:搜索)?|纳米搜索|www\.n\.cn)/i, 'nami'],
      [/(?:文心一言|文心言|文小言|文心|wenxin\.baidu\.com|yiyan\.baidu\.com)/i, 'wenxin'],
      [/(?:黑猫投诉|黑猫|tousu\.sina\.com\.cn)/i, 'heimao'],
      [BOSS_STRONG_MENTION, 'boss'],
      [/(?:智联招聘|智联|zhaopin\.com)/i, 'zhaopin'],
      [/(?:前程无忧|51job|51job\.com)/i, 'job51'],
      [/(?:猎聘网|猎聘|liepin\.com)/i, 'liepin'],
    ];
    const matched = aliases.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
    if (hasBossPlatformMention(text)) matched.unshift('boss');
    if (matched.length) {
      matchedPlatforms = Array.from(new Set(matched));
    } else if (/(?:所有|全部|全|主流)?\s*AI\s*(?:搜索|问答|Web\s*QA)/i.test(text)) {
      matchedPlatforms = ['deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin'];
    }
  }

  return matchedPlatforms.filter((p) => !excluded.includes(p));
}

export function hasExplicitCollectionDepth(text: string): boolean {
  return /(?:快速|简单|即时|秒级|随便|大概|前几条|抓几条|只要列表|不要评论|不采评论|不集评论|不加评论|前[一二两三1-3]\s*页|[1-3]\s*页|前[1-3]0\s*条|标准|常规|前[四五4-5]\s*页|5\s*页|50\s*条|深挖|尽量多|全量|全面|完整采集|深度采集|深入采集|详细采集|(?:深度|深入|详细)(?:调研|研究).{0,8}(?:采集|收集|抓取)|范围.{0,4}(?:深度|详细|深入|完整)|前[六七八九十6-9]|10\s*页|100\s*条)/i.test(text)
    || /^(?:范围\s*(?:改成|改为|用|：|:)?\s*)?深度[。！!？?\s]*$/i.test(text.trim());
}

export function inferCollectionDepth(text: string): 'quick' | 'standard' | 'deep' | 'custom' {
  if (/(?:快速|简单|即时|秒级|随便|大概|前几条|抓几条|只要列表|不要评论|不采评论|不集评论|不加评论|前[一二两三1-3]\s*页|[1-3]\s*页|前[1-3]0\s*条)/i.test(text)) {
    return 'quick';
  }
  // “二级评论/回复/楼层” used to force 深度 back when replies were a separate
  // opt-in. Collecting comments now always brings their replies, so those words
  // say nothing about how many items the user wants.
  if (/(?:深度|详细|深入|完整|全量|全面|舆情|深入挖掘|深入分析|详细分析|前[六七八九十6-9]|10\s*页|100\s*条)/i.test(text)) {
    return 'deep';
  }
  if (/(?:标准|常规|前[四五4-5]\s*页|5\s*页|50\s*条)/i.test(text)) {
    return 'standard';
  }
  // 未指定采集量时优先快速返回首批可用结果；用户明确要求常规、完整或深挖时再扩大范围。
  return 'quick';
}

const DIRECT_PARSE_KEYWORDS = /(?:去水印|解析|提取视频|无水印|视频链接|解水印|直链)/i;
const COMMON_SHARE_URLS = /(?:v\.douyin\.com|douyin\.com|xhslink\.com|xiaohongshu\.com|b23\.tv|bilibili\.com|kuaishou\.com|v\.kuaishou\.com|weibo\.cn|weibo\.com|zhihu\.com)/i;
const BATCH_RESEARCH_KEYWORDS = /(?:采集|抓取|搜索|调研|研究|监测|批量|每关键词|条数|页数|评论数|分析|舆情|竞品)/i;

export function isDirectParseRequest(
  text: string,
  previousAssistantText?: string,
  mentionedConnectors: string[] = [],
): boolean {
  const hasUrl = /https?:\/\/[^\s，。；;\n]+/i.test(text);
  const matchesDirectKeyword = DIRECT_PARSE_KEYWORDS.test(text);
  const matchesShareUrl = COMMON_SHARE_URLS.test(text);

  // 净化分享口令模版词（如 "打开Douyin搜索"），防止干扰批量采集判定
  const cleanedText = text.replace(/打开\s*(?:Douyin|抖音|快手|小红书|微信)?\s*搜索/gi, ' ');
  const isBatchRequest = BATCH_RESEARCH_KEYWORDS.test(cleanedText);

  if (isBatchRequest && !matchesDirectKeyword) {
    return false;
  }
  if (matchesDirectKeyword && (hasUrl || matchesShareUrl || /解析/i.test(text))) {
    return true;
  }
  // 用户在 @ 菜单里明确选中了某个真实 connector（而非"综合无水印解析"），
  // 说明这条裸链接应交给该 connector 的完整采集流程（含登录态、评论等），
  // 而不能被"有链接就当作快速解析"的启发式规则悄悄接管。
  const mentionedRealConnector = mentionedConnectors.some((id) => id !== 'media_parser');
  if (hasUrl && matchesShareUrl && !isBatchRequest && !mentionedRealConnector) {
    return true;
  }
  if (previousAssistantText && /(?:解析|去水印|提供.*链接)/i.test(previousAssistantText) && (hasUrl || matchesShareUrl)) {
    return true;
  }
  return false;
}

/**
 * Conservative local intent hints. AI remains the primary router; these rules
 * provide extraction support and safe fallbacks, but must not directly trigger
 * state-changing operations such as execute, stop, revise, or export.
 */
export function localIntentDecision(text: string, context: IntentContext = {}): AgentDecision {
  const value = text.trim();
  const status = context.planStatus || null;

  if (context.mentionedSkills?.length) {
    if (!hasResearchSubject(value)) {
      return { action: 'clarify', reply: '已选择技能或工具。请再告诉我这次要处理的具体关键词、主页或链接。', missingFields: ['subject'] };
    }
    return { action: status === 'awaiting_confirmation' ? 'revise_plan' : 'create_plan', reply: '' };
  }

  if (isDirectParseRequest(value, context.previousAssistantText, context.mentionedConnectors)) {
    return { action: 'direct_parse', reply: '' };
  }

  // Picking a Connector from the @ menu is an explicit request to use the
  // persistent collection workflow, even when the same text could otherwise be
  // answered by the silent live-search path.
  if (context.mentionedConnectors?.length) {
    if (!hasResearchSubject(value)) {
      return { action: 'clarify', reply: '已选择采集平台。请再告诉我这次要搜索的具体主题或关键词。', missingFields: ['subject'] };
    }
    return { action: status === 'awaiting_confirmation' ? 'revise_plan' : 'create_plan', reply: '' };
  }

  if (isDirectWebReadRequest(value)) {
    return { action: 'direct_web_read', reply: '' };
  }

  if (GREETING.test(value)) {
    return { action: 'chat', reply: '你好！当然可以先聊聊。你可以问我能做什么，也可以慢慢告诉我想了解的主题；信息足够后，我再帮你整理采集计划。' };
  }
  if (THANKS.test(value)) return { action: 'chat', reply: '不客气。你可以继续补充想法，或者随时让我帮你整理成采集任务。' };
  if (GOODBYE.test(value)) return { action: 'chat', reply: '再见！之后想继续调研时，回到这个任务就可以接着聊。' };
  if (CAPABILITY.test(value)) {
    return { action: 'chat', reply: '我可以先和你讨论调研思路，也可以按你的明确要求从小红书、抖音、快手、哔哩哔哩、微博、贴吧、知乎、搜索引擎和 AI HOT 采集内容，完成后继续做总结、舆情和竞品分析。普通咨询只会直接回答，不会创建采集任务。' };
  }
  if (PLATFORM_CAPABILITY.test(value)) {
    return { action: 'chat', reply: '目前支持小红书、抖音、快手、B站、微博、贴吧、知乎，百度、必应等网页搜索，DeepSeek 等 AI 问答，以及招聘、投诉和 AI HOT 垂直资讯 Connector。你可以指定一个或多个平台；没有指定时，我会请你选择后再自动开始。' };
  }
  if (RESEARCH_HOW_TO.test(value)) {
    return { action: 'chat', reply: '你只要告诉我想搜索的主题或关键词，以及平台即可；我会生成采集计划并自动开始执行。' };
  }
  if (MODEL_INFO.test(value)) return { action: 'model_info', reply: '' };
  // An ordinary question followed by "联网搜索一下" asks for an
  // immediate cited answer, not a persistent collection job. Explicit
  // platforms and bulk/research wording continue through the planned workflow.
  if (ONE_SHOT_WEB_SEARCH.test(value) && !PERSISTENT_RESEARCH.test(value) && !inferResearchPlatforms(value).length) {
    return { action: 'live_answer', reply: '', query: value };
  }
  if (WEATHER.test(value) && !(RESEARCH.test(value) && inferResearchPlatforms(value).length > 0)) {
    return { action: 'live_answer', reply: '', query: value };
  }
  if (CURRENT_FACT.test(value) && !PERSISTENT_RESEARCH.test(value) && !inferResearchPlatforms(value).length) {
    return { action: 'live_answer', reply: '', query: value };
  }
  if (context.previousUserText && WEATHER.test(context.previousUserText) && LOCATION.test(value) && !(RESEARCH.test(value) && inferResearchPlatforms(value).length > 0)) {
    return { action: 'live_answer', reply: '', query: `${context.previousUserText} ${value}` };
  }
  if (status === 'awaiting_confirmation' && CONFIRM.test(value)) return { action: 'execute', reply: '好的，我现在按已确认的计划开始采集。' };
  if (FORCE_EXECUTE.test(value)) return { action: 'execute', reply: '' };
  if (['queued', 'running'].includes(String(status)) && STOP.test(value)) return { action: 'stop', reply: '好的，我正在停止当前采集任务。' };
  if (STATUS_QUERY.test(value)) return { action: 'status', reply: '' };
  if (EXPORT.test(value)) return { action: 'export', reply: '' };
  // A follow-up can request both a new collection round and an analysis of the
  // combined results (for example, "再去小红书搜索宝可梦，并结合所有信息分析").
  // The new collection must happen first.  Previously the presence of any
  // existing data plus the word "分析" routed the whole message to `analyze`,
  // silently dropping the explicit platform search.
  if (RESEARCH.test(value) && inferResearchPlatforms(value).length > 0 && hasResearchSubject(value)) {
    return { action: 'create_plan', reply: '' };
  }
  const canAnalyzeCollectedData = context.hasCollectedData
    || ['queued', 'running', 'completed', 'partially_completed'].includes(String(status));
  if (canAnalyzeCollectedData && ANALYZE.test(value)) return { action: 'analyze', reply: '' };
  if (['completed', 'partially_completed'].includes(String(status)) && /^(?:都要|全都要|正面|负面|趋势|舆情|都可以|没问题|好的?)$/i.test(value)) return { action: 'analyze', reply: '' };
  if (status === 'awaiting_confirmation' && (REVISE.test(value) || isAnalysisRevisionRequest(value))) return { action: 'revise_plan', reply: '' };

  if (context.awaitingClarification && !/^(?:不知道|还?没想好|不确定|随便)$/.test(value)) {
    const suppliedPlatforms = inferResearchPlatforms(value).length > 0;
    const suppliedSubject = hasResearchSubject(value);
    if (suppliedPlatforms || suppliedSubject) {
      return { action: 'create_plan', reply: '' };
    }
    if (['completed', 'partially_completed'].includes(String(status))) {
      return { action: 'analyze', reply: '' };
    }
  }

  if (RESEARCH.test(value)) {
    const hasSubject = hasResearchSubject(value) || Boolean(context.hasPreviousPlanKeywords) || (Boolean(context.previousUserText) && hasResearchSubject(context.previousUserText || ''));
    if (!hasSubject) {
      return { action: 'clarify', reply: '可以。你最想调研的具体品牌、产品、事件或主题是什么？', missingFields: ['subject'] };
    }
    if (!inferResearchPlatforms(value).length) {
      return {
        action: 'clarify',
        reply: '明白了。你想采集哪些平台？可以直接说“小红书和微博”或“全部平台”。如果没有采集量偏好，我会按快速模式自动开始并尽快返回首批结果；你也可以现在指定标准或深度。',
        missingFields: ['platforms'],
      };
    }
    return { action: 'create_plan', reply: '' };
  }

  return {
    action: 'chat',
    reply: '我在听。你可以先随便说说想了解的问题；如果需要采集数据，我会在目标明确后整理计划并自动开始。',
  };
}
