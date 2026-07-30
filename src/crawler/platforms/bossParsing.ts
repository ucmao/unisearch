import * as cheerio from 'cheerio';

export type BossPageState =
  | 'ready'
  | 'login_required'
  | 'verification_required'
  | 'rate_limited'
  | 'page_changed';

export type BossPageErrorCode =
  | 'AUTH_REQUIRED'
  | 'MANUAL_VERIFICATION_REQUIRED'
  | 'RATE_LIMITED'
  | 'PAGE_STRUCTURE_CHANGED';

export interface BossPageSignals {
  url?: unknown;
  title?: unknown;
  bodyText?: unknown;
  /** Backward-compatible alias for callers that already collected a text field. */
  text?: unknown;
  html?: unknown;
  status?: unknown;
  /** Backward-compatible alias for status. */
  httpStatus?: unknown;
  payload?: unknown;
  expectedData?: boolean;
  explicitEmpty?: boolean;
}

export interface BossPageAssessment {
  state: BossPageState;
  errorCode?: BossPageErrorCode;
  retryable: boolean;
  reason: string;
}

export interface NormalizeBossJobOptions {
  baseUrl?: string;
  rank?: number;
  sourceKeyword?: string;
}

export interface BossJobRecord {
  content_id: string;
  title: string;
  summary: string;
  description: string;
  company_id?: string;
  company_name: string;
  salary: string;
  work_city: string;
  job_experience: string;
  education: string;
  content_url: string;
  published_at?: string | number;
  rank?: number;
  source_keyword?: string;
  skills: string[];
  welfare: string[];
  company_industry?: string;
  company_stage?: string;
  company_scale?: string;
}

export type BossNormalizedJob = BossJobRecord;

export interface BossSearchParseResult {
  state: BossPageState;
  assessment: BossPageAssessment;
  reason: string;
  retryable: boolean;
  errorCode?: BossPageErrorCode;
  jobs: BossJobRecord[];
}

export interface BossDetailParseResult {
  state: BossPageState;
  assessment: BossPageAssessment;
  reason: string;
  retryable: boolean;
  errorCode?: BossPageErrorCode;
  job: BossJobRecord | null;
}

export type BossExpectedRoute = 'search' | 'detail';

const DEFAULT_BASE_URL = 'https://www.zhipin.com';

export function isExpectedBossRoute(value: unknown, route: BossExpectedRoute): boolean {
  try {
    const url = new URL(stringValue(value));
    const isBossHost = url.hostname === 'zhipin.com' || url.hostname.endsWith('.zhipin.com');
    if (!isBossHost) return false;
    return route === 'search'
      ? /^\/web\/geek\/job(?:\/|$)/i.test(url.pathname)
      : /^\/job_detail\//i.test(url.pathname);
  } catch {
    return false;
  }
}

const RATE_LIMIT_PATTERN = /(?:HTTP\s*429|too\s+many\s+requests|rate[\s_-]*limit|访问.{0,8}频繁|请求.{0,8}频繁|操作.{0,8}频繁|稍后(?:再试|重试))/i;
const VERIFICATION_PATTERN = /(?:安全验证|人机验证|图形验证|滑块|验证码|完成.{0,6}验证|captcha|security[\s_-]*check|verification\s+required)/i;
const AUTH_PATTERN = /(?:请先登录|登录后(?:查看|继续|访问)|未登录|登录(?:状态|会话).{0,8}(?:失效|过期)|重新登录|login\s+required|not\s+logged\s+in|unauthenticated|unauthorized)/i;

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    for (const key of ['name', 'label', 'value', 'text', 'title']) {
      const nested = stringValue(candidate[key]);
      if (nested) return nested;
    }
  }
  return '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanText(value: unknown): string {
  return decodeEntities(stringValue(value).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDescription(value: unknown): string {
  return decodeEntities(stringValue(value).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstValue(record: Record<string, any>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length > 0) return value;
    if (typeof value === 'object' && Object.keys(value).length > 0) return value;
    if (stringValue(value)) return value;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，、|]/)
      : value === undefined || value === null
        ? []
        : [value];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of source) {
    const normalized = cleanText(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function compactObject(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }));
}

function absoluteUrl(value: unknown, baseUrl = DEFAULT_BASE_URL): string {
  const raw = stringValue(value);
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return '';
  }
}

function jobIdFromUrl(value: string): string {
  const match = value.match(/\/job_detail\/([^/?#.]+)(?:\.html)?/i);
  return match?.[1]?.replace(/\.html$/i, '') || '';
}

function locationValue(record: Record<string, any>): string {
  const direct = cleanText(firstValue(record, ['work_city', 'workCity', 'location', 'jobArea', 'jobAddress']));
  if (direct) return direct;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const key of ['cityName', 'city', 'areaDistrict', 'districtName', 'businessDistrict']) {
    const value = cleanText(record[key]);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    parts.push(value);
  }
  return parts.join(' · ');
}

function labelMatch(labels: string[], pattern: RegExp): string {
  return labels.find((label) => pattern.test(label)) || '';
}

function normalizedTimestamp(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = cleanText(value);
  if (!text) return undefined;
  if (/^\d{10,13}$/.test(text)) return Number(text);
  return text;
}

function payloadSignalText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return cleanText(payload);
  const record = payload as Record<string, any>;
  const values = [
    record.code,
    record.status,
    record.message,
    record.msg,
    record.error,
    record.errorMessage,
    record.error_msg,
    record.zpData?.message,
    record.data?.message,
  ].map(cleanText).filter(Boolean);
  return values.join(' ');
}

/**
 * Classify only explicit page/API evidence. This function does not attempt to
 * solve a challenge and deliberately avoids treating every 403 or empty list as
 * an expired login.
 */
export function classifyBossPageState(signals: BossPageSignals): BossPageAssessment {
  const status = Number(signals.status ?? signals.httpStatus);
  const url = cleanText(signals.url);
  const combined = [
    url,
    cleanText(signals.title),
    cleanText(signals.bodyText ?? signals.text),
    cleanText(signals.html).slice(0, 20_000),
    payloadSignalText(signals.payload),
  ].filter(Boolean).join(' ');

  if (status === 429 || RATE_LIMIT_PATTERN.test(combined)) {
    return { state: 'rate_limited', errorCode: 'RATE_LIMITED', retryable: true, reason: 'BOSS 直聘明确返回限流或访问频繁提示' };
  }
  if (/\/(?:web\/common\/)?security-check(?:[/?#]|$)/i.test(url) || VERIFICATION_PATTERN.test(combined)) {
    return {
      state: 'verification_required', errorCode: 'MANUAL_VERIFICATION_REQUIRED', retryable: false,
      reason: 'BOSS 直聘页面要求人工完成安全验证',
    };
  }
  if (status === 401 || /\/(?:web\/user\/)?(?:login|signin)(?:[/?#]|$)/i.test(url) || AUTH_PATTERN.test(combined)) {
    return { state: 'login_required', errorCode: 'AUTH_REQUIRED', retryable: false, reason: 'BOSS 直聘当前会话需要登录或重新授权' };
  }
  if (signals.expectedData === true) {
    return { state: 'ready', retryable: false, reason: '已识别预期的 BOSS 直聘岗位数据' };
  }
  if (signals.explicitEmpty === true) {
    return { state: 'ready', retryable: false, reason: '页面结构有效，但当前条件没有岗位结果' };
  }
  if (signals.expectedData === false) {
    return {
      state: 'page_changed', errorCode: 'PAGE_STRUCTURE_CHANGED', retryable: false,
      reason: '响应成功但未识别到预期岗位结构，可能是页面或接口字段已变化',
    };
  }
  return { state: 'ready', retryable: false, reason: '未检测到登录、验证或限流阻断' };
}

/** Normalize API records and page.evaluate DOM snapshots to the shared job payload. */
export function normalizeBossJob(raw: unknown, options: NormalizeBossJobOptions = {}): BossJobRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, any>;
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const rawUrl = firstValue(record, ['content_url', 'job_url', 'jobUrl', 'url', 'href', 'detailUrl']);
  let contentUrl = absoluteUrl(rawUrl, baseUrl);
  const declaredId = cleanText(firstValue(record, [
    'content_id', 'encryptJobId', 'encrypt_job_id', 'jobId', 'job_id', 'securityId', 'security_id', 'id',
  ]));
  const contentId = declaredId || jobIdFromUrl(contentUrl);
  const title = cleanText(firstValue(record, ['title', 'jobName', 'job_name', 'name', 'positionName']));
  if (!contentId || !title) return null;

  if (!contentUrl) contentUrl = `${baseUrl.replace(/\/$/, '')}/job_detail/${encodeURIComponent(contentId)}.html`;

  const labels = stringList(firstValue(record, ['jobLabels', 'job_labels', 'labels', 'tags']));
  const salary = cleanText(firstValue(record, ['salary', 'salaryDesc', 'salary_desc', 'salaryText']));
  const workCity = locationValue(record);
  const experience = cleanText(firstValue(record, ['job_experience', 'jobExperience', 'experience', 'experienceName']))
    || labelMatch(labels, /(?:经验|应届|在校|实习|不限|\d+\s*[-至~]\s*\d+\s*年)/);
  const education = cleanText(firstValue(record, ['education', 'jobDegree', 'degreeName', 'degree', 'educationName']))
    || labelMatch(labels, /(?:学历不限|初中|高中|中专|大专|本科|硕士|博士)/);
  const companyName = cleanText(firstValue(record, ['company_name', 'companyName', 'brandName', 'brandComName', 'company']));
  const companyId = cleanText(firstValue(record, ['company_id', 'companyId', 'encryptBrandId', 'brandId']));
  const description = cleanDescription(firstValue(record, ['description', 'desc', 'jobDesc', 'jobDescription', 'postDescription']));
  const skills = stringList(firstValue(record, ['skills', 'jobSkills', 'skillsList', 'skillList']));
  const welfare = stringList(firstValue(record, ['welfare', 'welfareList', 'welfareLabels', 'benefits']));
  const rank = Number.isInteger(options.rank) && Number(options.rank) > 0
    ? Number(options.rank)
    : Number.isInteger(record.rank) && Number(record.rank) > 0
      ? Number(record.rank)
      : undefined;
  const facts = [salary, workCity, experience, education, companyName].filter(Boolean);

  return {
    content_id: contentId,
    title,
    summary: cleanText(firstValue(record, ['summary', 'snippet'])) || facts.join(' · '),
    description,
    ...(companyId ? { company_id: companyId } : {}),
    company_name: companyName,
    salary,
    work_city: workCity,
    job_experience: experience,
    education,
    content_url: contentUrl,
    ...(normalizedTimestamp(firstValue(record, ['published_at', 'publishTime', 'publish_time', 'updateTime', 'lastModifyTime'])) !== undefined
      ? { published_at: normalizedTimestamp(firstValue(record, ['published_at', 'publishTime', 'publish_time', 'updateTime', 'lastModifyTime'])) }
      : {}),
    ...(rank ? { rank } : {}),
    ...(options.sourceKeyword ? { source_keyword: options.sourceKeyword } : {}),
    skills,
    welfare,
    ...(cleanText(firstValue(record, ['companyIndustry', 'industryName', 'industry']))
      ? { company_industry: cleanText(firstValue(record, ['companyIndustry', 'industryName', 'industry'])) }
      : {}),
    ...(cleanText(firstValue(record, ['companyStage', 'stageName', 'financingStage']))
      ? { company_stage: cleanText(firstValue(record, ['companyStage', 'stageName', 'financingStage'])) }
      : {}),
    ...(cleanText(firstValue(record, ['companyScale', 'scaleName', 'brandScaleName']))
      ? { company_scale: cleanText(firstValue(record, ['companyScale', 'scaleName', 'brandScaleName'])) }
      : {}),
  };
}

interface JobListExtraction {
  found: boolean;
  list: unknown[];
}

function valueAtPath(value: unknown, path: string[]): { found: boolean; value?: unknown } {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in (current as Record<string, unknown>))) return { found: false };
    current = (current as Record<string, unknown>)[key];
  }
  return { found: true, value: current };
}

function extractJobList(payload: unknown): JobListExtraction {
  for (const path of [
    ['zpData', 'jobList'],
    ['data', 'zpData', 'jobList'],
    ['data', 'jobList'],
    ['jobList'],
  ]) {
    const result = valueAtPath(payload, path);
    if (!result.found) continue;
    if (Array.isArray(result.value)) return { found: true, list: result.value };
    if (result.value && typeof result.value === 'object') {
      const record = result.value as Record<string, unknown>;
      if (Array.isArray(record.list)) return { found: true, list: record.list };
    }
    return { found: true, list: [] };
  }
  return { found: false, list: [] };
}

function dedupeJobs(jobs: BossJobRecord[]): BossJobRecord[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    if (seen.has(job.content_id)) return false;
    seen.add(job.content_id);
    return true;
  });
}

export function parseBossSearchResponse(
  payload: unknown,
  options: Pick<NormalizeBossJobOptions, 'baseUrl' | 'sourceKeyword'> & Omit<BossPageSignals, 'payload' | 'expectedData' | 'explicitEmpty'> = {},
): BossSearchParseResult {
  const extraction = extractJobList(payload);
  const jobs = dedupeJobs(extraction.list.flatMap((entry, index) => {
    const normalized = normalizeBossJob(entry, { ...options, rank: index + 1 });
    return normalized ? [normalized] : [];
  }));
  const validEmpty = extraction.found && extraction.list.length === 0;
  const assessment = classifyBossPageState({
    ...options,
    payload,
    expectedData: jobs.length > 0,
    explicitEmpty: validEmpty,
  });
  return {
    state: assessment.state,
    assessment,
    reason: assessment.reason,
    retryable: assessment.retryable,
    ...(assessment.errorCode ? { errorCode: assessment.errorCode } : {}),
    jobs,
  };
}

/** Stable integration entry point used by BossCrawler. */
export function parseBossSearchPayload(payload: unknown, sourceKeyword = ''): BossSearchParseResult {
  return parseBossSearchResponse(payload, { sourceKeyword });
}

export function parseBossDomJobs(
  items: unknown[],
  options: Pick<NormalizeBossJobOptions, 'baseUrl' | 'sourceKeyword'> & Omit<BossPageSignals, 'expectedData' | 'explicitEmpty'> = {},
): BossSearchParseResult {
  const jobs = dedupeJobs(items.flatMap((entry, index) => {
    const normalized = normalizeBossJob(entry, { ...options, rank: index + 1 });
    return normalized ? [normalized] : [];
  }));
  const assessment = classifyBossPageState({
    ...options,
    expectedData: jobs.length > 0,
    explicitEmpty: items.length === 0,
  });
  return {
    state: assessment.state,
    assessment,
    reason: assessment.reason,
    retryable: assessment.retryable,
    ...(assessment.errorCode ? { errorCode: assessment.errorCode } : {}),
    jobs,
  };
}

function findJobDetailCandidate(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findJobDetailCandidate(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const hasTitle = Boolean(cleanText(firstValue(record, ['jobName', 'job_name', 'title', 'positionName'])));
  const hasJobEvidence = Boolean(cleanText(firstValue(record, [
    'encryptJobId', 'jobId', 'job_id', 'jobDesc', 'jobDescription', 'salaryDesc', 'salary',
  ])));
  if (hasTitle && hasJobEvidence) return record;

  for (const key of ['jobDetail', 'jobInfo', 'zpData', 'data', 'props', 'pageProps', 'result']) {
    if (!(key in record)) continue;
    const found = findJobDetailCandidate(record[key], depth + 1);
    if (found) return found;
  }
  for (const entry of Object.values(record)) {
    const found = findJobDetailCandidate(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseEmbeddedJson(html: string): Record<string, unknown> | null {
  const $ = cheerio.load(html);
  let candidate: Record<string, unknown> | null = null;
  $('script[type="application/json"], script#__NEXT_DATA__').each((_index, element) => {
    if (candidate) return;
    const source = $(element).text().trim();
    if (!source) return;
    try {
      candidate = findJobDetailCandidate(JSON.parse(source));
    } catch {
      // Malformed or unrelated scripts are ignored; DOM parsing remains available.
    }
  });
  return candidate;
}

function textFromFirst($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const value = cleanDescription($(selector).first().text());
    if (value) return value;
  }
  return '';
}

function textsFrom($: cheerio.CheerioAPI, selectors: string[]): string[] {
  for (const selector of selectors) {
    const values = $(selector).toArray().map((element) => cleanText($(element).text())).filter(Boolean);
    if (values.length) return values;
  }
  return [];
}

export function parseBossDetailHtml(html: string, targetUrl = ''): BossDetailParseResult {
  const $ = cheerio.load(html || '');
  const title = cleanText($('title').first().text());
  const bodyText = cleanText($('body').text()).slice(0, 20_000);
  const preliminary = classifyBossPageState({ url: targetUrl, title, text: bodyText, html });
  if (['login_required', 'verification_required', 'rate_limited'].includes(preliminary.state)) {
    return {
      state: preliminary.state,
      assessment: preliminary,
      reason: preliminary.reason,
      retryable: preliminary.retryable,
      ...(preliminary.errorCode ? { errorCode: preliminary.errorCode } : {}),
      job: null,
    };
  }

  const root = $('[data-boss-job-detail]').first();
  const canonicalUrl = absoluteUrl($('link[rel="canonical"]').attr('href') || targetUrl);
  const domRecord = compactObject({
    jobId: root.attr('data-job-id') || $('[data-job-id]').first().attr('data-job-id') || jobIdFromUrl(canonicalUrl),
    jobName: textFromFirst($, ['[data-field="job-name"]', '.job-name', '.name h1', 'h1']),
    companyName: textFromFirst($, ['[data-field="company-name"]', '.company-name', '.sider-company .company-info a']),
    salaryDesc: textFromFirst($, ['[data-field="salary"]', '.job-salary', '.salary']),
    location: textFromFirst($, ['[data-field="location"]', '.job-location', '.location-address']),
    jobExperience: textFromFirst($, ['[data-field="experience"]', '.job-experience']),
    jobDegree: textFromFirst($, ['[data-field="education"]', '.job-degree', '.job-education']),
    jobDesc: textFromFirst($, ['[data-field="job-description"]', '.job-description', '.job-sec-text']),
    jobUrl: canonicalUrl,
    jobLabels: textsFrom($, ['[data-field="job-label"]', '.job-labels span', '.tag-list span']),
    skills: textsFrom($, ['[data-field="skill"]', '.job-skills span', '.skills-list span']),
    welfareList: textsFrom($, ['[data-field="welfare"]', '.job-welfare span', '.welfare-list span']),
    companyIndustry: textFromFirst($, ['[data-field="company-industry"]']),
    companyStage: textFromFirst($, ['[data-field="company-stage"]']),
    companyScale: textFromFirst($, ['[data-field="company-scale"]']),
  });
  const embedded = parseEmbeddedJson(html) || {};
  const job = normalizeBossJob({ ...embedded, ...domRecord }, { baseUrl: DEFAULT_BASE_URL });
  const assessment = classifyBossPageState({
    url: targetUrl,
    title,
    text: bodyText,
    expectedData: Boolean(job),
  });
  return {
    state: assessment.state,
    assessment,
    reason: assessment.reason,
    retryable: assessment.retryable,
    ...(assessment.errorCode ? { errorCode: assessment.errorCode } : {}),
    job,
  };
}

/** Extract a stable encrypted job id from a raw id, detail URL, or copied text. */
export function extractBossJobId(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) return '';
  const detailId = jobIdFromUrl(raw);
  if (detailId) return detailId;
  const urlMatch = raw.match(/https?:\/\/[^\s，。；;]+/i);
  if (urlMatch) {
    try {
      const parsed = new URL(urlMatch[0]);
      for (const key of ['encryptJobId', 'jobId', 'securityId']) {
        const candidate = cleanText(parsed.searchParams.get(key));
        if (candidate) return candidate;
      }
    } catch {}
  }
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : '';
}

/** Preserve complete BOSS detail links; turn a bare encrypted id into a detail URL. */
export function buildBossDetailUrl(target: unknown): string {
  const raw = stringValue(target);
  const urlMatch = raw.match(/https?:\/\/[^\s，。；;]+/i);
  if (urlMatch) return absoluteUrl(urlMatch[0]);
  const id = extractBossJobId(raw);
  return id ? `${DEFAULT_BASE_URL}/job_detail/${encodeURIComponent(id)}.html` : '';
}
