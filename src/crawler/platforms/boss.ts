import type { BrowserContext, Page, Response } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyLoginRequired,
  notifyManualVerificationRequired,
} from '../base/BaseCrawler';
import { connectorOutput } from '../../connectors/output/connector-output';
import { activeConfig } from '../../tools/config';
import {
  buildBossDetailUrl,
  classifyBossPageState,
  parseBossDetailHtml,
  parseBossDomJobs,
  parseBossSearchPayload,
  type BossJobRecord,
} from './bossParsing';
import { reportKeywordSearchCompletion, searchPageBudget } from '../base/connectorHelpers';
import { buildJobSearchUrl, jobItemLimit } from './jobSearch';
import { MANUAL_VERIFICATION_TIMEOUT_MS } from '../base/interactiveTimeouts';

const SEARCH_RESPONSE_PATTERN = /\/wapi\/zpgeek\/search\/joblist(?:\.json)?(?:[?#]|$)/i;

function extractUrlsOrKeywords(input: string): string[] {
  if (!input) return [];
  return input
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

export class BossCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  protected override async humanDelay(page: Page, seconds = activeConfig.CRAWLER_MAX_SLEEP_SEC): Promise<void> {
    if (!page || page.isClosed()) return;
    try {
      await super.humanDelay(page, seconds);
    } catch (err: any) {
      if (err?.message?.includes('closed') || err?.message?.includes('Target')) return;
      throw err;
    }
  }

  public async start(): Promise<void> {
    console.log('[BOSS] Connecting BOSS crawler to Electron built-in browser engine...');
    const playwright = require('playwright');
    this.browserContext = await connectToElectronChromium(playwright);
    this.page = await getElectronCrawlerPage(this.browserContext, 'boss');

    const crawlerType = activeConfig.CRAWLER_TYPE || 'search';
    if (crawlerType === 'detail') {
      await this.collectDetails();
    } else {
      await this.search();
    }
  }

  private async checkAndHandleVerification(context: string): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    const url = this.page.url();
    const title = await this.page.title().catch(() => '');
    const bodyText = await this.page.locator('body').innerText({ timeout: 1500 }).catch(() => '');

    const assessment = classifyBossPageState({
      url,
      title,
      bodyText: bodyText.slice(0, 10_000),
    });

    if (assessment.state === 'ready') return false;

    if (assessment.state === 'login_required') {
      console.warn(`[BOSS] Login required for ${context}. Requesting user login in browser window...`);
      notifyLoginRequired('boss', `BOSS直聘“${context}”需要在内置浏览器中完成登录。`);
    } else if (assessment.state === 'verification_required') {
      console.warn(`[BOSS] Security verification slider/captcha detected for ${context}. Requesting manual verification...`);
      notifyManualVerificationRequired('boss', `BOSS直聘“${context}”需要在内置浏览器中完成人机验证。`);
    } else if (assessment.state === 'rate_limited') {
      console.warn(`[BOSS] Rate limit detected for ${context}: ${assessment.reason}`);
      notifyManualVerificationRequired('boss', `BOSS直聘访问频次受限 (${assessment.reason})，请在内置浏览器窗口中暂缓或解封。`);
    }

    const maxWaitMs = MANUAL_VERIFICATION_TIMEOUT_MS;
    const startTime = Date.now();
    console.log(`[BOSS] Waiting for manual resolution in browser window (up to ${maxWaitMs / 1000}s)...`);

    while (Date.now() - startTime < maxWaitMs) {
      if (!this.page || this.page.isClosed()) return false;
      await this.humanDelay(this.page, 3);
      if (!this.page || this.page.isClosed()) return false;

      const currentUrl = this.page.url();
      const currentTitle = await this.page.title().catch(() => '');
      const currentBody = await this.page.locator('body').innerText({ timeout: 1500 }).catch(() => '');

      const currentAssessment = classifyBossPageState({
        url: currentUrl,
        title: currentTitle,
        bodyText: currentBody.slice(0, 10_000),
      });

      if (currentAssessment.state === 'ready') {
        console.log(`[BOSS] Manual verification / login completed successfully for ${context}!`);
        await this.humanDelay(this.page, 2);
        return true;
      }
    }

    console.warn(`[BOSS] Manual verification timeout reached for ${context}. Proceeding with best-effort parsing.`);
    return false;
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

    const keywords = extractUrlsOrKeywords(activeConfig.KEYWORDS || '');
    if (keywords.length === 0) {
      console.warn('[BOSS] No search keywords specified.');
      return;
    }

    const maxItems = jobItemLimit(activeConfig.CRAWLER_MAX_NOTES_COUNT);
    const startPage = Math.max(1, Math.floor(Number(activeConfig.START_PAGE) || 1));
    const location = String(activeConfig.JOB_LOCATION || '').trim();
    console.log(`[BOSS] Starting search for ${keywords.length} keyword(s), location "${location || '平台默认'}", limit ${maxItems} per keyword...`);

    for (const keyword of keywords) {
      if (!this.page || this.page.isClosed()) break;
      console.log(`[BOSS] Searching for keyword: "${keyword}"...`);
      const collected = new Map<string, BossJobRecord>();
      const pendingResponses = new Set<Promise<void>>();

      const onResponse = (response: Response) => {
        if (!SEARCH_RESPONSE_PATTERN.test(response.url())) return;
        const task = (async () => {
          try {
            const payload = await response.json();
            const parsed = parseBossSearchPayload(payload, keyword);
            for (const job of parsed.jobs) {
              collected.set(job.content_id, job);
            }
          } catch (error: any) {
            console.warn(`[BOSS] Failed to parse search XHR response: ${error.message}`);
          }
        })();
        pendingResponses.add(task);
        void task.finally(() => pendingResponses.delete(task));
      };

      this.page.on('response', onResponse);

      try {
        let pageNum = startPage;
        let scannedPages = 0;
        let stalledPages = 0;
        const maxPages = searchPageBudget(maxItems, 30, 5, 100);
        while (collected.size < maxItems && scannedPages < maxPages) {
          if (!this.page || this.page.isClosed()) break;
          const beforePage = collected.size;
          const searchUrl = buildJobSearchUrl('boss', keyword, pageNum, location);
          console.log(`[BOSS] Navigating to search page ${pageNum}: ${searchUrl}`);

          await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
          if (!this.page || this.page.isClosed()) break;

          await this.humanDelay(this.page, 3);
          await Promise.allSettled(Array.from(pendingResponses));
          if (!this.page || this.page.isClosed()) break;

          await this.checkAndHandleVerification(`搜索关键词 "${keyword}"`);
          await Promise.allSettled(Array.from(pendingResponses));
          if (!this.page || this.page.isClosed()) break;

          await this.page.evaluate(() => window.scrollBy(0, 600)).catch(() => {});
          await this.humanDelay(this.page, 1.5);
          await Promise.allSettled(Array.from(pendingResponses));

          const domJobs = await this.collectDomJobs(keyword);
          for (const job of domJobs) {
            collected.set(job.content_id, job);
          }

          if (domJobs.length === 0 && collected.size === beforePage) {
            stalledPages++;
          } else if (collected.size === beforePage) {
            stalledPages++;
          } else {
            stalledPages = 0;
          }

          if (collected.size === 0) {
            console.log(`[BOSS] No jobs found on page ${pageNum} for "${keyword}". Stopping pagination.`);
            break;
          }
          if (stalledPages >= 2) {
            console.log(`[BOSS] Two consecutive pages produced no new jobs for "${keyword}". Stopping pagination.`);
            break;
          }

          if (collected.size >= maxItems) break;
          pageNum++;
          scannedPages++;
        }
      } finally {
        if (this.page && !this.page.isClosed()) {
          this.page.off('response', onResponse);
        }
        await Promise.allSettled(Array.from(pendingResponses));
      }

      const jobs = uniqueJobs(collected.values()).slice(0, maxItems);
      for (let index = 0; index < jobs.length; index++) {
        await this.emitJob(jobs[index], keyword, index + 1);
      }
      console.log(`[BOSS] Search successfully emitted ${jobs.length} job(s) for "${keyword}".`);
      reportKeywordSearchCompletion('BOSS直聘', keyword, jobs.length, maxItems, '平台结果已结束、重复或访问受限');
    }

    console.log('[BOSS] Job search execution completed.');
  }

  private async collectDomJobs(keyword: string): Promise<BossJobRecord[]> {
    if (!this.page || this.page.isClosed()) return [];
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

  private async collectDetails(): Promise<void> {
    if (!this.page || this.page.isClosed()) throw new Error('[BOSS] Browser page is not initialized or closed.');

    const rawTargets = activeConfig.SPECIFIED_IDS || activeConfig.KEYWORDS || '';
    const targets = extractUrlsOrKeywords(rawTargets);
    if (!targets.length) {
      console.warn('[BOSS] No detail URLs or IDs provided.');
      return;
    }

    console.log(`[BOSS] Starting detail parsing for ${targets.length} target(s)...`);

    for (const target of targets) {
      if (!this.page || this.page.isClosed()) break;
      const detailUrl = buildBossDetailUrl(target);
      if (!detailUrl) {
        console.warn(`[BOSS] Invalid job detail URL/ID: "${target}"`);
        continue;
      }

      console.log(`[BOSS] Navigating to detail page: ${detailUrl}`);
      await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
      if (!this.page || this.page.isClosed()) break;

      await this.humanDelay(this.page, 2);
      if (!this.page || this.page.isClosed()) break;

      await this.checkAndHandleVerification(`职位详情 (${target})`);
      if (!this.page || this.page.isClosed()) break;

      const html = await this.page.content().catch(() => '');
      const parsed = parseBossDetailHtml(html, this.page.url());

      if (parsed.job) {
        await this.emitJob(parsed.job, target);
        console.log(`[BOSS] Successfully stored job detail: "${parsed.job.title}" @ ${parsed.job.company_name}`);
      } else {
        console.warn(`[BOSS] Could not parse job detail for ${detailUrl}: ${parsed.reason}`);
      }
    }

    console.log('[BOSS] Detail parsing completed.');
  }
}
