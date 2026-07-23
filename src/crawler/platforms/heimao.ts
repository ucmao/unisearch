import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyManualVerificationRequired,
  notifyManualVerificationSuccess,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { dbStore } from '../store';

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
      console.log('[Heimao] Applying user-provided Cookie header...');
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.sina.com.cn');
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
      notifyManualVerificationRequired('heimao', `黑猫投诉搜索“${keyword}”触发登录或安全验证，请在内置浏览器窗口中完成操作。`);

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
      throw new Error('等待黑猫投诉登录或验证超时，请在内置浏览器完成验证后重试');
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

      try {
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.humanDelay(this.page, 3);

        await this.handleLoginOrVerificationIfNeeded(keyword);

        let totalCollected = 0;
        let scrollAttempts = 0;
        const maxScrolls = Math.min(Math.ceil(maxItems / 5) + 3, 20);
        const collectedItems: any[] = [];
        const seenIds = new Set<string>();

        while (collectedItems.length < maxItems && scrollAttempts < maxScrolls) {
          let rawItems: any[] = [];
          try {
            rawItems = await this.page.evaluate(() => {
              const items: any[] = [];
              const nodes = Array.from(document.querySelectorAll('.ts-list .ts-item, .m-list .item, .search-list li, .ts-item, li[data-id], .ts-m-list li, .m-product-list li, .ts-card, div[class*="item"], div[class*="complaint"]'));
              
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
                if (match) {
                  contentId = match[1];
                } else if (node.dataset && node.dataset.id) {
                  contentId = node.dataset.id;
                } else if (href) {
                  contentId = href;
                }

                const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
                if (!title && !contentId) return;

                items.push({
                  content_id: contentId || `heimao_${Math.random().toString(36).substring(2, 9)}`,
                  title: title || '黑猫投诉事项',
                  description: (descEl ? descEl.innerText : title).trim(),
                  creator_name: merchantEl ? (merchantEl.innerText || merchantEl.textContent || '').trim() : '未知商家',
                  status: statusEl ? (statusEl.innerText || statusEl.textContent || '').trim() : '',
                  content_url: href.startsWith('http') ? href : href ? `https://tousu.sina.com.cn${href}` : '',
                  published_at: timeEl ? (timeEl.innerText || timeEl.textContent || '').trim() : '',
                });
              });

              return items;
            });
          } catch (evalErr: any) {
            console.warn(`[Heimao] DOM evaluation interrupted: ${evalErr.message}`);
            await this.handleLoginOrVerificationIfNeeded(keyword);
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.humanDelay(this.page, 2);
          }

          for (const item of rawItems) {
            if (item.content_id && !seenIds.has(item.content_id)) {
              seenIds.add(item.content_id);
              collectedItems.push(item);
              if (collectedItems.length >= maxItems) break;
            }
          }

          console.log(`[Heimao] Collected ${collectedItems.length}/${maxItems} complaint items (scroll #${scrollAttempts + 1})`);
          if (collectedItems.length >= maxItems) break;

          // Scroll down to load more items
          scrollAttempts++;
          try {
            await this.page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
            });
          } catch (scrollErr: any) {
            console.warn(`[Heimao] Scroll interrupted: ${scrollErr.message}`);
            await this.handleLoginOrVerificationIfNeeded(keyword);
          }
          await this.humanDelay(this.page, 2);
        }

        // Save items to dbStore
        for (const item of collectedItems) {
          await dbStore.storeHeimaoResult({
            content_id: item.content_id,
            title: item.title,
            desc: `${item.creator_name ? `[投诉商家: ${item.creator_name}] ` : ''}${item.status ? `[状态: ${item.status}] ` : ''}${item.description}`,
            creator_name: item.creator_name || '黑猫涉诉商家',
            content_url: item.content_url || `https://tousu.sina.com.cn/index/search/?keywords=${safeKw}`,
            source_keyword: keyword,
            published_at: item.published_at || '',
            publish_time: Date.now(),
          });
          totalCollected++;
        }

        console.log(`[Heimao] Completed search for "${keyword}", stored ${totalCollected} complaint notes.`);
      } catch (err: any) {
        console.error(`[Heimao] Error searching keyword "${keyword}": ${err.message}`);
      }
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
          const descEl = document.querySelector('.ts-content, .ts-desc, .main-content, .detail-content');
          const merchantEl = document.querySelector('.ts-target, .merchant-name, .shop-name');
          const statusEl = document.querySelector('.ts-status, .status-name, .state');
          const timeEl = document.querySelector('.ts-time, .pub-time, .date');

          return {
            title: titleEl ? (titleEl as HTMLElement).innerText.trim() : '黑猫投诉单',
            desc: descEl ? (descEl as HTMLElement).innerText.trim() : '',
            merchant: merchantEl ? (merchantEl as HTMLElement).innerText.trim() : '涉诉商家',
            status: statusEl ? (statusEl.innerText || statusEl.textContent || '').trim() : '',
            time: timeEl ? (timeEl as HTMLElement).innerText.trim() : '',
          };
        });

        const idMatch = url.match(/\/complaint\/view\/(\d+)/);
        const complaintId = idMatch ? idMatch[1] : target;

        await dbStore.storeHeimaoResult({
          content_id: complaintId,
          title: detail.title,
          desc: `[被投诉方: ${detail.merchant}] ${detail.status ? `[状态: ${detail.status}] ` : ''}${detail.desc}`,
          creator_name: detail.merchant || '黑猫涉诉商家',
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
