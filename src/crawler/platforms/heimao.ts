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

function extractUrlsOrIds(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class HeimaoCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[Heimao] Connecting Heimao crawler to Electron built-in browser engine...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'heimao');

    if (activeConfig.COOKIES && this.browserContext) {
      console.log('[Heimao] Applying user-provided Cookie header to .sina.com.cn and .weibo.com...');
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.sina.com.cn');
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.weibo.com');
    }

    const crawlerType = activeConfig.CRAWLER_TYPE || 'search';
    if (crawlerType === 'detail') {
      await this.parseDetails();
    } else {
      await this.search();
    }
  }

  private async checkCaptchaOrLogin(): Promise<boolean> {
    if (!this.page) return false;
    const pageUrl = this.page.url();
    const pageTitle = await this.page.title().catch(() => '');
    const pageContent = await this.page.content().catch(() => '');

    return (
      pageTitle.includes('验证') ||
      pageTitle.includes('登录') ||
      pageUrl.includes('passport.sina') ||
      pageUrl.includes('passport.weibo') ||
      pageUrl.includes('login.sina') ||
      pageContent.includes('sec-captcha') ||
      pageContent.includes('slider') ||
      pageContent.includes('geetest') ||
      pageContent.includes('passport-login') ||
      pageContent.includes('请先登录')
    );
  }

  private async handleLoginOrVerificationIfNeeded(keyword: string): Promise<void> {
    if (!this.page) return;
    if (await this.checkCaptchaOrLogin()) {
      console.warn('[Heimao] Login or captcha verification detected in built-in browser window. Waiting up to 180s for user completion...');
      notifyManualVerificationRequired('heimao', `黑猫投诉搜索“${keyword}”需要新浪/微博登录或验证，请在内置浏览器窗口中完成操作。`);

      const startTime = Date.now();
      let clearPasses = 0;
      while (Date.now() - startTime < 180 * 1000) {
        await this.page.waitForTimeout(2000);
        const stillBlocked = await this.checkCaptchaOrLogin();
        if (stillBlocked) {
          clearPasses = 0;
        } else {
          clearPasses++;
          if (clearPasses >= 2) {
            console.log('[Heimao] Manual login/verification completed! Resuming crawler...');
            notifyManualVerificationSuccess('heimao');
            const safeKw = encodeURIComponent(keyword);
            const searchUrl = `https://tousu.sina.com.cn/index/search/?keywords=${safeKw}&t=1`;
            if (!this.page.url().includes('/index/search/')) {
              await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await this.humanDelay(this.page, 3);
            }
            return;
          }
        }
      }
      console.warn('[Heimao] Login/verification timeout. Will attempt public API fallback...');
    }
  }

  public async search(): Promise<void> {
    if (!this.page) throw new Error('[Heimao] Browser page is not initialized.');

    const keywords = extractUrlsOrIds(activeConfig.KEYWORDS || '');
    if (keywords.length === 0) {
      console.warn('[Heimao] No search keywords specified.');
      return;
    }

    const maxItems = Number(activeConfig.CRAWLER_MAX_NOTES_COUNT || 20);
    console.log(`[Heimao] Starting complaint search for ${keywords.length} keyword(s) via built-in browser, limit ${maxItems} per keyword...`);

    for (const keyword of keywords) {
      console.log(`[Heimao] Searching for keyword: "${keyword}"...`);
      const safeKw = encodeURIComponent(keyword);
      const searchUrl = `https://tousu.sina.com.cn/index/search/?keywords=${safeKw}&t=1`;
      console.log(`[Heimao] Built-in browser navigating to search page: ${searchUrl}`);

      const collectedItems: any[] = [];
      const seenIds = new Set<string>();

      try {
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await this.humanDelay(this.page, 3);

        await this.handleLoginOrVerificationIfNeeded(keyword);

        let scrollAttempts = 0;
        const maxScrolls = searchPageBudget(maxItems, 5, 8, 100);

        while (collectedItems.length < maxItems && scrollAttempts < maxScrolls) {
          let rawItems: any[] = [];
          try {
            rawItems = await this.page.evaluate(() => {
              const items: any[] = [];
              const seen = new Set<string>();

              // Strategy 1: Find all complaint links directly
              const linkEls = Array.from(document.querySelectorAll('a[href*="/complaint/view/"]'));
              linkEls.forEach((linkEl: any) => {
                const href = linkEl.getAttribute('href') || '';
                const match = href.match(/\/complaint\/view\/(\d+)/);
                const contentId = match ? match[1] : href;
                if (!contentId || seen.has(contentId)) return;
                seen.add(contentId);

                const card = linkEl.closest('li, div[class*="item"], div[class*="card"], div[class*="box"], article, tr') || linkEl.parentElement || linkEl;
                const titleEl = card.querySelector('.ts-title, .title, h3, h4, a.title, .tit, .ts-name, [class*="title"]') || linkEl;
                const merchantEl = card.querySelector('.ts-target, .merchant, .shop, .target, .ts-name, .s-target, [class*="target"], [class*="merchant"]');
                const statusEl = card.querySelector('.ts-status, .status, .state, .tag, .s-status, [class*="status"]');
                const timeEl = card.querySelector('.ts-time, .time, .date, .s-time, [class*="time"]');
                const descEl = card.querySelector('.ts-desc, .desc, p, .summary, [class*="desc"]');

                const title = (titleEl ? titleEl.innerText || titleEl.textContent || '' : linkEl.innerText || '').trim();

                items.push({
                  content_id: contentId,
                  title: title || '黑猫投诉事项',
                  description: (descEl ? descEl.innerText || descEl.textContent || '' : title).trim(),
                  creator_name: merchantEl ? (merchantEl.innerText || merchantEl.textContent || '').trim() : '黑猫涉诉商家',
                  status: statusEl ? (statusEl.innerText || statusEl.textContent || '').trim() : '',
                  content_url: href.startsWith('http') ? href : `https://tousu.sina.com.cn${href}`,
                  published_at: timeEl ? (timeEl.innerText || timeEl.textContent || '').trim() : '',
                });
              });

              // Strategy 2: Find generic list containers if Strategy 1 found few items
              if (items.length === 0) {
                const nodes = Array.from(document.querySelectorAll('.ts-list .ts-item, .m-list .item, .search-list li, .ts-item, li[data-id], .ts-m-list li, .m-product-list li, .ts-card, div[class*="item"], div[class*="complaint"], div[class*="card"]'));
                nodes.forEach((node: any) => {
                  const linkEl = node.querySelector('a[href*="/complaint/view/"]') || node.querySelector('a');
                  const titleEl = node.querySelector('.ts-title, .title, h3, h4, a.title, .tit, .ts-name, [class*="title"]') || linkEl;
                  const merchantEl = node.querySelector('.ts-target, .merchant, .shop, .target, .ts-name, .s-target');
                  const statusEl = node.querySelector('.ts-status, .status, .state, .tag, .s-status');
                  const timeEl = node.querySelector('.ts-time, .time, .date, .s-time');
                  const descEl = node.querySelector('.ts-desc, .desc, p, .summary');

                  const href = linkEl ? linkEl.getAttribute('href') || '' : '';
                  let contentId = '';
                  const match = href.match(/\/complaint\/view\/(\d+)/);
                  if (match) contentId = match[1];
                  else if (node.dataset && node.dataset.id) contentId = node.dataset.id;
                  else if (href) contentId = href;

                  if (!contentId || seen.has(contentId)) return;
                  seen.add(contentId);

                  const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
                  if (!title && !contentId) return;

                  items.push({
                    content_id: contentId || `heimao_${Math.random().toString(36).substring(2, 9)}`,
                    title: title || '黑猫投诉事项',
                    description: (descEl ? descEl.innerText || descEl.textContent || '' : title).trim(),
                    creator_name: merchantEl ? (merchantEl.innerText || merchantEl.textContent || '').trim() : '黑猫涉诉商家',
                    status: statusEl ? (statusEl.innerText || statusEl.textContent || '').trim() : '',
                    content_url: href.startsWith('http') ? href : href ? `https://tousu.sina.com.cn${href}` : '',
                    published_at: timeEl ? (timeEl.innerText || timeEl.textContent || '').trim() : '',
                  });
                });
              }

              return items;
            });
          } catch (evalErr: any) {
            console.warn(`[Heimao] DOM evaluation warning: ${evalErr.message}`);
          }

          for (const item of rawItems) {
            if (item.content_id && !seenIds.has(item.content_id)) {
              seenIds.add(item.content_id);
              collectedItems.push(item);
              if (collectedItems.length >= maxItems) break;
            }
          }

          if (collectedItems.length >= maxItems) break;

          scrollAttempts++;
          try {
            await this.page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
            });
          } catch {}
          await this.humanDelay(this.page, 2);
        }
      } catch (err: any) {
        console.warn(`[Heimao] Browser search scan interrupted for "${keyword}": ${err.message}`);
      }

      // Fallback Strategy: If browser page search extracted fewer items than maxItems, query public company main_search & feed APIs
      if (collectedItems.length < maxItems) {
        console.log(`[Heimao] Browser search collected ${collectedItems.length}/${maxItems} items for "${keyword}". Triggering public API fallback...`);
        let page = 1;
        while (collectedItems.length < maxItems && page <= 5) {
          try {
            const fetchSize = Math.min(maxItems - collectedItems.length, 50);
            const mainSearchUrl = `https://tousu.sina.com.cn/api/company/main_search?keyword=${safeKw}&page=${page}&page_size=${fetchSize}`;
            const res = await systemHttpClient.get(mainSearchUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://tousu.sina.com.cn/',
                'X-Requested-With': 'XMLHttpRequest',
              },
              timeout: 10000,
            });

            if (res.data?.result?.status?.code === 0 && res.data?.result?.data?.lists) {
              const companies = res.data.result.data.lists;
              if (!companies || companies.length === 0) break;
              for (const co of companies) {
                const coId = co.uid || co.id || `co_${Math.random().toString(36).substring(2, 9)}`;
                if (seenIds.has(coId)) continue;
                seenIds.add(coId);

                collectedItems.push({
                  content_id: coId,
                  title: `[涉诉商家] ${co.title || co.name || keyword}`,
                  description: `黑猫投诉涉诉商家: ${co.title || co.name} (UID: ${coId})。关键词: ${keyword}`,
                  creator_name: co.title || co.name || '黑猫涉诉商家',
                  status: '涉诉主体',
                  content_url: `https://tousu.sina.com.cn/company/view/?couid=${coId}`,
                  published_at: '',
                });
                if (collectedItems.length >= maxItems) break;
              }
              page++;
            } else {
              break;
            }
          } catch (apiErr: any) {
            console.warn(`[Heimao] API fallback warning for "${keyword}": ${apiErr.message}`);
            break;
          }
        }

        let feedPage = 1;
        while (collectedItems.length < maxItems && feedPage <= 10) {
          try {
            const fetchSize = Math.min(maxItems - collectedItems.length, 50);
            const feedUrl = `https://tousu.sina.com.cn/api/index/feed?type=1&page=${feedPage}&page_size=${fetchSize}`;
            const resFeed = await systemHttpClient.get(feedUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://tousu.sina.com.cn/',
              },
              timeout: 10000,
            });

            if (resFeed.data?.result?.status?.code === 0 && resFeed.data?.result?.data?.lists) {
              const feedLists = resFeed.data.result.data.lists;
              if (!feedLists || feedLists.length === 0) break;
              for (const feedItem of feedLists) {
                const main = feedItem.main || feedItem;
                const cId = main.sn || main.id || `feed_${Math.random().toString(36).substring(2, 9)}`;
                if (seenIds.has(cId)) continue;
                seenIds.add(cId);

                collectedItems.push({
                  content_id: cId,
                  title: main.title || '黑猫投诉事项',
                  description: main.summary || main.title || '',
                  creator_name: main.cou_name || '黑猫涉诉商家',
                  status: main.status_name || '',
                  content_url: `https://tousu.sina.com.cn/complaint/view/${cId}`,
                  published_at: main.datetime || '',
                });
                if (collectedItems.length >= maxItems) break;
              }
              feedPage++;
            } else {
              break;
            }
          } catch (feedErr: any) {
            console.warn(`[Heimao] Feed fallback warning: ${feedErr.message}`);
            break;
          }
        }
      }

      // Emit all collected items through the connector output boundary.
      let totalCollected = 0;
      for (const item of collectedItems) {
        await connectorOutput.emitHeimaoResult({
          content_id: item.content_id,
          title: item.title,
          desc: `${item.creator_name ? `[投诉商家: ${item.creator_name}] ` : ''}${item.status ? `[状态: ${item.status}] ` : ''}${item.description}`,
          creator_name: item.creator_name || '黑猫涉诉商家',
          merchant_name: item.creator_name || '黑猫涉诉商家',
          status: item.status || '',
          rank: totalCollected + 1,
          content_url: item.content_url || `https://tousu.sina.com.cn/index/search/?keywords=${safeKw}`,
          source_keyword: keyword,
          published_at: item.published_at || '',
          publish_time: Date.now(),
        });
        totalCollected++;
      }

      reportKeywordSearchCompletion(
        '黑猫投诉',
        keyword,
        totalCollected,
        maxItems,
        totalCollected < maxItems ? '平台可用公开结果已提取完毕或需要验证登录' : undefined,
      );

      console.log(`[Heimao] Completed search for "${keyword}", stored ${totalCollected} complaint notes.`);
    }
  }

  public async parseDetails(): Promise<void> {
    if (!this.page) throw new Error('[Heimao] Browser page is not initialized.');

    const targets = extractUrlsOrIds(activeConfig.SPECIFIED_IDS || '');
    if (targets.length === 0) {
      console.warn('[Heimao] No specified complaint IDs or URLs provided for detail parsing.');
      return;
    }

    console.log(`[Heimao] Parsing detail for ${targets.length} complaint target(s)...`);

    for (const target of targets) {
      const url = target.startsWith('http')
        ? target
        : `https://tousu.sina.com.cn/complaint/view/${target}`;

      console.log(`[Heimao] Built-in browser navigating to complaint detail: ${url}`);
      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.humanDelay(this.page, 3);

        await this.handleLoginOrVerificationIfNeeded(target);

        const detail = await this.page.evaluate(() => {
          const titleEl = document.querySelector('.ts-title, h1, .title');
          const descEl = document.querySelector('.ts-content, .ts-desc, .main-content, .detail-content, .ts-detail');
          const merchantEl = document.querySelector('.ts-target, .merchant-name, .shop-name, .ts-name');
          const statusEl = document.querySelector('.ts-status, .status-name, .state');
          const timeEl = document.querySelector('.ts-time, .pub-time, .date');

          return {
            title: titleEl ? (titleEl as HTMLElement).innerText.trim() : '黑猫投诉单',
            desc: descEl ? (descEl as HTMLElement).innerText.trim() : '',
            merchant: merchantEl ? (merchantEl as HTMLElement).innerText.trim() : '涉诉商家',
            status: statusEl ? ((statusEl as HTMLElement).innerText || statusEl.textContent || '').trim() : '',
            time: timeEl ? (timeEl as HTMLElement).innerText.trim() : '',
          };
        });

        const idMatch = url.match(/\/complaint\/view\/(\d+)/);
        const complaintId = idMatch ? idMatch[1] : target;

        await connectorOutput.emitHeimaoResult({
          content_id: complaintId,
          title: detail.title,
          desc: `[被投诉方: ${detail.merchant}] ${detail.status ? `[状态: ${detail.status}] ` : ''}${detail.desc}`,
          creator_name: detail.merchant || '黑猫涉诉商家',
          merchant_name: detail.merchant || '黑猫涉诉商家',
          status: detail.status || '',
          content_url: url,
          source_keyword: activeConfig.KEYWORDS || '',
          published_at: detail.time || '',
          publish_time: Date.now(),
        });

        console.log(`[Heimao] Parsed detail successfully for complaint ID: ${complaintId}`);
      } catch (err: any) {
        console.error(`[Heimao] Error parsing detail for "${target}": ${err.message}`);
      }
    }
  }
}
