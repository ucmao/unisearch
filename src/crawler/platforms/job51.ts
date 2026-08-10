import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyLoginRequired,
  notifyLoginSuccess,
  notifyManualVerificationRequired,
  notifyManualVerificationSuccess,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { systemHttpClient } from '../base/SystemHttpClient';
import { reportKeywordSearchCompletion, searchPageBudget } from '../base/connectorHelpers';
import { MANUAL_LOGIN_TIMEOUT_MS } from '../base/interactiveTimeouts';
import { buildJobSearchUrl, jobItemLimit } from './jobSearch';

export type Job51PageState =
  | 'ready'
  | 'empty_result'
  | 'login_required'
  | 'verification_required'
  | 'rate_limited'
  | 'unknown';

export interface Job51PageStateAssessment {
  state: Job51PageState;
  reason?: string;
}

export function classifyJob51PageState(input: {
  url: string;
  title: string;
  bodyText: string;
  hasModal?: boolean;
  hasJobData?: boolean;
}): Job51PageStateAssessment {
  const { url, title, bodyText, hasModal, hasJobData } = input;
  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();

  // 1. Verification / Captcha detection
  if (
    lowerTitle.includes('验证') ||
    lowerTitle.includes('verification') ||
    lowerUrl.includes('security') ||
    lowerUrl.includes('captcha') ||
    bodyText.includes('向右滑动') ||
    bodyText.includes('安全验证') ||
    bodyText.includes('完成验证') ||
    bodyText.includes('人机验证') ||
    bodyText.includes('nc_1_wrapper') ||
    bodyText.includes('sec-captcha')
  ) {
    return { state: 'verification_required', reason: '触发滑块或安全验证' };
  }

  // 2. Login required / Modal blocked detection
  if (
    lowerUrl.includes('login.51job.com') ||
    lowerUrl.includes('/passport') ||
    hasModal ||
    bodyText.includes('微信扫码登录') ||
    bodyText.includes('手机快捷登录') ||
    bodyText.includes('账号密码登录') ||
    bodyText.includes('验证码登录') ||
    bodyText.includes('登录查看更多职位') ||
    bodyText.includes('登录后可查看') ||
    bodyText.includes('请先登录')
  ) {
    return { state: 'login_required', reason: '页面需要登录或弹出登录遮罩' };
  }

  // 3. Rate limited
  if (
    bodyText.includes('访问过于频繁') ||
    bodyText.includes('操作过于频繁') ||
    bodyText.includes('系统繁忙')
  ) {
    return { state: 'rate_limited', reason: '访问频次过高受限' };
  }

  // 4. Job data present -> Ready
  if (hasJobData) {
    return { state: 'ready' };
  }

  // 5. Genuine empty search result
  if (
    bodyText.includes('抱歉，没有找到') ||
    bodyText.includes('暂无符合条件的职位') ||
    bodyText.includes('没有找到相关职位') ||
    bodyText.includes('暂无相关职位') ||
    bodyText.includes('抱歉，未找到') ||
    bodyText.includes('没有找到符合条件的职位') ||
    bodyText.includes('换个搜索词试试')
  ) {
    return { state: 'empty_result', reason: '平台搜索结果为空' };
  }

  return { state: 'unknown' };
}

function extractUrlsOrIds(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class Job51Crawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[51Job] Connecting 51Job crawler to Electron built-in browser engine...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'job51');

    const crawlerType = activeConfig.CRAWLER_TYPE || 'search';
    if (crawlerType === 'detail') {
      await this.parseDetails();
    } else {
      await this.search();
    }
  }

  /**
   * Evaluate page state for security challenges, login requirements, and empty states.
   */
  private async assessCurrentPageState(): Promise<Job51PageStateAssessment> {
    if (!this.page || this.page.isClosed()) return { state: 'unknown' };
    const url = this.page.url();
    const title = await this.page.title().catch(() => '');
    const bodyText = await this.page.locator('body').innerText({ timeout: 1500 }).catch(() => '');

    const domInfo = await this.page.evaluate(() => {
      const hasModal = Boolean(
        document.querySelector(
          '[class*="login-modal"], [class*="modal-login"], [class*="login-dialog"], [data-selector="login-modal"], [class*="login-container"], .ant-modal-mask, .el-dialog__wrapper'
        )
      );
      const win = window as any;
      const hasSearchResult = Boolean(
        win.__SEARCH_RESULT__ &&
        ((Array.isArray(win.__SEARCH_RESULT__.engine_jds) && win.__SEARCH_RESULT__.engine_jds.length > 0) ||
         (Array.isArray(win.__SEARCH_RESULT__.job_list) && win.__SEARCH_RESULT__.job_list.length > 0))
      );
      const cards = document.querySelectorAll(
        '.sensors_exposure, .joblist-item, div[class*="joblist"] div[class*="item"], a[href*="jobs.51job.com"]'
      );
      return {
        hasModal,
        hasJobData: hasSearchResult || cards.length > 0,
      };
    }).catch(() => ({ hasModal: false, hasJobData: false }));

    return classifyJob51PageState({
      url,
      title,
      bodyText: bodyText.slice(0, 10_000),
      hasModal: domInfo.hasModal,
      hasJobData: domInfo.hasJobData,
    });
  }

  /**
   * Handle verification challenges or login requirements by notifying user and waiting.
   */
  private async checkAndHandleIntervention(keyword: string): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    let assessment = await this.assessCurrentPageState();

    if (assessment.state === 'ready') return true;
    if (assessment.state === 'empty_result') return false;

    let loginNotificationSent = false;
    let verifyNotificationSent = false;

    if (assessment.state === 'verification_required') {
      console.warn(`[51Job] Security verification detected for "${keyword}". Requesting manual verification...`);
      notifyManualVerificationRequired('job51', `前程无忧“${keyword}”触发滑块验证，请在内置浏览器窗口中完成验证。`);
      verifyNotificationSent = true;
    } else if (assessment.state === 'login_required' || assessment.state === 'unknown') {
      console.warn(`[51Job] Login required or access restricted for "${keyword}". Requesting user login...`);
      notifyLoginRequired('job51', `前程无忧“${keyword}”需要登录后查看搜索结果，请在内置浏览器中完成登录。`);
      loginNotificationSent = true;
    } else if (assessment.state === 'rate_limited') {
      console.warn(`[51Job] Rate limit detected for "${keyword}". Requesting user check...`);
      notifyManualVerificationRequired('job51', `前程无忧访问过于频繁，请在内置浏览器中完成解封或稍候重试。`);
      verifyNotificationSent = true;
    }

    const maxWaitMs = MANUAL_LOGIN_TIMEOUT_MS;
    const startTime = Date.now();
    console.log(`[51Job] Pausing crawler and waiting for user interaction in browser window (up to ${maxWaitMs / 1000}s)...`);

    while (Date.now() - startTime < maxWaitMs) {
      if (!this.page || this.page.isClosed()) return false;
      await this.humanDelay(this.page, 3);
      if (!this.page || this.page.isClosed()) return false;

      assessment = await this.assessCurrentPageState();

      if (assessment.state === 'ready') {
        console.log(`[51Job] User interaction resolved successfully for "${keyword}"! Resuming extraction.`);
        if (loginNotificationSent) notifyLoginSuccess('job51');
        if (verifyNotificationSent) notifyManualVerificationSuccess('job51');
        await this.humanDelay(this.page, 2);
        return true;
      }
    }

    console.warn(`[51Job] Interactive timeout reached for "${keyword}". Continuing with best-effort parsing.`);
    return false;
  }

  public async search(): Promise<void> {
    if (!this.page) throw new Error('[51Job] Browser page is not initialized.');

    const keywords = extractUrlsOrIds(activeConfig.KEYWORDS || '');
    if (keywords.length === 0) {
      console.warn('[51Job] No search keywords specified.');
      return;
    }

    const maxItems = jobItemLimit(activeConfig.CRAWLER_MAX_NOTES_COUNT);
    const startPage = Math.max(1, Math.floor(Number(activeConfig.START_PAGE) || 1));
    const location = String(activeConfig.JOB_LOCATION || '').trim();
    console.log(`[51Job] Starting job keyword search for ${keywords.length} keyword(s), location "${location || '全国'}", limit ${maxItems} per keyword...`);

    for (const keyword of keywords) {
      console.log(`[51Job] Searching for keyword: "${keyword}"...`);
      let pageNum = startPage;
      let count = 0;
      let scannedPages = 0;
      let stalledPages = 0;
      const seen = new Set<string>();
      const maxPages = searchPageBudget(maxItems, 20, 5, 100);

      while (count < maxItems && scannedPages < maxPages) {
        const searchUrl = buildJobSearchUrl('job51', keyword, pageNum, location);
        console.log(`[51Job] Navigating to page ${pageNum}: ${searchUrl}`);

        try {
          await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          
          // Wait for window.__SEARCH_RESULT__ or card elements
          await Promise.race([
            this.page.waitForFunction(() => {
              const win = window as any;
              const res = win.__SEARCH_RESULT__;
              return res && ((Array.isArray(res.engine_jds) && res.engine_jds.length > 0) || (Array.isArray(res.job_list) && res.job_list.length > 0));
            }, { timeout: 6000 }).catch(() => {}),
            this.page.waitForSelector('.sensors_exposure, .joblist-item, div[class*="joblist"], [class*="login-modal"], #nc_1_wrapper, [class*="no-data"]', { timeout: 6000 }).catch(() => {}),
          ]);

          await this.humanDelay(this.page, 2);

          // Check if intervention is needed before extraction
          let assessment = await this.assessCurrentPageState();
          if (assessment.state === 'verification_required' || assessment.state === 'login_required') {
            const resolved = await this.checkAndHandleIntervention(keyword);
            if (resolved) {
              await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
              await this.humanDelay(this.page, 2);
            }
          }

          // Extract job items via window.__SEARCH_RESULT__ or DOM
          let extracted = await this.extractJobsFromPage();

          // If 0 items on startPage, deep status inspection
          if ((!extracted || extracted.length === 0) && pageNum === startPage) {
            console.log(`[51Job] 0 items extracted on page ${pageNum}. Performing deep status inspection...`);
            assessment = await this.assessCurrentPageState();
            if (assessment.state !== 'empty_result') {
              const resolved = await this.checkAndHandleIntervention(keyword);
              if (resolved) {
                await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await this.humanDelay(this.page, 2);
                extracted = await this.extractJobsFromPage();
              }
            }
          }

          if (!extracted || extracted.length === 0) {
            console.log(`[51Job] No job items extracted on page ${pageNum} for "${keyword}".`);
            break;
          }

          const beforePage = count;
          for (const item of extracted) {
            if (count >= maxItems) break;
            const itemId = String(item.content_id || item.content_url || `${item.title}|${item.company_name}|${item.work_city}`);
            if (seen.has(itemId)) continue;
            seen.add(itemId);

            await connectorOutput.emitJob51Result({
              title: item.title || '前程无忧职位',
              company_name: item.company_name || '未知公司',
              salary: item.salary || '',
              work_city: item.work_city || '',
              job_experience: item.job_experience || '',
              education: item.education || '',
              content_url: item.content_url,
              job_url: item.content_url,
              content_id: item.content_id || item.content_url,
              published_at: item.published_at,
              source_keyword: keyword,
              rank: count + 1,
            });

            count++;
          }

          console.log(`[51Job] Extracted ${count}/${maxItems} jobs for "${keyword}".`);
          stalledPages = count === beforePage ? stalledPages + 1 : 0;
          if (stalledPages >= 2) {
            console.log(`[51Job] Two consecutive pages produced no new jobs for "${keyword}". Stopping pagination.`);
            break;
          }
          pageNum++;
          scannedPages++;
        } catch (err: any) {
          console.error(`[51Job] Error scanning search page ${pageNum} for "${keyword}": ${err.message}`);
          break;
        }
      }
      reportKeywordSearchCompletion('前程无忧', keyword, count, maxItems, '平台结果已结束、重复或访问受限');
    }

    console.log('[51Job] Job search execution completed.');
  }

  /**
   * Robust extractor for 51Job using window.__SEARCH_RESULT__ with DOM fallback.
   */
  private async extractJobsFromPage(): Promise<Array<{
    content_id: string;
    title: string;
    company_name: string;
    salary: string;
    work_city: string;
    job_experience: string;
    education: string;
    content_url: string;
    published_at: number | string;
  }>> {
    if (!this.page || this.page.isClosed()) return [];

    return (await this.page.evaluate(() => {
      const win = window as any;
      let list: any[] = [];

      if (win.__SEARCH_RESULT__ && Array.isArray(win.__SEARCH_RESULT__.engine_jds)) {
        list = win.__SEARCH_RESULT__.engine_jds;
      } else if (win.__SEARCH_RESULT__ && Array.isArray(win.__SEARCH_RESULT__.job_list)) {
        list = win.__SEARCH_RESULT__.job_list;
      }

      if (list.length > 0) {
        return list.map((item) => ({
          content_id: item.jobId || item.job_id || item.jobCode || '',
          title: item.jobName || item.job_name || item.title || '',
          company_name: item.companyName || item.company_name || item.fullCompanyName || '',
          salary: item.providesalaryText || item.providesalary_text || item.salary || '',
          work_city: item.workareaText || item.workarea_text || item.workCity || '',
          job_experience: item.workyearText || item.workyear_text || '',
          education: item.degreeText || item.degree_text || '',
          content_url: item.jobHref || item.job_href || (item.jobId ? `https://jobs.51job.com/all/${item.jobId}.html` : ''),
          published_at: item.issueDate || item.issuedate || Date.now(),
        }));
      }

      // DOM fallback parser
      let domSensors = Array.from(document.querySelectorAll('.sensors_exposure, .joblist-item, div[class*="joblist"] div[class*="item"]'));
      if (domSensors.length === 0) {
        const jobLinks = Array.from(document.querySelectorAll('a[href*="jobs.51job.com"]'));
        const set = new Set<Element>();
        for (const a of jobLinks) {
          const parent = a.closest('div[class*="item"], div[class*="card"], li') || a.parentElement;
          if (parent && parent !== document.body) set.add(parent);
        }
        domSensors = Array.from(set);
      }

      return domSensors.map((el) => {
        const nameEl = el.querySelector('.jname, [class*="jname"], [class*="job-name"], .j_jobname, h3, h4');
        const compEl = el.querySelector('.cname, [class*="cname"], [class*="comp-name"], [class*="company"]');
        const salEl = el.querySelector('.sal, [class*="sal"], [class*="salary"]');
        const linkEl = el.querySelector('a[href*="jobs.51job.com"]') || el.querySelector('a');
        const cityEl = el.querySelector('.d.at, [class*="workarea"], [class*="job-area"], [class*="location"]');
        const href = (linkEl as HTMLAnchorElement)?.href || '';

        const spans = Array.from(el.querySelectorAll('span, div, p, em')).map((e) => e.textContent?.trim() || '').filter(Boolean);
        const expMatch = spans.find((s) => s.includes('经验') || /^\d+(?:-\d+)?年/.test(s) || s.includes('应届'));
        const eduMatch = spans.find((s) => s.includes('大专') || s.includes('本科') || s.includes('硕士') || s.includes('博士') || s.includes('学历不限'));

        return {
          content_id: href ? href.split('/').pop()?.replace('.html', '') || href : '',
          title: nameEl?.textContent?.trim() || '',
          company_name: compEl?.textContent?.trim() || '',
          salary: salEl?.textContent?.trim() || '',
          work_city: cityEl?.textContent?.trim() || '',
          job_experience: expMatch || '',
          education: eduMatch || '',
          content_url: href,
          published_at: Date.now(),
        };
      }).filter((x) => (x.title || x.content_id) && x.content_url);
    }).catch(() => [])) as Array<{
      content_id: string;
      title: string;
      company_name: string;
      salary: string;
      work_city: string;
      job_experience: string;
      education: string;
      content_url: string;
      published_at: number | string;
    }>;
  }

  private async parseDetails(): Promise<void> {
    const rawTargets = activeConfig.SPECIFIED_IDS || activeConfig.KEYWORDS || '';
    const targets = extractUrlsOrIds(rawTargets);

    if (targets.length === 0) {
      console.warn('[51Job] No detail URLs or IDs provided.');
      return;
    }

    console.log(`[51Job] Starting detail parsing for ${targets.length} target(s)...`);

    for (const target of targets) {
      let detailUrl = target;
      if (!detailUrl.startsWith('http')) {
        detailUrl = `https://jobs.51job.com/all/${target}.html`;
      }

      console.log(`[51Job] Parsing detail target: ${detailUrl}`);

      try {
        let html = '';
        if (this.page) {
          await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
          await this.humanDelay(this.page, 1);
          html = await this.page.content();
        } else {
          const response = await systemHttpClient.get(detailUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            timeout: 15000,
          });
          html = response.data;
        }

        if (typeof html !== 'string') {
          console.error(`[51Job] Invalid HTML response for ${detailUrl}`);
          continue;
        }

        const parsedDetail = (await this.page?.evaluate(() => {
          const title = document.querySelector('.tHeader h1, [class*="title"], h1')?.textContent?.trim() || '';
          const salary = document.querySelector('.tHeader strong, [class*="sal"], [class*="salary"]')?.textContent?.trim() || '';
          const company = document.querySelector('.cname, [class*="company"]')?.textContent?.trim() || '';
          const desc = document.querySelector('.bmsg.job_msg, [class*="job_msg"], [class*="job-desc"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
          return { title, salary, company, desc };
        }) || {}) as { title: string; salary: string; company: string; desc: string };

        await connectorOutput.emitJob51Result({
          title: parsedDetail.title || '前程无忧职位详情',
          company_name: parsedDetail.company || '',
          salary: parsedDetail.salary || '',
          desc: parsedDetail.desc || '',
          content_url: detailUrl,
          content_id: target,
          source_keyword: target,
          published_at: Date.now(),
        });

        console.log(`[51Job] Successfully stored job detail for: ${detailUrl}`);
      } catch (err: any) {
        console.error(`[51Job] Failed to parse detail for ${detailUrl}: ${err.message}`);
      }
    }

    console.log('[51Job] Detail parsing completed.');
  }
}
