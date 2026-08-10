import type { ResearchPlan } from './AgentRepository';

function uniqueGoals(values: unknown[]): string[] {
  return Array.from(new Set(values
    .map((value) => String(value).trim().replace(/^[·•\-\d.、\s]+/, ''))
    .filter(Boolean)))
    .slice(0, 8);
}

/**
 * Analysis goals are user intent, not an industry classification. Keep only
 * goals supplied by the planner/user; an empty list means "infer from the
 * collected evidence at report time" and must not be filled from keywords.
 */
export function normalizeAnalysisGoals(input: unknown, _goal?: string): string[] {
  return Array.isArray(input) ? uniqueGoals(input) : [];
}

/**
 * Preserve concrete questions that the user attached to a collection request.
 * The planner normally writes these to `analysis`, but a deterministic fallback
 * is important because otherwise an omitted field turns the final answer into a
 * generic evidence-led report.
 */
export function inferExplicitAnalysisGoals(text: string): string[] {
  const value = String(text || '').trim();
  if (!value) return [];

  const preamblePattern = /(?:告诉|回答|解答|说明|分析|想知道|需要了解)(?:我|一下)?\s*[:：]?/gi;
  const preambles = Array.from(value.matchAll(preamblePattern));
  const lastPreamble = preambles.at(-1);
  const answerSection = lastPreamble
    ? value.slice((lastPreamble.index || 0) + lastPreamble[0].length)
    : value;
  const listItemPattern = /(?:^|\n)\s*(?:\d{1,2}\s*[.、)）]|[-*•])\s*([^\n]+)/g;
  const listed = Array.from(answerSection.matchAll(listItemPattern))
    .map((match) => match[1].trim())
    .filter(Boolean);
  if (listed.length) {
    const questionLike = listed.filter((item) => /[？?]|什么|为何|为什么|怎么|如何|哪些|哪(?:个|些|里|种)|是否|能否|作用|原因|目的/.test(item));
    if (lastPreamble || questionLike.length === listed.length) {
      return uniqueGoals(listed.map((item) => item.replace(/[；;，,]+$/, '')));
    }
  }

  // Also support compact input such as “请回答：1. 是什么？2. 有什么作用？”.
  if (lastPreamble) {
    const compact = Array.from(answerSection.matchAll(/(?:^|\s)(?:\d{1,2}\s*[.、)）])\s*([\s\S]*?)(?=(?:\s+\d{1,2}\s*[.、)）])|$)/g))
      .map((match) => match[1].trim())
      .filter((item) => item && /[？?]|什么|为何|为什么|怎么|如何|哪些|是否|能否|作用|原因|目的/.test(item));
    if (compact.length) return uniqueGoals(compact);

    // A single natural-language deliverable is just as explicit as a numbered
    // list, e.g. “搜索郑成功，然后告诉我他的历史成功的标志是什么”。
    // Previously this fell through to an empty analysis array, so the task card
    // hid the request even though the broader workflow goal still contained it.
    const single = answerSection
      .replace(/^[，,：:\s]+/, '')
      .replace(/[。；;\s]+$/, '')
      .trim();
    const preamblePrefix = value.slice(0, lastPreamble.index || 0);
    const isExplicitDirective = /告诉|回答|解答|想知道|需要了解/.test(lastPreamble[0])
      || /一下/.test(lastPreamble[0])
      || /(?:^|[，,。；;\n]|然后|并|再|请|帮我)\s*$/.test(preamblePrefix);
    if (
      /^(?:一?下|一遍)(?:给我|看看)?$/.test(single)
      && /结合.*(?:信息|数据|结果|内容)/.test(preamblePrefix)
    ) {
      return ['结合所有采集结果综合分析'];
    }
    if (single && isExplicitDirective) return uniqueGoals([single]);
  }

  return [];
}

function splitGoals(value: string): string[] {
  return uniqueGoals(value
    .replace(/[。；;]/g, '、')
    .split(/[、,，]|(?:以及|还有|和)/)
    .map((item) => item.replace(/^(?:分析|关注|侧重|重点看)\s*/, '').trim()));
}

function matchesRemoval(goal: string, removal: string): boolean {
  const compactGoal = goal.replace(/分析|目标|维度|用户/g, '');
  const compactRemoval = removal.replace(/分析|目标|维度|用户/g, '');
  return Boolean(compactRemoval) && (goal.includes(compactRemoval) || compactRemoval.includes(compactGoal));
}

export function inferAnalysisRevision(text: string, base: ResearchPlan): string[] | null {
  const value = text.trim();
  if (!/(?:分析目标|分析维度|关注重点|情感分析|观点分析|价格对比|机构识别|品牌识别|课程对比)/.test(value)) return null;

  const replacement = value.match(/(?:分析目标|分析维度|关注重点)\s*(?:改成|改为|调整为|设为|只要|只分析)\s*[:：]?\s*(.+)$/);
  if (replacement?.[1]) return normalizeAnalysisGoals(splitGoals(replacement[1]), base.goal);

  let next = [...base.analysis];
  let changed = false;
  const removal = value.match(/(?:去掉|删除|移除|不要|不分析)\s*(?:分析目标|分析维度)?\s*[:：]?\s*([^，。；;]+)/);
  if (removal?.[1]) {
    const removals = splitGoals(removal[1]);
    next = next.filter((goal) => !removals.some((item) => matchesRemoval(goal, item)));
    changed = true;
  }

  const addition = value.match(/(?:增加|添加|加上|再加|也要)\s*(?:分析目标|分析维度)?\s*[:：]?\s*([^。；;]+)/);
  if (addition?.[1]) {
    const additionText = addition[1].split(/，\s*(?:去掉|删除|移除|不要|不分析)/)[0];
    next.push(...splitGoals(additionText));
    changed = true;
  }

  return changed ? uniqueGoals(next) : null;
}

export function isAnalysisRevisionRequest(text: string): boolean {
  return /(?:(?:增加|添加|加上|再加|也要|去掉|删除|移除|不要|改成|改为|调整|只要|只分析).*(?:分析目标|分析维度|关注重点|情感分析|观点分析|价格对比|机构识别|品牌识别|课程对比)|(?:分析目标|分析维度|关注重点).*(?:增加|添加|去掉|删除|改成|改为|调整|只要))/.test(text);
}
