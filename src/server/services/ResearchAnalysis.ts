import type { ResearchPlan } from './AgentRepository';

export const DEFAULT_ANALYSIS_GOALS = [
  '主题内容概览',
  '核心观点与分歧',
  '用户情感及原因',
  '高频需求与痛点',
  '关键发现与建议',
];

function uniqueGoals(values: unknown[]): string[] {
  return Array.from(new Set(values
    .map((value) => String(value).trim().replace(/^[·•\-\d.、\s]+/, ''))
    .filter(Boolean)))
    .slice(0, 8);
}

export function inferAnalysisGoals(goal: string): string[] {
  const text = String(goal || '');
  const goals: string[] = [];
  const add = (...items: string[]) => goals.push(...items);

  if (/培训|课程|教育|机构|学校|学院/.test(text)) {
    add('机构与品牌识别', '课程定位与内容', '价格与服务对比', '师资、案例与承诺', '用户评价与需求');
  } else if (/竞品|竞争|对比|横评|选型/.test(text)) {
    add('主要品牌与产品识别', '定位与核心卖点对比', '价格与服务对比', '用户口碑与痛点', '竞争机会与风险');
  } else if (/舆情|口碑|评价|评论|反馈|怎么看/.test(text)) {
    add('讨论主题与传播概览', '正负面观点及原因', '高频问题与用户诉求', '代表性意见与来源', '舆情风险与机会');
  } else if (/趋势|行业|市场|赛道/.test(text)) {
    add('热门主题与参与者', '趋势变化与驱动因素', '用户需求与应用场景', '争议与潜在风险', '市场机会与关键判断');
  } else {
    add(...DEFAULT_ANALYSIS_GOALS);
  }

  if (/价格|收费|费用|多少钱/.test(text) && !goals.some((item) => /价格|收费|费用/.test(item))) goals.splice(2, 0, '价格与收费对比');
  if (/机构|品牌|公司|厂商/.test(text) && !goals.some((item) => /机构|品牌|公司|厂商/.test(item))) goals.unshift('主要机构与品牌识别');
  return uniqueGoals(goals);
}

export function normalizeAnalysisGoals(input: unknown, goal: string): string[] {
  const normalized = Array.isArray(input) ? uniqueGoals(input) : [];
  return normalized.length ? normalized : inferAnalysisGoals(goal);
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

  return changed && uniqueGoals(next).length ? uniqueGoals(next) : null;
}

export function isAnalysisRevisionRequest(text: string): boolean {
  return /(?:(?:增加|添加|加上|再加|也要|去掉|删除|移除|不要|改成|改为|调整|只要|只分析).*(?:分析目标|分析维度|关注重点|情感分析|观点分析|价格对比|机构识别|品牌识别|课程对比)|(?:分析目标|分析维度|关注重点).*(?:增加|添加|去掉|删除|改成|改为|调整|只要))/.test(text);
}
