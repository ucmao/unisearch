import { BOSS_CITY_CODES, resolveBossCityCode } from './bossCities';
import { ZHAOPIN_CITY_CODES, resolveZhaopinCityCode } from './zhaopinCities';
import { JOB51_CITY_CODES, resolveJob51CityCode } from './job51Cities';
import { LIEPIN_CITY_CODES, resolveLiepinCityCode } from './liepinCities';

export type JobPlatformId = 'boss' | 'zhaopin' | 'job51' | 'liepin';

const CITY_CODES: Record<JobPlatformId, Record<string, string>> = {
  boss: BOSS_CITY_CODES,
  zhaopin: ZHAOPIN_CITY_CODES,
  job51: JOB51_CITY_CODES,
  liepin: LIEPIN_CITY_CODES,
};

function normalizedLocation(value: unknown): string {
  return String(value || '').trim().replace(/[省市]$/, '');
}

export function resolveJobLocation(platform: JobPlatformId, value: unknown): string {
  const location = normalizedLocation(value);
  if (!location) return '';
  if (/^全国$/i.test(location)) return CITY_CODES[platform].全国;
  if (platform === 'boss') return resolveBossCityCode(location) || location;
  if (platform === 'zhaopin') return resolveZhaopinCityCode(location) || location;
  if (platform === 'job51') return resolveJob51CityCode(location) || location;
  if (platform === 'liepin') return resolveLiepinCityCode(location) || location;
  return CITY_CODES[platform][location] || location;
}

export function buildJobSearchUrl(
  platform: JobPlatformId,
  keyword: string,
  page: number,
  location?: unknown,
): string {
  const resolved = resolveJobLocation(platform, location);
  if (platform === 'boss') {
    const params = new URLSearchParams({ query: keyword, page: String(page) });
    if (resolved) params.set('city', resolved);
    return `https://www.zhipin.com/web/geek/job?${params.toString()}`;
  }
  if (platform === 'zhaopin') {
    const city = resolved || CITY_CODES.zhaopin.全国;
    return `https://www.zhaopin.com/sou/jl${encodeURIComponent(city)}/kw${encodeURIComponent(keyword.toLowerCase())}/p${page}`;
  }
  if (platform === 'job51') {
    const params = new URLSearchParams({ keyword, searchType: '2', pageCode: String(page) });
    if (resolved) params.set('jobArea', resolved);
    return `https://we.51job.com/pc/search?${params.toString()}`;
  }
  const params = new URLSearchParams({ key: keyword, currentPage: String(Math.max(0, page - 1)) });
  if (resolved) params.set('dq', resolved);
  return `https://www.liepin.com/zhaopin/?${params.toString()}`;
}

export function jobItemLimit(value: unknown): number {
  return Math.max(1, Math.min(500, Math.floor(Number(value) || 20)));
}
