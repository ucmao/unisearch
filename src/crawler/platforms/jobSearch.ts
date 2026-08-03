export type JobPlatformId = 'boss' | 'zhaopin' | 'job51' | 'liepin';

const CITY_CODES: Record<JobPlatformId, Record<string, string>> = {
  boss: {
    全国: '100010000', 北京: '101010100', 上海: '101020100', 广州: '101280100', 深圳: '101280600',
    杭州: '101210100', 南京: '101190100', 苏州: '101190400', 成都: '101270100', 武汉: '101200100',
    西安: '101110100', 重庆: '101040100', 天津: '101030100', 长沙: '101250100', 郑州: '101180100',
    青岛: '101120200', 济南: '101120100', 合肥: '101220100', 厦门: '101230200', 福州: '101230100',
  },
  zhaopin: {
    全国: '489', 北京: '530', 上海: '538', 广州: '763', 深圳: '765', 杭州: '653', 南京: '635',
    苏州: '639', 成都: '801', 武汉: '736', 西安: '854', 重庆: '551', 天津: '531', 长沙: '749',
    郑州: '719', 青岛: '703', 济南: '702', 合肥: '664', 厦门: '682', 福州: '681',
  },
  job51: {
    全国: '000000', 北京: '010000', 上海: '020000', 广州: '030200', 深圳: '040000', 杭州: '080200',
    南京: '070200', 苏州: '070300', 成都: '090200', 武汉: '180200', 西安: '200200', 重庆: '060000',
    天津: '050000', 长沙: '190200', 郑州: '170200', 青岛: '120300', 济南: '120200', 合肥: '150200',
    厦门: '110300', 福州: '110200',
  },
  liepin: {
    全国: '410', 北京: '010', 上海: '020', 广州: '050020', 深圳: '050090', 杭州: '070020',
    南京: '060020', 苏州: '060080', 成都: '280020', 武汉: '170020', 西安: '270020', 重庆: '040',
    天津: '030', 长沙: '180020', 郑州: '150020', 青岛: '250070', 济南: '250020', 合肥: '080020',
    厦门: '090040', 福州: '090020',
  },
};

function normalizedLocation(value: unknown): string {
  return String(value || '').trim().replace(/[省市]$/, '');
}

export function resolveJobLocation(platform: JobPlatformId, value: unknown): string {
  const location = normalizedLocation(value);
  if (!location) return '';
  if (/^全国$/i.test(location)) return CITY_CODES[platform].全国;
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
