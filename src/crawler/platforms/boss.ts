import type { BrowserContext, Page, Response } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyLoginRequired,
  notifyLoginSuccess,
  notifyManualVerificationRequired,
  notifyManualVerificationSuccess,
} from '../base/BaseCrawler';
import { configuredTargets } from '../base/connectorHelpers';
import { connectorOutput } from '../../connectors/output/connector-output';
import { activeConfig } from '../../tools/config';
import {
  buildBossDetailUrl,
  classifyBossPageState,
  parseBossDetailHtml,
  parseBossDomJobs,
  parseBossSearchPayload,
  type BossJobRecord,
  type BossPageAssessment,
} from './bossParsing';

const SEARCH_RESPONSE_PATTERN = /\/wapi\/zpgeek\/search\/joblist(?:\.json)?(?:[?#]|$)/i;

function splitKeywords(value: string): string[] {
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueJobs(jobs: Iterable<BossJobRecord>): BossJobRecord[] {
  const seen = new Set<string>();
  const result: BossJobRecord[] = [];
  for (const job of jobs) {
    if (!job.content_id || seen.has(job.content_id)) continue;
    seen.add(job.content_id);
    result.push(job);
  }
  return result;
}

/**
 * Authorized BOSS integration only. The crawler drives normal visible page
 * navigation and consumes responses produced by that page. It never forges
 * request signatures, solves challenges, or copies browser credentials.
 */
export class BossCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    this.assertAuthorizedRun();

    console.log('[BOSS] Connecting authorized crawler to the Electron browser...');
    const playwright = require('playwright');
    this.browserContext = await connectToElectronChromium(playwright);
    this.page = await getElectronCrawlerPage(this.browserContext, 'boss');

    if (activeConfig.COOKIES) {
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.zhipin.com');
    }

    if ((activeConfig.CRAWLER_TYPE || 'search') === 'detail') {
      await this.collectDetails();
    } else {
      await this.search();
    }
  }

  private assertAuthorizedRun(): void {
    if (!String(activeConfig.BOSS_AUTHORIZATION_REFERENCE || '').trim()) {
      throw new Error('BOSS Connector 已停止：请先填写 BOSS 官方书面授权、合作协议或测试批准的引用编号');
    }
  }

  private async currentPageAssessment(): Promise<BossPageAssessment> {
    if (!this.page) throw new Error('[BOSS] Browser page is not initialized.');
    const [title, bodyText] = await Promise.all([
      this.page.title().catch(() => ''),
      this.page.locator('body').innerText({ timeout: 1500 }).catch(() => ''),
    ]);
    return classifyBossPageState({
      url: this.page.url(),
      title,
      bodyText: bodyText.slice(0, 20_000),
    });
  }

  private async waitForAccess(
    context: string,
    initial?: BossPageAssessment,
  ): Promise<void> {
    if (!this.page) throw new Error('[BOSS] Browser page is not initialized.');
    const assessment = initial && initial.state !== 'ready'
      ? initial
      : await this.currentPageAssessment();

    if (assessment.state === 'ready' || assessment.state === 'page_changed') return;
    if (assessment.state === 'rate_limited') {
      throw new Error(`BOSS 访问频率受限：${assessment.reason}。任务已停止，不会通过重试硬顶风控。`);
    }

    const isLogin = assessment.state === 'login_required';
    const timeoutMs = isLogin ? 120_000 : 180_000;
    if (isLogin) {
      notifyLoginRequired('boss', `BOSS直聘“${context}”需要在内置浏览器中由用户完成登录。`);
    } else {
      notifyManualVerificationRequired('boss', `BOSS直聘“${context}”需要由用户在内置浏览器中完成安全验证。`);
    }

    const startedAt = Date.now();
    let stableReadyPasses = 0;
    while (Date.now() - startedAt < timeoutMs) {
      await this.page.waitForTimeout(1_000);
      const next = await this.currentPageAssessment();
      if (next.state === 'rate_limited') {
        throw new Error(`BOSS 访问频率受限：${next.reason}。任务已停止。`);
      }
      if (next.state === 'ready' || next.state === 'page_changed') {
        stableReadyPasses++;
        if (stableReadyPasses >= 2) {
          if (isLogin) notifyLoginSuccess('boss');
          else notifyManualVerificationSuccess('boss');
          return;
        }
      } else {
        stableReadyPasses = 0;
      }
    }

    throw new Error(isLogin
      ? '等待 BOSS 登录超时；请完成登录后重新运行任务'
      : '等待 BOSS 人工安全验证超时；请完成验证后重新运行任务');
  }

  private async readSearchResponse(response: Response, keyword: string): Promise<{
    assessment?: BossPageAssessment;
    jobs: BossJobRecord[];
  }> {
    if (!SEARCH_RESPONSE_PATTERN.test(response.url())) return { jobs: [] };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      const assessment = classifyBossPageState({
        url: response.url(),
        status: response.status(),
        expectedData: false,
      });
      return { assessment, jobs: [] };
    }

    const parsed = parseBossSearchPayload(payload, keyword);
    return { assessment: parsed.assessment, jobs: parsed.jobs };
  }

  private async collectDomJobs(keyword: string): Promise<BossJobRecord[]> {
    if (!this.page) return [];
    const snapshots = await this.page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/job_detail/"]'));
      const seen = new Set<string>();
      return anchors.flatMap((anchor) => {
        const href = anchor.href || anchor.getAttribute('href') || '';
        const id = href.match(/\/job_detail\/([^/?#.]+)(?:\.html)?/i)?.[1]?.replace(/\.html$/i, '') || '';
        if (!id || seen.has(id)) return [];
        seen.add(id);
        const card = anchor.closest('li, [class*="job-card"], [class*="job-list"]') || anchor.parentElement;
        if (!card) return [];
        const text = (selectors: string[]) => {
          for (const selector of selectors) {
            const value = card.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
            if (value) return value;
          }
          return '';
        };
        const values = (selectors: string[]) => {
          for (const selector of selectors) {
            const result = Array.from(card.querySelectorAll(selector))
              .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() || '')
              .filter(Boolean);
            if (result.length) return result;
          }
          return [];
        };
        return [{
          content_id: id,
          jobUrl: href,
          jobName: text(['.job-name', '[class*="job-name"]', '[class*="job-title"]', 'h3']),
          companyName: text(['.company-name', '[class*="company-name"]', '[class*="brand-name"]']),
          salaryDesc: text(['.salary', '[class*="salary"]']),
          location: text(['.job-area', '[class*="job-area"]', '[class*="location"]']),
          jobLabels: values(['.tag-list li', '[class*="job-label"] li', '[class*="job-tag"] span']),
          welfareList: values(['.welfare-list li', '[class*="welfare"] span']),
        }];
      });
    }).catch(() => [] as any[]);

    return parseBossDomJobs(snapshots, {
      url: this.page.url(),
      sourceKeyword: keyword,
    }).jobs;
  }

  private async emitJob(job: BossJobRecord, sourceKeyword: string, rank?: number): Promise<void> {
    await connectorOutput.emitBossResult({
      ...job,
      creator_name: job.company_name,
      desc: job.description,
      job_url: job.content_url,
      source_keyword: sourceKeyword,
      ...(rank ? { rank } : {}),
    });
  }

  public async search(): Promise<void> {
    if (!this.page) throw new Error('[BOSS] Browser page is not initialized.');
    const keywords = splitKeywords(activeConfig.KEYWORDS || '');
    if (!keywords.length) throw new Error('BOSS 岗位搜索至少需要一个关键词');
    const maxItems = Math.max(1, Math.min(200, Number(activeConfig.CRAWLER_MAX_NOTES_COUNT || 20)));

    for (const keyword of keywords) {
      const collected = new Map<string, BossJobRecord>();
      let responseAssessment: BossPageAssessment | undefined;
      let pageStructureChanged = false;
      const pendingResponses = new Set<Promise<void>>();
      const onResponse = (response: Response) => {
        const task = (async () => {
          const parsed = await this.readSearchResponse(response, keyword);
          const assessment = parsed.assessment;
          if (assessment && assessment.state !== 'ready') {
            responseAssessment = assessment;
            if (assessment.state === 'page_changed') pageStructureChanged = true;
          }
          for (const job of parsed.jobs) collected.set(job.content_id, job);
        })().catch((error: any) => {
          console.warn(`[BOSS] Ignored an unreadable page response: ${error.message}`);
        });
        pendingResponses.add(task);
        void task.finally(() => pendingResponses.delete(task));
      };

      this.page.on('response', onResponse);
      try {
        const searchUrl = `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(keyword)}`;
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await this.page.waitForTimeout(2_000);
        await this.waitForAccess(keyword, responseAssessment);

        let stagnantRounds = 0;
        for (let round = 0; round < 20 && collected.size < maxItems && stagnantRounds < 3; round++) {
          const before = collected.size;
          for (const job of await this.collectDomJobs(keyword)) collected.set(job.content_id, job);
          if (collected.size >= maxItems) break;
          await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await this.page.waitForTimeout(1_500);
          stagnantRounds = collected.size > before ? 0 : stagnantRounds + 1;
          if (responseAssessment && responseAssessment.state !== 'ready') {
            await this.waitForAccess(keyword, responseAssessment);
            responseAssessment = undefined;
          }
        }
      } finally {
        this.page.off('response', onResponse);
        await Promise.allSettled(Array.from(pendingResponses));
      }

      const jobs = uniqueJobs(collected.values()).slice(0, maxItems);
      if (!jobs.length && pageStructureChanged) {
        throw new Error('BOSS 搜索响应成功但未识别到岗位结构，页面或字段可能已经变化');
      }
      for (let index = 0; index < jobs.length; index++) {
        await this.emitJob(jobs[index], keyword, index + 1);
      }
      console.log(`[BOSS] Authorized search emitted ${jobs.length} job(s) for “${keyword}”.`);
    }
  }

  private async collectDetails(): Promise<void> {
    if (!this.page) throw new Error('[BOSS] Browser page is not initialized.');
    const targets = configuredTargets('boss', 'detail');
    if (!targets.length) throw new Error('BOSS 职位详情能力至少需要一个职位链接或 ID');

    for (const target of targets) {
      const detailUrl = buildBossDetailUrl(target);
      if (!detailUrl) throw new Error(`无法识别 BOSS 职位链接或 ID：${target}`);
      await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await this.page.waitForTimeout(1_500);
      await this.waitForAccess('职位详情');

      let parsed = parseBossDetailHtml(await this.page.content(), this.page.url());
      if (parsed.state === 'login_required' || parsed.state === 'verification_required') {
        await this.waitForAccess('职位详情', parsed.assessment);
        parsed = parseBossDetailHtml(await this.page.content(), this.page.url());
      }
      if (parsed.state === 'rate_limited') {
        throw new Error(`BOSS 访问频率受限：${parsed.reason}`);
      }
      if (!parsed.job) {
        throw new Error(`BOSS 职位详情页面结构无法识别：${parsed.reason}`);
      }
      await this.emitJob(parsed.job, target);
    }
  }
}
