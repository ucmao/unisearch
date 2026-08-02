import type { ResearchPlan } from './AgentRepository';

const GENERIC_MESSAGE = /^(?:你?好(?:呀|啊|哇|哦|喔|哟|嘛)?|您好|哈[喽啰罗]|嗨|hi|hello|hey|在吗|有人吗|测试(?:一下)?|开始|继续|谢谢|多谢|ok|好的|嗯+|哦+)[!！,.，。?？~～\s\p{Emoji_Presentation}\p{Extended_Pictographic}]*$/iu;

function takeCharacters(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('');
}

export function sanitizeThreadTitle(value: string, limit = 24): string {
  const cleaned = String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, ' ')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, ' ')
    .replace(/(?<!\d)\d{15,18}[\dXx]?(?!\d)/g, ' ')
    .replace(/^[\s#>*_`“”‘’"'《》【】\[\]()（）]+|[\s#>*_`“”‘’"'《》【】\[\]()（）。，、；;：:！？!?~～]+$/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return takeCharacters(cleaned, limit).trim();
}

export function isMeaningfulTitleInput(value: string): boolean {
  const cleaned = sanitizeThreadTitle(value, 80);
  if (!cleaned || GENERIC_MESSAGE.test(cleaned)) return false;
  const semantic = cleaned.replace(/[\s\p{P}\p{S}]/gu, '');
  return semantic.length >= 2;
}

export function fallbackTitleFromText(value: string): string {
  const withoutLeadIn = String(value || '')
    .replace(/^\s*(?:请|麻烦|劳驾)?\s*(?:帮我|帮忙|我想要?|我需要|我要|能不能|可以)?\s*/i, '')
    .replace(/^(?:看看|了解一下|问一下)\s*/i, '');
  return sanitizeThreadTitle(withoutLeadIn) || '新建情报任务';
}

export function titleFromPlan(plan: ResearchPlan): string {
  const keywordsText = (plan.keywords || []).filter(Boolean).join('、');
  let topic = keywordsText;
  if (!topic && plan.goal) {
    topic = plan.goal
      .replace(/^(?:在[\s\S]*?(?:中|上)?\s*(?:搜索|采集|检索|查找)|采集|搜索|检索|查找)\s*(?:关键词[:："“']*)?/i, '')
      .trim();
  }
  return sanitizeThreadTitle(topic || plan.goal || '', 24) || '新建情报任务';
}
