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
import { reportKeywordSearchCompletion, searchPageBudget } from '../base/connectorHelpers';
import { buildJobSearchUrl, jobItemLimit, resolveJobLocation } from './jobSearch';

function extractUrlsOrIds(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class ZhaopinCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[Zhaopin] Connecting Zhaopin crawler to Electron built-in browser engine...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'zhaopin');

    if (activeConfig.COOKIES && this.browserContext) {
      console.log('[Zhaopin] Applying user-provided Cookie header...');
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.zhaopin.com');
    }

    const crawlerType = activeConfig.CRAWLER_TYPE || 'search';
    if (crawlerType === 'detail') {
      await this.parseDetails();
    } else {
      await this.search();
    }
  }

  public async search(): Promise<void> {
    if (!this.page) throw new Error('[Zhaopin] Browser page is not initialized.');

    const keywords = extractUrlsOrIds(activeConfig.KEYWORDS || '');
    if (keywords.length === 0) {
      console.warn('[Zhaopin] No search keywords specified.');
      return;
    }

    const maxItems = jobItemLimit(activeConfig.CRAWLER_MAX_NOTES_COUNT);
    const startPage = Math.max(1, Math.floor(Number(activeConfig.START_PAGE) || 1));
    const location = String(activeConfig.JOB_LOCATION || '').trim();
    console.log(`[Zhaopin] Starting job keyword search for ${keywords.length} keyword(s), location "${location || '全国'}", limit ${maxItems} per keyword...`);

    for (const keyword of keywords) {
      console.log(`[Zhaopin] Searching for keyword: "${keyword}"...`);
      let pageNum = startPage;
      let count = 0;
      let scannedPages = 0;
      let stalledPages = 0;
      const seen = new Set<string>();
      const maxPages = searchPageBudget(maxItems, 20, 5, 100);

      while (count < maxItems && scannedPages < maxPages) {
        const searchUrl = buildJobSearchUrl('zhaopin', keyword, pageNum, location);
        console.log(`[Zhaopin] Built-in browser navigating to page ${pageNum}: ${searchUrl}`);

        try {
          await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.humanDelay(this.page, 3);

          // Wait for window.__INITIAL_STATE__ to populate or page to redirect
          await this.page.waitForFunction(() => {
            const s = (window as any).__INITIAL_STATE__;
            return s && (s.positionList || s.soulPositionList || s.searchResult || s.position);
          }, { timeout: 8000 }).catch(() => {});

          // Check if captcha or slider verification page appeared
          const pageTitle = await this.page.title().catch(() => '');
          const pageContent = await this.page.content().catch(() => '');
          if (pageTitle.includes('验证') || pageContent.includes('nc_1_wrapper') || pageContent.includes('sec-captcha')) {
            console.warn('[Zhaopin] Anti-spider slider captcha detected in built-in browser window.');
            notifyManualVerificationRequired('zhaopin', '智联招聘触发人脸/滑块验证，请在内置浏览器窗口中完成手动验证。');
            await this.page.waitForTimeout(5000);
          }

          // Method 1: Extract from window.__INITIAL_STATE__
          const initialState = await this.page.evaluate(() => {
            return (window as any).__INITIAL_STATE__ || null;
          });

          let jobList: any[] = [];
          if (initialState) {
            if (Array.isArray(initialState.positionList)) {
              jobList = initialState.positionList;
            } else if (Array.isArray(initialState.positionList?.results)) {
              jobList = initialState.positionList.results;
            } else if (Array.isArray(initialState.positionList?.list)) {
              jobList = initialState.positionList.list;
            } else if (Array.isArray(initialState.soulPositionList)) {
              jobList = initialState.soulPositionList;
            } else if (Array.isArray(initialState.searchResult?.list)) {
              jobList = initialState.searchResult.list;
            }
          }

          // Method 2 Fallback: Regex parse HTML for __INITIAL_STATE__
          if (jobList.length === 0) {
            const match = pageContent.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/s);
            if (match && match[1]) {
              try {
                const parsed = JSON.parse(match[1]);
                if (Array.isArray(parsed.positionList)) jobList = parsed.positionList;
                else if (Array.isArray(parsed.positionList?.results)) jobList = parsed.positionList.results;
                else if (Array.isArray(parsed.positionList?.list)) jobList = parsed.positionList.list;
              } catch {}
            }
          }

          // Method 3 Fallback: DOM query selector parsing
          if (jobList.length === 0) {
            const domJobs = await this.page.evaluate(() => {
              const items = Array.from(document.querySelectorAll('.joblist-box__item, .positionlist__item, div[class*="joblist"], div[class*="job-item"]'));
              return items.map((el) => {
                const nameEl = el.querySelector('.jobinfo__name, [class*="job-name"], [class*="title"], a[href*="jobdetail"]');
                const compEl = el.querySelector('.companyinfo__name, [class*="company-name"], [class*="company"]');
                const salEl = el.querySelector('.jobinfo__salary, [class*="salary"]');
                const linkEl = el.querySelector('a[href*="jobdetail"]') as HTMLAnchorElement | null;
                return {
                  name: nameEl?.textContent?.trim() || '',
                  companyName: compEl?.textContent?.trim() || '',
                  salary60: salEl?.textContent?.trim() || '',
                  positionUrl: linkEl?.href || '',
                };
              }).filter(item => item.name || item.positionUrl);
            });
            if (domJobs.length > 0) jobList = domJobs;
          }

          // Method 4 Fallback: Query parameter URL fallback (e.g. https://sou.zhaopin.com/?kw=...)
          if (jobList.length === 0) {
            const fallbackParams = new URLSearchParams({ kw: keyword, p: String(pageNum) });
            if (location) fallbackParams.set('jl', resolveJobLocation('zhaopin', location));
            const fallbackUrl = `https://sou.zhaopin.com/?${fallbackParams.toString()}`;
            console.log(`[Zhaopin] Path URL returned 0 items, attempting fallback URL: ${fallbackUrl}`);
            await this.page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
            await this.humanDelay(this.page, 3);
            const fallbackState = await this.page.evaluate(() => (window as any).__INITIAL_STATE__ || null);
            if (fallbackState) {
              const list = fallbackState.positionList?.results || fallbackState.positionList || fallbackState.soulPositionList;
              if (Array.isArray(list)) jobList = list;
            }
          }

          if (jobList.length === 0) {
            console.log(`[Zhaopin] No job items extracted on page ${pageNum} for "${keyword}". (Title: "${pageTitle}")`);
            break;
          }

          const beforePage = count;
          for (const item of jobList) {
            if (count >= maxItems) break;

            const jobName = item.jobName || item.name || item.title || '未知职位';
            const companyName = item.companyName || item.company?.name || '未知公司';
            const salary = item.salary60 || item.salary || '';
            const workCity = item.workCity || item.cityName || '';
            const jobExperience = item.workingExp || item.workingExpFormat || '';
            const education = item.eduLevel || item.eduLevelFormat || item.education || '';
            const rawUrl = item.positionUrl || item.positionURL || (item.number ? `https://www.zhaopin.com/jobdetail/${item.number}.htm` : '');
            const jobUrl = rawUrl ? rawUrl.split('?')[0] : '';
            const jobId = String(item.number || item.jobId || jobUrl || `${jobName}|${companyName}|${workCity}`);
            if (seen.has(jobId)) continue;
            seen.add(jobId);

            await connectorOutput.emitZhaopinResult({
              title: jobName,
              company_name: companyName,
              salary,
              work_city: workCity,
              job_experience: jobExperience,
              education,
              content_url: jobUrl,
              job_url: jobUrl,
              content_id: jobId,
              published_at: item.publishTime || item.updateDate || Date.now(),
              source_keyword: keyword,
              rank: count + 1,
            });

            count++;
          }

          console.log(`[Zhaopin] Extracted ${count}/${maxItems} jobs for "${keyword}".`);
          stalledPages = count === beforePage ? stalledPages + 1 : 0;
          if (stalledPages >= 2) {
            console.log(`[Zhaopin] Two consecutive pages produced no new jobs for "${keyword}". Stopping pagination.`);
            break;
          }
          pageNum++;
          scannedPages++;
        } catch (err: any) {
          console.error(`[Zhaopin] Error scanning search page ${pageNum} for "${keyword}": ${err.message}`);
          break;
        }
      }
      reportKeywordSearchCompletion('智联招聘', keyword, count, maxItems, '平台结果已结束、重复或访问受限');
    }

    console.log('[Zhaopin] Job search execution completed via built-in browser.');
  }

  private async parseDetails(): Promise<void> {
    const rawTargets = activeConfig.SPECIFIED_IDS || activeConfig.KEYWORDS || '';
    const targets = extractUrlsOrIds(rawTargets);

    if (targets.length === 0) {
      console.warn('[Zhaopin] No detail URLs or IDs provided.');
      return;
    }

    console.log(`[Zhaopin] Starting detail parsing for ${targets.length} target(s)...`);

    for (const target of targets) {
      let detailUrl = target;
      if (!detailUrl.startsWith('http')) {
        detailUrl = `https://www.zhaopin.com/jobdetail/${target}.htm`;
      }

      console.log(`[Zhaopin] Parsing detail target: ${detailUrl}`);

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
          console.error(`[Zhaopin] Invalid HTML response for ${detailUrl}`);
          continue;
        }

        // Multi-line JSON regex with 's' flag for __INITIAL_STATE__
        const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/s);
        let detailData: any = null;

        if (match && match[1]) {
          try {
            detailData = JSON.parse(match[1]);
          } catch (parseErr: any) {
            console.warn(`[Zhaopin] JSON parse failed for __INITIAL_STATE__: ${parseErr.message}`);
          }
        }

        const jobDetail = detailData?.jobDetail || detailData?.jobInfo?.jobDetail || detailData?.jobInfo || {};
        const pos = jobDetail.detailedPosition || detailData?.position?.positionDetail || {};

        const jobName = pos.name || jobDetail.jobName || jobDetail.title || '智联职位';
        const companyName = jobDetail.companyName || jobDetail.company?.name || '';
        const salary = pos.salary60 || jobDetail.salary60 || jobDetail.salary || '';
        const workCity = pos.workCity || jobDetail.workCity || jobDetail.cityName || '';
        const jobExperience = pos.workingExp || jobDetail.workingExp || '';
        const education = pos.education || jobDetail.eduLevel || '';
        const desc = pos.description || pos.jobDesc || jobDetail.jobSummary || jobDetail.jobDuty || jobDetail.description || '';
        const publishTime = pos.positionPublishTime || pos.publishTime || jobDetail.publishTimeFormat || jobDetail.publishTime || '';

        await connectorOutput.emitZhaopinResult({
          title: jobName,
          company_name: companyName,
          salary,
          work_city: workCity,
          job_experience: jobExperience,
          education,
          desc,
          published_at: publishTime,
          content_url: detailUrl,
          content_id: target,
          source_keyword: target,
        });

        console.log(`[Zhaopin] Successfully stored job detail: "${jobName}" @ ${companyName}`);
      } catch (err: any) {
        console.error(`[Zhaopin] Failed to parse detail for ${detailUrl}: ${err.message}`);
      }
    }

    console.log('[Zhaopin] Detail parsing completed.');
  }
}
