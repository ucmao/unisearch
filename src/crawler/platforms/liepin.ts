import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyCrawlerPageRecoveryRequired,
  notifyLoginRequired,
  notifyLoginSuccess,
  notifyManualVerificationRequired,
  notifyManualVerificationSuccess,
  recoverElectronCrawlerPage,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { systemHttpClient } from '../base/SystemHttpClient';
import { reportKeywordSearchCompletion, searchPageBudget } from '../base/connectorHelpers';
import { MANUAL_LOGIN_TIMEOUT_MS, MANUAL_VERIFICATION_TIMEOUT_MS } from '../base/interactiveTimeouts';
import { buildJobSearchUrl, jobItemLimit } from './jobSearch';

export type LiepinPageState =
  | 'ready'
  | 'empty_result'
  | 'login_required'
  | 'verification_required'
  | 'rate_limited'
  | 'unknown';

export interface LiepinPageStateAssessment {
  state: LiepinPageState;
  reason?: string;
}

export function classifyLiepinPageState(input: {
  url: string;
  title: string;
  bodyText: string;
  hasModal?: boolean;
  hasJobCards?: boolean;
}): LiepinPageStateAssessment {
  const { url, title, bodyText, hasModal, hasJobCards } = input;
  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();

  // 1. Verification / Captcha detection
  if (
    lowerTitle.includes('验证') ||
    lowerTitle.includes('security') ||
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

  // 2. Job cards present -> Page is ready! (Takes priority over static footer/hidden modal text)
  if (hasJobCards) {
    return { state: 'ready' };
  }

  // 3. Login required / Modal blocked detection
  if (
    lowerUrl.includes('passport.liepin.com') ||
    lowerUrl.includes('/login') ||
    hasModal ||
    bodyText.includes('登录查看更多职位') ||
    bodyText.includes('登录后可查看') ||
    bodyText.includes('请先登录')
  ) {
    return { state: 'login_required', reason: '页面需要登录或弹出登录遮罩' };
  }

  // 4. Rate limited
  if (
    bodyText.includes('访问过于频繁') ||
    bodyText.includes('操作过于频繁') ||
    bodyText.includes('系统繁忙')
  ) {
    return { state: 'rate_limited', reason: '访问频次过高受限' };
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

export class LiepinCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  private hasDeclinedLogin = false;

  private async requireActivePage(stage: string, recoveryUrl = ''): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      if (recoveryUrl && (this.page.url().includes('#unisearch-crawler-') || this.page.url().startsWith('about:blank'))) {
        console.warn(`[Liepin] Restoring ${recoveryUrl} after placeholder state in ${stage}.`);
        await this.page.goto(recoveryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }
      return this.page;
    }

    if (!this.browserContext) {
      throw new Error(`[Liepin] BrowserContext closed during ${stage}.`);
    }

    let replacement = await recoverElectronCrawlerPage(
      this.browserContext,
      'liepin',
      (candidate) => {
        try {
          const hostname = new URL(candidate.url()).hostname;
          return hostname === 'liepin.com' || hostname.endsWith('.liepin.com');
        } catch {
          return false;
        }
      },
      20
    );

    if (!replacement) {
      notifyCrawlerPageRecoveryRequired('liepin', `页面在 ${stage} 时掉线`);
      replacement = await recoverElectronCrawlerPage(this.browserContext, 'liepin', () => true, 30);
    }

    if (!replacement) {
      throw new Error(`[Liepin] Failed to recover crawler page during ${stage}.`);
    }

    this.page = replacement;
    if (recoveryUrl) {
      await this.page.goto(recoveryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    return this.page;
  }

  public async start(): Promise<void> {
    console.log('[Liepin] Connecting Liepin crawler to Electron built-in browser engine...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'liepin');

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
  private async assessCurrentPageState(): Promise<LiepinPageStateAssessment> {
    if (!this.page || this.page.isClosed()) return { state: 'unknown' };
    const url = this.page.url();
    const title = await this.page.title().catch(() => '');
    const bodyText = await this.page.locator('body').innerText({ timeout: 1500 }).catch(() => '');

    const domInfo = await this.page.evaluate(() => {
      const modalEls = Array.from(
        document.querySelectorAll(
          '[class*="login-modal"], [class*="modal-login"], [class*="login-dialog"], [data-selector="login-modal"], .ant-modal-mask'
        )
      );
      const hasModal = modalEls.some((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && (el as HTMLElement).offsetWidth > 0;
      });

      const cards = document.querySelectorAll(
        '.job-card-pc-container, div[class*="job-card"], div[class*="job-list-item"], a[href*="/job/"]'
      );
      return {
        hasModal,
        hasJobCards: cards.length > 0,
      };
    }).catch(() => ({ hasModal: false, hasJobCards: false }));

    return classifyLiepinPageState({
      url,
      title,
      bodyText: bodyText.slice(0, 10_000),
      hasModal: domInfo.hasModal,
      hasJobCards: domInfo.hasJobCards,
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

    // If user already timed out on login in this run, do not block repeatedly on pagination
    if (assessment.state === 'login_required' && this.hasDeclinedLogin) {
      return false;
    }

    let loginNotificationSent = false;
    let verifyNotificationSent = false;

    if (assessment.state === 'verification_required') {
      console.warn(`[Liepin] Security verification detected for "${keyword}". Requesting manual verification...`);
      notifyManualVerificationRequired('liepin', `猎聘网“${keyword}”触发安全验证，请在内置浏览器窗口中完成验证。`);
      verifyNotificationSent = true;
    } else if (assessment.state === 'login_required' || assessment.state === 'unknown') {
      console.warn(`[Liepin] Login required or access restricted for "${keyword}". Requesting user login...`);
      notifyLoginRequired('liepin', `猎聘网“${keyword}”需要登录后查看搜索结果，请在内置浏览器中完成登录。`);
      loginNotificationSent = true;
    } else if (assessment.state === 'rate_limited') {
      console.warn(`[Liepin] Rate limit detected for "${keyword}". Requesting user check...`);
      notifyManualVerificationRequired('liepin', `猎聘网访问过于频繁，请在内置浏览器中完成解封或稍候重试。`);
      verifyNotificationSent = true;
    }

    const maxWaitMs = assessment.state === 'verification_required' ? MANUAL_VERIFICATION_TIMEOUT_MS : MANUAL_LOGIN_TIMEOUT_MS;
    const startTime = Date.now();
    console.log(`[Liepin] Pausing crawler and waiting for user interaction in browser window (up to ${maxWaitMs / 1000}s)...`);

    while (Date.now() - startTime < maxWaitMs) {
      if (!this.page || this.page.isClosed()) return false;
      await this.humanDelay(this.page, 3);
      if (!this.page || this.page.isClosed()) return false;

      assessment = await this.assessCurrentPageState();

      if (assessment.state === 'ready') {
        console.log(`[Liepin] User interaction resolved successfully for "${keyword}"! Resuming extraction.`);
        if (loginNotificationSent) notifyLoginSuccess('liepin');
        if (verifyNotificationSent) notifyManualVerificationSuccess('liepin');
        await this.humanDelay(this.page, 2);
        return true;
      }
    }

    if (loginNotificationSent) {
      this.hasDeclinedLogin = true;
    }
    console.warn(`[Liepin] Interactive timeout reached for "${keyword}". Continuing with best-effort parsing.`);
    return false;
  }

  public async search(): Promise<void> {
    if (!this.page) throw new Error('[Liepin] Browser page is not initialized.');

    const keywords = extractUrlsOrIds(activeConfig.KEYWORDS || '');
    if (keywords.length === 0) {
      console.warn('[Liepin] No search keywords specified.');
      return;
    }

    const maxItems = jobItemLimit(activeConfig.CRAWLER_MAX_NOTES_COUNT);
    const startPage = Math.max(1, Math.floor(Number(activeConfig.START_PAGE) || 1));
    const location = String(activeConfig.JOB_LOCATION || '').trim();
    console.log(`[Liepin] Starting job keyword search for ${keywords.length} keyword(s), location "${location || '全国'}", limit ${maxItems} per keyword...`);

    for (const keyword of keywords) {
      console.log(`[Liepin] Searching for keyword: "${keyword}"...`);
      let pageNum = startPage;
      let count = 0;
      let scannedPages = 0;
      let stalledPages = 0;
      const seen = new Set<string>();
      const maxPages = searchPageBudget(maxItems, 40, 5, 100);

      while (count < maxItems && scannedPages < maxPages) {
        const searchUrl = buildJobSearchUrl('liepin', keyword, pageNum, location);
        console.log(`[Liepin] Navigating to page ${pageNum}: ${searchUrl}`);

        try {
          const page = await this.requireActivePage(`页码 ${pageNum}`, searchUrl);
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          
          // Wait for job cards or empty state or login modal to appear
          await page.waitForSelector(
            '.job-card-pc-container, div[class*="job-card"], div[class*="job-list"], a[href*="/job/"], [class*="login-modal"], .ant-modal-mask, [class*="no-data"], .no-data-box',
            { timeout: 8000 }
          ).catch(() => {});

          await this.humanDelay(this.page, 2);

          // Check if intervention is needed before extraction
          let assessment = await this.assessCurrentPageState();
          if (assessment.state === 'verification_required' || assessment.state === 'login_required') {
            if (assessment.state === 'login_required' && this.hasDeclinedLogin) {
              console.log(`[Liepin] Skipping login wait for page ${pageNum} as login was not completed earlier.`);
            } else {
              const resolved = await this.checkAndHandleIntervention(keyword);
              if (resolved) {
                // Reload search URL after login/verification success to ensure clean render
                await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await this.humanDelay(this.page, 2);
              }
            }
          }

          // Robust DOM card parsing for Liepin
          let extracted = await this.extractJobsFromPage();

          // If no cards extracted on page 1, check if login or security challenge blocked it
          if ((!extracted || extracted.length === 0) && pageNum === startPage) {
            console.log(`[Liepin] 0 items extracted on page ${pageNum}. Performing deep status inspection...`);
            assessment = await this.assessCurrentPageState();
            if (assessment.state !== 'empty_result' && !(assessment.state === 'login_required' && this.hasDeclinedLogin)) {
              const resolved = await this.checkAndHandleIntervention(keyword);
              if (resolved) {
                await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await this.humanDelay(this.page, 2);
                extracted = await this.extractJobsFromPage();
              }
            }
          }

          if (!extracted || extracted.length === 0) {
            console.log(`[Liepin] No job items extracted on page ${pageNum} for "${keyword}".`);
            break;
          }

          const beforePage = count;
          for (const item of extracted) {
            if (count >= maxItems) break;
            const itemId = String(item.content_id || item.content_url || `${item.title}|${item.company_name}|${item.work_city}`);
            if (seen.has(itemId)) continue;
            seen.add(itemId);

            await connectorOutput.emitLiepinResult({
              title: item.title || '猎聘职位',
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

          console.log(`[Liepin] Extracted ${count}/${maxItems} jobs for "${keyword}".`);
          stalledPages = count === beforePage ? stalledPages + 1 : 0;
          if (stalledPages >= 2) {
            console.log(`[Liepin] Two consecutive pages produced no new jobs for "${keyword}". Stopping pagination.`);
            break;
          }
          pageNum++;
          scannedPages++;
        } catch (err: any) {
          console.error(`[Liepin] Error scanning search page ${pageNum} for "${keyword}": ${err.message}`);
          break;
        }
      }
      reportKeywordSearchCompletion('猎聘', keyword, count, maxItems, '平台结果已结束、重复或访问受限');
    }

    console.log('[Liepin] Job search execution completed.');
  }

  /**
   * Multi-selector robust DOM extractor for Liepin job listings.
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
    published_at: number;
  }>> {
    if (!this.page || this.page.isClosed()) return [];

    return (await this.page.evaluate(() => {
      // 1. Direct card selectors
      let cards = Array.from(
        document.querySelectorAll('.job-card-pc-container, div[class*="job-card"], div[class*="job-list-item"], li[class*="job-card"]')
      );

      // 2. Heuristic fallback: find anchors linking to /job/ and use their container
      if (cards.length === 0) {
        const jobLinks = Array.from(document.querySelectorAll('a[href*="/job/"]'));
        const containerSet = new Set<Element>();
        for (const a of jobLinks) {
          const parentCard = a.closest('div[class*="card"], li, div[class*="item"], div[class*="box"]') || a.parentElement;
          if (parentCard && parentCard !== document.body) {
            containerSet.add(parentCard);
          }
        }
        cards = Array.from(containerSet);
      }

      return cards.map((card) => {
        const linkEl = (card.querySelector('a[href*="/job/"]') || (card.matches('a[href*="/job/"]') ? card : null)) as HTMLAnchorElement | null;
        if (!linkEl) return null;
        const href = linkEl.href || '';
        if (!href || !href.includes('/job/')) return null;

        const titleEl = card.querySelector('.ellipsis-1, [class*="job-title"], [class*="title"], h3, h4') || linkEl;
        const title = titleEl?.textContent?.trim() || '';
        if (!title || title.includes('更多职位') || title.includes('查看更多') || title.includes('行业资讯')) return null;

        // Find inner text elements
        const spans = Array.from(card.querySelectorAll('span, div, p, em, i, b'))
          .map((e) => e.textContent?.trim() || '')
          .filter(Boolean);

        // Extract salary
        const salaryMatch = spans.find(
          (s) => /^\d+(?:-\d+)?\s*[kK万]/i.test(s) || /^\d+(?:-\d+)?\s*元(?:\/月)?$/i.test(s) || /^\d+-\d+薪$/i.test(s)
        );
        const expMatch = spans.find((s) => s.includes('经验') || /^\d+(?:-\d+)?年/.test(s) || s.includes('应届') || s.includes('在校'));
        const eduMatch = spans.find((s) => s.includes('大专') || s.includes('本科') || s.includes('硕士') || s.includes('博士') || s.includes('学历不限') || s.includes('中专') || s.includes('高中'));
        const compEl = card.querySelector('.company-name, [class*="company-name"], [class*="comp"], a[href*="/company/"]');
        const cityEl = card.querySelector('.job-dq-box, [class*="job-area"], [class*="job-city"], [class*="location"], [class*="city"]');

        // Extract jobId from URL (e.g. /job/1976807335.shtml)
        const jobIdMatch = href.match(/\/job\/(\d+)\.shtml/);
        const jobId = jobIdMatch ? jobIdMatch[1] : href;

        return {
          content_id: jobId,
          title,
          company_name: compEl?.textContent?.trim() || '未知公司',
          salary: salaryMatch || '',
          work_city: cityEl?.textContent?.trim() || '',
          job_experience: expMatch || '',
          education: eduMatch || '',
          content_url: href,
          published_at: Date.now(),
        };
      }).filter((x): x is NonNullable<typeof x> => Boolean(x && x.title && x.content_url && x.content_url.includes('/job/')));
    }).catch(() => [])) as Array<{
      content_id: string;
      title: string;
      company_name: string;
      salary: string;
      work_city: string;
      job_experience: string;
      education: string;
      content_url: string;
      published_at: number;
    }>;
  }

  private async parseDetails(): Promise<void> {
    const rawTargets = activeConfig.SPECIFIED_IDS || activeConfig.KEYWORDS || '';
    const targets = extractUrlsOrIds(rawTargets);

    if (targets.length === 0) {
      console.warn('[Liepin] No detail URLs or IDs provided.');
      return;
    }

    console.log(`[Liepin] Starting detail parsing for ${targets.length} target(s)...`);

    for (const target of targets) {
      let detailUrl = target;
      if (!detailUrl.startsWith('http')) {
        detailUrl = `https://www.liepin.com/job/${target}.shtml`;
      }

      console.log(`[Liepin] Parsing detail target: ${detailUrl}`);

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
          console.error(`[Liepin] Invalid HTML response for ${detailUrl}`);
          continue;
        }

        const parsedDetail = (await this.page?.evaluate(() => {
          const title = document.querySelector('.job-title-box, h1, [class*="job-title"]')?.textContent?.trim() || '';
          const salary = document.querySelector('.job-salary, [class*="salary"]')?.textContent?.trim() || '';
          const company = document.querySelector('.company-name, [class*="company-name"]')?.textContent?.trim() || '';
          const desc = document.querySelector('.job-intro-container, [class*="job-intro"], [class*="desc"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
          return { title, salary, company, desc };
        }) || {}) as { title: string; salary: string; company: string; desc: string };

        await connectorOutput.emitLiepinResult({
          title: parsedDetail.title || '猎聘职位详情',
          company_name: parsedDetail.company || '',
          salary: parsedDetail.salary || '',
          desc: parsedDetail.desc || '',
          content_url: detailUrl,
          content_id: target,
          source_keyword: target,
          published_at: Date.now(),
        });

        console.log(`[Liepin] Successfully stored job detail for: ${detailUrl}`);
      } catch (err: any) {
        console.error(`[Liepin] Failed to parse detail for ${detailUrl}: ${err.message}`);
      }
    }

    console.log('[Liepin] Detail parsing completed.');
  }
}
