import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  classifyBossPageState,
  buildBossDetailUrl,
  extractBossJobId,
  isExpectedBossRoute,
  normalizeBossJob,
  parseBossDetailHtml,
  parseBossDomJobs,
  parseBossSearchPayload,
} from '../src/crawler/platforms/bossParsing';

const fixture = (name: string) => readFileSync(path.resolve(import.meta.dirname, 'fixtures', name), 'utf8');

test('authorized CDP probe stays passive and cannot navigate or poll pages', () => {
  const source = readFileSync(path.resolve(import.meta.dirname, '..', 'scratch', 'probe_boss_cdp.ts'), 'utf8');

  assert.doesNotMatch(source, /\.goto\s*\(/);
  assert.doesNotMatch(source, /\.reload\s*\(/);
  assert.doesNotMatch(source, /\.click\s*\(/);
  assert.doesNotMatch(source, /\.newPage\s*\(/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /BOSS_PROBE_OPEN_FIRST_DETAIL/);
});

test('crawler runtime uses clean identity defaults with a narrow webdriver allowlist', () => {
  const source = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'crawler', 'base', 'BaseCrawler.ts'), 'utf8');
  const mainSource = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', 'index.ts'), 'utf8');

  assert.match(mainSource, /view\.webContents\.session\.setUserAgent\(CRAWLER_USER_AGENT/);
  assert.match(source, /getElectronCrawlerPage/);
  assert.match(source, /platform === 'boss' \|\| platform === 'quark'/);
  assert.match(source, /Object\.defineProperty\(window, 'close'/);
  assert.match(source, /platform === 'boss' \|\| platform === 'kuaishou'/);
  assert.doesNotMatch(source, /stealth\.min|installStealth|configuredCrawlerContexts/);
  assert.doesNotMatch(mainSource, /AutomationControlled/);
});

test('zpData.jobList fixture is normalized without retaining duplicate labels or private data', () => {
  const source = fixture('boss-search-response.json');
  const result = parseBossSearchPayload(JSON.parse(source), '后端研发');

  assert.equal(result.state, 'ready');
  assert.equal(result.jobs.length, 2);
  assert.deepEqual(result.jobs[0], {
    content_id: 'REDACTED_JOB_001',
    title: '高级 Python 工程师（脱敏样例）',
    summary: '20-35K·14薪 · 上海 · 浦东新区 · 示例园区 · 3-5年 · 本科 · 示例科技（脱敏）',
    description: '负责离线数据服务开发。\n本记录仅用于解析器测试。',
    company_id: 'REDACTED_BRAND_001',
    company_name: '示例科技（脱敏）',
    salary: '20-35K·14薪',
    work_city: '上海 · 浦东新区 · 示例园区',
    job_experience: '3-5年',
    education: '本科',
    content_url: 'https://www.zhipin.com/job_detail/REDACTED_JOB_001.html?securityId=REDACTED_SECURITY_001',
    published_at: 1760000000,
    rank: 1,
    source_keyword: '后端研发',
    skills: ['Python', 'SQL'],
    welfare: ['五险一金', '弹性工作'],
    company_industry: '企业服务',
    company_stage: '未披露',
    company_scale: '100-499人',
  });
  assert.equal(result.jobs[1].job_experience, '1-3年');
  assert.equal(result.jobs[1].education, '硕士');
  assert.deepEqual(result.jobs[1].skills, ['SQL', '可视化']);
  assert.deepEqual(result.jobs[1].welfare, ['带薪年假', '餐补']);
  assert.doesNotMatch(source, /1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
});

test('page.evaluate DOM snapshots use the same normalizer and deterministic identity', () => {
  const result = parseBossDomJobs([
    {
      href: '/job_detail/DOM_REDACTED_001.html',
      jobName: '前端工程师（DOM 脱敏样例）',
      companyName: '示例前端团队（脱敏）',
      salary: '16-28K',
      location: '北京 · 海淀区',
      labels: ['3-5年', '本科', 'React'],
      desc: '<p>维护示例 Web 应用。</p>',
    },
    // Duplicate cards must not produce duplicate CanonicalDocument identities.
    {
      href: '/job_detail/DOM_REDACTED_001.html',
      jobName: '前端工程师（DOM 脱敏样例）',
    },
  ], { sourceKeyword: '前端' });

  assert.equal(result.state, 'ready');
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].content_id, 'DOM_REDACTED_001');
  assert.equal(result.jobs[0].job_experience, '3-5年');
  assert.equal(result.jobs[0].education, '本科');
  assert.equal(result.jobs[0].description, '维护示例 Web 应用。');
  assert.equal(result.jobs[0].content_url, 'https://www.zhipin.com/job_detail/DOM_REDACTED_001.html');
});

test('detail HTML fixture is parsed through data fields without executing scripts', () => {
  const source = fixture('boss-detail.html');
  const result = parseBossDetailHtml(source, 'https://www.zhipin.com/job_detail/REDACTED_DETAIL_001.html');

  assert.equal(result.state, 'ready');
  assert.ok(result.job);
  assert.equal(result.job.content_id, 'REDACTED_DETAIL_001');
  assert.equal(result.job.title, '后端研发工程师（脱敏样例）');
  assert.equal(result.job.company_name, '示例网络公司（脱敏）');
  assert.equal(result.job.salary, '18-30K·13薪');
  assert.equal(result.job.work_city, '深圳 · 南山区');
  assert.match(result.job.description, /不含真实职位/);
  assert.deepEqual(result.job.skills, ['TypeScript', 'Node.js']);
  assert.deepEqual(result.job.welfare, ['五险一金']);
});

test('normalizer rejects cards without a stable id or title', () => {
  assert.equal(normalizeBossJob({ jobName: '缺少 ID' }), null);
  assert.equal(normalizeBossJob({ encryptJobId: 'ONLY_ID' }), null);
});

test('access-state classifier keeps login, verification, rate limiting and schema drift distinct', () => {
  assert.deepEqual(
    classifyBossPageState({ status: 401 }),
    { state: 'login_required', errorCode: 'AUTH_REQUIRED', retryable: false, reason: 'BOSS 直聘当前会话需要登录或重新授权' },
  );
  assert.equal(classifyBossPageState({ url: 'https://www.zhipin.com/web/user/login' }).state, 'login_required');
  assert.equal(classifyBossPageState({ url: 'https://www.zhipin.com/web/common/security-check' }).state, 'verification_required');
  assert.equal(classifyBossPageState({ bodyText: '请拖动滑块完成安全验证' }).state, 'verification_required');
  assert.equal(classifyBossPageState({ status: 429 }).state, 'rate_limited');
  assert.equal(classifyBossPageState({ payload: { message: '访问过于频繁，请稍后再试' } }).state, 'rate_limited');
  assert.equal(classifyBossPageState({ expectedData: false }).state, 'page_changed');
  assert.equal(classifyBossPageState({ expectedData: true }).state, 'ready');
  assert.equal(classifyBossPageState({ expectedData: false, explicitEmpty: true }).state, 'ready');
});

test('expected route guard rejects homepage and off-site redirects', () => {
  assert.equal(isExpectedBossRoute('https://www.zhipin.com/web/geek/job?query=Java', 'search'), true);
  assert.equal(isExpectedBossRoute('https://www.zhipin.com/job_detail/REDACTED.html', 'detail'), true);
  assert.equal(isExpectedBossRoute('https://www.zhipin.com/', 'search'), false);
  assert.equal(isExpectedBossRoute('https://www.zhipin.com/fuzhou/', 'search'), false);
  assert.equal(isExpectedBossRoute('https://example.com/web/geek/job', 'search'), false);
  assert.equal(isExpectedBossRoute('about:blank#unisearch-crawler-boss', 'search'), false);
});

test('known empty search is not confused with structure drift', () => {
  const empty = parseBossSearchPayload({ code: 0, zpData: { jobList: [], totalCount: 0 } });
  assert.equal(empty.state, 'ready');
  assert.deepEqual(empty.jobs, []);
  assert.match(empty.reason, /没有岗位结果/);

  const changed = parseBossSearchPayload({ code: 0, zpData: { renamedJobs: [] } });
  assert.equal(changed.state, 'page_changed');

  const malformed = parseBossSearchPayload({ code: 0, zpData: { jobList: [{ renamedTitle: '字段已变化' }] } });
  assert.equal(malformed.state, 'page_changed');
});

test('blocked detail HTML returns an explicit state instead of a fake job', () => {
  const login = parseBossDetailHtml('<html><title>登录</title><body>请先登录后查看职位</body></html>', 'https://www.zhipin.com/web/user/login');
  assert.equal(login.state, 'login_required');
  assert.equal(login.job, null);

  const verification = parseBossDetailHtml('<html><title>安全验证</title><body>请完成验证码</body></html>');
  assert.equal(verification.state, 'verification_required');
  assert.equal(verification.job, null);
});

test('detail target helpers accept copied links and bare encrypted ids without network access', () => {
  assert.equal(extractBossJobId('REDACTED_JOB_900'), 'REDACTED_JOB_900');
  assert.equal(
    extractBossJobId('查看职位 https://www.zhipin.com/job_detail/REDACTED_JOB_901.html?securityId=MASKED'),
    'REDACTED_JOB_901',
  );
  assert.equal(
    buildBossDetailUrl('REDACTED_JOB_900'),
    'https://www.zhipin.com/job_detail/REDACTED_JOB_900.html',
  );
  assert.equal(
    buildBossDetailUrl('职位链接：https://www.zhipin.com/job_detail/REDACTED_JOB_901.html?securityId=MASKED'),
    'https://www.zhipin.com/job_detail/REDACTED_JOB_901.html?securityId=MASKED',
  );
  assert.equal(buildBossDetailUrl('不是有效目标'), '');
});
