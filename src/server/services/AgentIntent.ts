import type { ResearchPlan } from './AgentRepository';
import { isAnalysisRevisionRequest } from './ResearchAnalysis';

export type AgentAction = 'chat' | 'clarify' | 'model_info' | 'create_plan' | 'revise_plan' | 'execute' | 'stop' | 'status' | 'analyze' | 'export';

export interface AgentDecision {
  action: AgentAction;
  reply: string;
  missingFields?: string[];
  plan?: Partial<ResearchPlan> | null;
}

export interface IntentContext {
  planStatus?: string | null;
  awaitingClarification?: boolean;
  previousUserText?: string;
}

const GREETING = /^(?:hi|hello|hey|ni\s*hao|你好(?:呀|啊)?|您好|嗨|哈喽|在吗|早上好|早安|下午好|晚上好|晚安)[!！,.，。?？~～\s]*$/i;
const THANKS = /^(?:谢谢|感谢|多谢|好的谢谢|谢啦|thanks|thank you)[!！,.，。~～\s]*$/i;
const GOODBYE = /^(?:再见|拜拜|回头见|bye|goodbye)[!！,.，。~～\s]*$/i;
const CAPABILITY = /你(?:可以|能)(?:做|干)什么|怎么用|使用帮助|功能介绍|what can you do|\bhelp\b/i;
const PLATFORM_CAPABILITY = /(?:支持|可以|能).*(?:采集|抓取|搜索)?.*(?:什么|哪些)平台|(?:什么|哪些)平台.*(?:支持|可以|能)|支持的平台/i;
const RESEARCH_HOW_TO = /(?:采集|收集|搜索|调研|任务).*(?:怎么做|怎么用|如何操作|操作流程|步骤)|(?:怎么|如何).*(?:采集|收集|搜索|调研|创建任务)/i;
const MODEL_INFO = /(?:你|当前|现在)?(?:用的|使用的|配置的)?(?:是)?什么模型|模型(?:名称|版本|信息)|which model/i;
const IDENTITY_CONVERSATION = /^(?:(?:你|我)是(?:谁|什么|啥)?|(?:你|我)叫(?:什么|啥)(?:名字)?|(?:你|我)叫什么(?:名字)?|(?:还)?记得(?:你|我)(?:叫|是)(?:谁|什么|啥)(?:名字)?吗?|(?:还)?记得(?:你|我)的名字吗)[!！,.，。?？\s]*$/i;
const WEATHER = /天气|气温|下雨|降雨|温度|weather/i;
const LOCATION = /^(?:我在|我住在|城市是|地点是)?\s*[\u4e00-\u9fa5]{2,12}(?:市)?[!！,.，。\s]*$/;
const CONFIRM = /^(?:确认|确认并执行|开始|开始吧|开始采集|直接采集|立即采集|执行|执行吧|执行这个计划|开跑|跑起来|可以|可以的|好的?|没问题|就这样|就按(?:这个|该计划|上面的计划)(?:来|执行|开始)?吧?|按(?:这个|该计划|上面的计划)(?:来|执行|开始)?吧?)[!！,.，。\s]*$/i;
const FORCE_EXECUTE = /^(?:执行|执行吧|开始采集|直接采集|立即采集|开跑|跑起来)[!！,.，。\s]*$/i;
const STOP = /(?:停止|停下|停一下|暂停|取消)(?:采集|任务|执行)?|(?:stop|cancel)(?:\s+(?:task|run))?/i;
const STATUS_QUERY = /(?:任务|采集|收集|抓取).*(?:多少|几条|情况|状态|进度|怎么样|完成)|(?:多少|几条).*(?:信息|内容|数据|结果)|采集到了吗|(?:执行|开始|开跑|跑起来)(?:了)?吗/i;
const EXPORT = /(?:导出|下载).*(?:CSV|表格|数据|结果)|(?:CSV|表格).*(?:导出|下载)/i;
const ANALYZE = /分析|总结|结论|对比|洞察|报告|原因|评价如何|怎么看|归纳/i;
const REVISE_ACTION = '(?:加上|增加|添加|再加|也要|去掉|删除|移除|不要|改成|改为|换成|换一个|更换|替换|修改|调整|只要)';
const REVISE_FIELD = '(?:小红书|抖音|快手|B站|哔哩哔哩|微博|贴吧|知乎|百度|必应|360|搜狗|平台|关键词|评论|页|后台|分析目标|分析维度|关注重点)';
const REVISE = new RegExp(`(?:${REVISE_ACTION}.*${REVISE_FIELD}|${REVISE_FIELD}.*${REVISE_ACTION})`, 'i');
const RESEARCH = /采集|收集|抓取|搜索|搜(?:一下)?|查(?:找|一下)|调查|调研|研究|监测|做(?:个|一份)?报告|(?:我)?(?:想|要|想要)了解|帮我(?:查|搜|看看)|(?:网上|全网|各平台|社交媒体).*(?:口碑|评价|讨论|反馈|怎么说)|(?:看看|了解)(?:大家|网友|用户).*(?:评价|看法|反馈|怎么说)|(?:去|到|在)?(?:小红书|抖音|快手|B站|哔哩哔哩|微博|百度贴吧|贴吧|知乎|百度|必应|360|搜狗)(?:上|里)?(?:搜|找|查|看看)/i;
const ALL_PLATFORM_IDS = ['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu', 'baidu', 'bing', 'so360', 'sogou'];

export function isSimpleConversation(text: string): boolean {
  const value = text.trim();
  return GREETING.test(value) || THANKS.test(value) || GOODBYE.test(value) || CAPABILITY.test(value)
    || PLATFORM_CAPABILITY.test(value) || IDENTITY_CONVERSATION.test(value) || WEATHER.test(value);
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
  return text
    .replace(/关键词(?:[:：]|\s)+/gi, ' ')
    .replace(/用户补充[:：]?/gi, ' ')
    .replace(/小红书|抖音|快手|B站|哔哩哔哩|微博|百度贴吧|贴吧|知乎|百度|必应|360|搜狗/gi, ' ')
    .replace(/请|麻烦|帮我|我想要|我想|我需要|想要|我要|准备|开始|一下|看看|了解|关于|进行|做个|做一份|一个|一份|这个|那个|任务|项目|需求/gi, ' ')
    .replace(/采集|收集|抓取|搜索|搜|查找|查一下|调查|调研|研究|监测|分析/gi, ' ')
    .replace(/(?:的)?(?:舆情|口碑|竞品|评论|评价|帖子|内容|信息|数据|讨论|报告)/gi, ' ')
    .replace(/(^|\s)(?:在|从|上|里|中)(?=\s|$)/g, ' ')
    .replace(/[，。！？、,.!?;；:：()（）\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^的|的$/g, '')
    .replace(/(?:了|啦|吧|呢|呀|啊)+$/g, '')
    .trim();
}

export function inferResearchKeywords(text: string): string[] {
  const quoted = Array.from(text.matchAll(/[“"']([^”"']{1,30})[”"']/g)).map((match) => match[1].trim());
  if (quoted.length) return Array.from(new Set(quoted)).slice(0, 12);

  const explicit = text.match(/关键词\s*(?:(?:改成|改为|换成|更换为|替换为)\s*|[:：]\s*|\s+)([^，。；;\n]{1,80})/);
  if (explicit?.[1]) {
    return splitExplicitKeywords(explicit[1], text);
  }

  const cleaned = cleanResearchSubject(text);
  return cleaned.length >= 2 ? [cleaned.slice(0, 40)] : [];
}

export function inferResearchPlatforms(text: string): string[] {
  if (/(?:全部|所有|全)(?:支持的)?平台|全网|各平台/.test(text)) return [...ALL_PLATFORM_IDS];
  const aliases: Array<[RegExp, string]> = [
    [/(?:小红书|xiaohongshu\.com|xhslink\.com|rednote\.com)/i, 'xhs'],
    [/(?:抖音|douyin\.com|v\.douyin\.com)/i, 'dy'],
    [/(?:快手|kuaishou\.com|v\.kuaishou\.com)/i, 'ks'],
    [/(?:B站|哔哩哔哩|bilibili\.com|b23\.tv)/i, 'bili'],
    [/(?:微博|weibo\.com|weibo\.cn)/i, 'wb'],
    [/(?:百度贴吧|贴吧|tieba\.baidu\.com)/i, 'tieba'],
    [/(?:知乎|zhihu\.com|zhuanlan\.zhihu\.com)/i, 'zhihu'],
    [/(?:百度网页|百度搜索|百度|baidu\.com)/i, 'baidu'],
    [/(?:必应中国|必应|bing\.com|bing)/i, 'bing'],
    [/(?:360搜索|360|so\.com)/i, 'so360'],
    [/(?:搜狗搜索|搜狗|sogou\.com)/i, 'sogou'],
  ];
  return aliases.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
}

export function inferCollectionDepth(text: string): 'quick' | 'standard' | 'deep' | 'custom' {
  if (/(?:快速|简单|即时|秒级|随便|大概|前几条|抓几条|只要列表|不要评论|不采评论|不集评论|不加评论)/i.test(text)) {
    return 'quick';
  }
  if (/(?:深度|详细|深入|完整|全量|全面|舆情|二级评论|回复|楼层|深入挖掘|深入分析|详细分析)/i.test(text)) {
    return 'deep';
  }
  return 'standard';
}

/**
 * Conservative local intent hints. AI remains the primary router; these rules
 * provide extraction support and safe fallbacks, but must not directly trigger
 * state-changing operations such as execute, stop, revise, or export.
 */
export function localIntentDecision(text: string, context: IntentContext = {}): AgentDecision {
  const value = text.trim();
  const status = context.planStatus || null;

  if (GREETING.test(value)) {
    return { action: 'chat', reply: '你好！当然可以先聊聊。你可以问我能做什么，也可以慢慢告诉我想了解的主题；信息足够后，我再帮你整理采集计划。' };
  }
  if (THANKS.test(value)) return { action: 'chat', reply: '不客气。你可以继续补充想法，或者随时让我帮你整理成采集任务。' };
  if (GOODBYE.test(value)) return { action: 'chat', reply: '再见！之后想继续调研时，回到这个任务就可以接着聊。' };
  if (CAPABILITY.test(value)) {
    return { action: 'chat', reply: '我可以先和你讨论调研思路，再按需要从小红书、抖音、快手、哔哩哔哩、微博、贴吧、知乎，以及百度、必应中国、360搜索、搜狗搜索采集内容；计划会先给你确认，完成后还能继续做总结、舆情和竞品分析。' };
  }
  if (PLATFORM_CAPABILITY.test(value)) {
    return { action: 'chat', reply: '目前支持 11 个平台：小红书、抖音、快手、哔哩哔哩、微博、百度贴吧、知乎，以及百度、必应中国、360搜索和搜狗搜索。你可以指定一个或多个平台；如果没有指定，我会先给出建议并让你确认。' };
  }
  if (RESEARCH_HOW_TO.test(value)) {
    return { action: 'chat', reply: '你只要告诉我想搜索的主题或关键词，以及平台即可；我会生成采集计划，等你确认后再开始执行。' };
  }
  if (MODEL_INFO.test(value)) return { action: 'model_info', reply: '' };
  if (WEATHER.test(value)) {
    return { action: 'chat', reply: '我目前没有接入实时天气数据源，所以不能可靠地查询今天的天气。这个应用现在专注于跨平台公开内容采集与分析。' };
  }
  if (context.previousUserText && WEATHER.test(context.previousUserText) && LOCATION.test(value)) {
    return { action: 'chat', reply: `收到，你说的是${value.replace(/^(?:我在|我住在|城市是|地点是)\s*/, '').replace(/[!！,.，。\s]+$/, '')}。不过当前应用还没有天气接口，因此我不能给出可靠的实时天气；接入天气工具后才能完成这类查询。` };
  }
  if (status === 'awaiting_confirmation' && CONFIRM.test(value)) return { action: 'execute', reply: '好的，我现在按已确认的计划开始采集。' };
  if (FORCE_EXECUTE.test(value)) return { action: 'execute', reply: '' };
  if (['queued', 'running'].includes(String(status)) && STOP.test(value)) return { action: 'stop', reply: '好的，我正在停止当前采集任务。' };
  if (STATUS_QUERY.test(value)) return { action: 'status', reply: '' };
  if (EXPORT.test(value)) return { action: 'export', reply: '' };
  if (['completed', 'partially_completed'].includes(String(status)) && ANALYZE.test(value)) return { action: 'analyze', reply: '' };
  if (status === 'awaiting_confirmation' && (REVISE.test(value) || isAnalysisRevisionRequest(value))) return { action: 'revise_plan', reply: '' };

  if (context.awaitingClarification && !/^(?:不知道|还?没想好|不确定|随便)$/.test(value)) {
    const suppliedPlatforms = inferResearchPlatforms(value).length > 0;
    const suppliedSubject = hasResearchSubject(value);
    if (suppliedPlatforms || suppliedSubject) {
      return { action: 'create_plan', reply: '' };
    }
  }

  if (RESEARCH.test(value)) {
    if (!hasResearchSubject(value)) {
      return { action: 'clarify', reply: '可以。你最想调研的具体品牌、产品、事件或主题是什么？', missingFields: ['subject'] };
    }
    if (!inferResearchPlatforms(value).length) {
      return {
        action: 'clarify',
        reply: '明白了。你想采集哪些平台？可以直接说“小红书和微博”或“全部平台”。如果没有采集量偏好，我会先按标准深度执行，你也可以在确认计划时改成快速或深度。',
        missingFields: ['platforms'],
      };
    }
    return { action: 'create_plan', reply: '' };
  }

  return {
    action: 'chat',
    reply: '我在听。你可以先随便说说想了解的问题；如果需要采集数据，我会在目标明确后先整理计划给你确认，不会直接开始任务。',
  };
}
