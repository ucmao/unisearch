import { activeConfig } from '../../tools/config';

export type TargetKind = 'detail' | 'creator';

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
