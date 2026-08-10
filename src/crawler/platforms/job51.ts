import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyManualVerificationRequired,
  notifyManualVerificationSuccess,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { systemHttpClient } from '../base/SystemHttpClient';
import { reportKeywordSearchCompletion, searchPageBudget } from '../base/connectorHelpers';
import { waitForManualVerificationToClear } from '../base/interactiveTimeouts';
import { buildJobSearchUrl, jobItemLimit } from './jobSearch';

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
          await this.humanDelay(this.page, 3);

          const pageTitle = await this.page.title().catch(() => '');
          const pageContent = await this.page.content().catch(() => '');

          if (pageTitle.includes('验证') || pageTitle.includes('Verification') || pageContent.includes('nc_1_wrapper') || pageContent.includes('sec-captcha')) {
            console.warn('[51Job] Captcha / Verification page detected in browser window.');
            notifyManualVerificationRequired('job51', '前程无忧触发滑块/人脸验证，请在浏览器窗口中完成手动验证。');
            const cleared = await waitForManualVerificationToClear(async () => {
              const currentTitle = await this.page!.title().catch(() => '');
              const currentContent = await this.page!.content().catch(() => '');
              return currentTitle.includes('验证') || currentTitle.includes('Verification')
                || currentContent.includes('nc_1_wrapper') || currentContent.includes('sec-captcha');
            }, (milliseconds) => this.page!.waitForTimeout(milliseconds));
            if (cleared) notifyManualVerificationSuccess('job51');
            else console.warn('[51Job] Manual verification timed out; continuing with best-effort extraction.');
          }

          // Extract job items via window.__SEARCH_RESULT__ or DOM
          const extracted = await this.page.evaluate(() => {
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
            const domSensors = Array.from(document.querySelectorAll('.sensors_exposure, .joblist-item, div[class*="joblist"] div[class*="item"]'));
            return domSensors.map((el) => {
              const nameEl = el.querySelector('.jname, [class*="jname"], [class*="job-name"], .j_jobname');
              const compEl = el.querySelector('.cname, [class*="cname"], [class*="comp-name"]');
              const salEl = el.querySelector('.sal, [class*="sal"], [class*="salary"]');
              const linkEl = el.querySelector('a[href*="jobs.51job.com"]') || el.querySelector('a');
              const cityEl = el.querySelector('.d.at, [class*="workarea"], [class*="job-area"], [class*="location"]');
              const href = (linkEl as HTMLAnchorElement)?.href || '';

              return {
                content_id: href ? href.split('/').pop()?.replace('.html', '') || href : '',
                title: nameEl?.textContent?.trim() || '',
                company_name: compEl?.textContent?.trim() || '',
                salary: salEl?.textContent?.trim() || '',
                work_city: cityEl?.textContent?.trim() || '',
                job_experience: '',
                education: '',
                content_url: href,
                published_at: Date.now(),
              };
            }).filter((x) => x.title || x.content_url);
          });

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
