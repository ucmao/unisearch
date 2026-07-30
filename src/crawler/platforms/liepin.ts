import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyManualVerificationRequired,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { systemHttpClient } from '../base/SystemHttpClient';

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

  public async start(): Promise<void> {
    console.log('[Liepin] Connecting Liepin crawler to Electron built-in browser engine...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'liepin');

    if (activeConfig.COOKIES && this.browserContext) {
      console.log('[Liepin] Applying user-provided Cookie header...');
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.liepin.com');
    }

    const crawlerType = activeConfig.CRAWLER_TYPE || 'search';
    if (crawlerType === 'detail') {
      await this.parseDetails();
    } else {
      await this.search();
    }
  }

  public async search(): Promise<void> {
    if (!this.page) throw new Error('[Liepin] Browser page is not initialized.');

    const keywords = extractUrlsOrIds(activeConfig.KEYWORDS || '');
    if (keywords.length === 0) {
      console.warn('[Liepin] No search keywords specified.');
      return;
    }

    const maxItems = Number(activeConfig.CRAWLER_MAX_NOTES_COUNT || 20);
    console.log(`[Liepin] Starting job keyword search for ${keywords.length} keyword(s), limit ${maxItems} per keyword...`);

    for (const keyword of keywords) {
      console.log(`[Liepin] Searching for keyword: "${keyword}"...`);
      let pageNum = 0;
      let count = 0;

      while (count < maxItems && pageNum < 5) {
        const safeKw = encodeURIComponent(keyword);
        const searchUrl = `https://www.liepin.com/zhaopin/?key=${safeKw}&currentPage=${pageNum}`;
        console.log(`[Liepin] Navigating to page ${pageNum + 1}: ${searchUrl}`);

        try {
          await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.humanDelay(this.page, 3);

          const pageTitle = await this.page.title().catch(() => '');
          const pageContent = await this.page.content().catch(() => '');

          if (pageTitle.includes('验证') || pageTitle.includes('Verification') || pageContent.includes('sec-captcha')) {
            console.warn('[Liepin] Captcha / Verification page detected in browser window.');
            notifyManualVerificationRequired('liepin', '猎聘网触发验证码，请在浏览器窗口中完成手动验证。');
            await this.page.waitForTimeout(5000);
          }

          // DOM card parsing for Liepin
          const extracted = await this.page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('.job-card-pc-container, div[class*="job-card"]'));
            return cards.map((card) => {
              const linkEl = card.querySelector('a[href*="/job/"]') || card.querySelector('a');
              const href = (linkEl as HTMLAnchorElement)?.href || '';
              const titleEl = card.querySelector('.ellipsis-1, [class*="job-title"], [class*="title"]');

              // Find inner spans
              const spans = Array.from(card.querySelectorAll('span, div')).map((e) => e.textContent?.trim() || '').filter(Boolean);

              // Find salary (e.g. 10-15k, 20-30k)
              const salaryMatch = spans.find((s) => /^\d+(?:-\d+)?k/i.test(s) || /^\d+(?:-\d+)?万/i.test(s));
              const expMatch = spans.find((s) => s.includes('经验') || s.includes('年') || s.includes('应届'));
              const eduMatch = spans.find((s) => s.includes('大专') || s.includes('本科') || s.includes('硕士') || s.includes('博士') || s.includes('学历不限'));
              const compEl = card.querySelector('.company-name, [class*="company-name"], [class*="comp"]');

              // Extract jobId from URL (e.g. /job/1976807335.shtml)
              const jobIdMatch = href.match(/\/job\/(\d+)\.shtml/);
              const jobId = jobIdMatch ? jobIdMatch[1] : href;

              return {
                content_id: jobId,
                title: titleEl?.textContent?.trim() || '猎聘职位',
                company_name: compEl?.textContent?.trim() || '',
                salary: salaryMatch || '',
                work_city: '',
                job_experience: expMatch || '',
                education: eduMatch || '',
                content_url: href,
                published_at: Date.now(),
              };
            }).filter((x) => x.title || x.content_url);
          });

          if (!extracted || extracted.length === 0) {
            console.log(`[Liepin] No job items extracted on page ${pageNum + 1} for "${keyword}".`);
            break;
          }

          for (const item of extracted) {
            if (count >= maxItems) break;

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
          if (extracted.length < 10) break;
          pageNum++;
        } catch (err: any) {
          console.error(`[Liepin] Error scanning search page ${pageNum + 1} for "${keyword}": ${err.message}`);
          break;
        }
      }
    }

    console.log('[Liepin] Job search execution completed.');
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

        const parsedDetail = await this.page?.evaluate(() => {
          const title = document.querySelector('.job-title-box, h1, [class*="job-title"]')?.textContent?.trim() || '';
          const salary = document.querySelector('.job-salary, [class*="salary"]')?.textContent?.trim() || '';
          const company = document.querySelector('.company-name, [class*="company-name"]')?.textContent?.trim() || '';
          const desc = document.querySelector('.job-intro-container, [class*="job-intro"], [class*="desc"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';
          return { title, salary, company, desc };
        }) || {};

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
