import { activeConfig } from '../../tools/config';
import { connectorEventEmitter } from '../../core/contracts/connector-event-emitter';

export type TargetKind = 'detail' | 'creator';

/**
 * Creator collection uses zero as "no item ceiling". Keyword search keeps its
 * existing positive default, while profile crawlers can walk until the platform
 * reports the end of the feed.
 */
export function creatorItemLimit(): number | null {
  const value = Number(activeConfig.CRAWLER_MAX_NOTES_COUNT);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function creatorLimitReached(count: number, limit = creatorItemLimit()): boolean {
  return limit !== null && count >= limit;
}

/**
 * Over-fetch a few pages so duplicates, recommendations and filtered cards do
 * not make a request for N unique items stop at the theoretical minimum page.
 */
export function searchPageBudget(
  target: number,
  expectedPageSize: number,
  extraPages = 5,
  absoluteCeiling = 100,
): number {
  const safeTarget = Math.max(1, Math.floor(Number(target) || 1));
  const safePageSize = Math.max(1, Math.floor(Number(expectedPageSize) || 1));
  return Math.min(absoluteCeiling, Math.max(1, Math.ceil(safeTarget / safePageSize) + extraPages));
}

/** Make the reason for a clean search exit visible instead of calling every exit a full success. */
export function reportKeywordSearchCompletion(
  platform: string,
  keyword: string,
  collected: number,
  target: number,
  detail = '',
): void {
  if (collected >= target) {
    connectorEventEmitter.send({
      type: 'progress',
      current: collected,
      total: target,
      message: `${platform} 关键词“${keyword}”已达到用户数量上限：${collected}/${target} 条。`,
    });
    return;
  }
  connectorEventEmitter.send({
    type: 'warning',
    code: 'PARTIAL_RESULT',
    message: `${platform} 关键词“${keyword}”采集到 ${collected}/${target} 条${detail ? `；${detail}` : ''}。`,
  });
}

export function configuredTargets(platform: string, kind: TargetKind): string[] {
  const suffix = kind === 'detail' ? 'SPECIFIED_ID_LIST' : 'CREATOR_ID_LIST';
  const value = activeConfig[`${platform.toUpperCase()}_${suffix}`];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

export function firstMatch(value: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return value.trim().replace(/^@/, '');
}

export function asAbsoluteUrl(value: string, base: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  return `${base.replace(/\/$/, '')}/${value.replace(/^\//, '')}`;
}

export function stripHtml(value: unknown): string {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export async function resolveRedirect(page: any, target: string): Promise<string> {
  if (!/^https?:\/\//i.test(target)) return target;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return page.url();
}
