import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { CDPBrowserManager } from '../../tools/browser';
import { dbStore } from '../store';
import fs from 'fs';

export class ZhihuCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  public cdpManager: CDPBrowserManager | null = null;

  public async start(): Promise<void> {
    console.log('[ZHIHU] Starting Zhihu crawler...');
    const p = require('playwright');
    
    if (activeConfig.ENABLE_CDP_MODE) {
      this.cdpManager = new CDPBrowserManager();
      this.browserContext = await this.cdpManager.launchAndConnect(p);
      this.page = await this.cdpManager.newPage();
    } else {
      const browser = await p.chromium.launch({ headless: activeConfig.HEADLESS });
      this.browserContext = await browser.newContext();
      this.page = await this.browserContext.newPage();
    }

    const stealthPath = 'libs/stealth.min.js';
    if (fs.existsSync(stealthPath)) {
      await this.browserContext.addInitScript({ path: stealthPath });
    }

    await this.page.goto('https://www.zhihu.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    }

    console.log('[ZHIHU] Zhihu crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[ZHIHU] Checking login state...');
    let isLoggedIn = await this.checkLoginState();
    
    if (!isLoggedIn && activeConfig.LOGIN_TYPE === 'qrcode') {
      console.log('[ZHIHU] User is not logged in. Waiting for manual login...');
      try {
        await this.page!.click('.AppHeader-login, .SignFlow-tabs', { timeout: 3000 });
      } catch {}

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[ZHIHU] Login successful!');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async checkLoginState(): Promise<boolean> {
    try {
      const visible = await this.page!.isVisible('.AppHeader-profile, .AppHeader-user', { timeout: 1000 });
      return visible;
    } catch {
      return false;
    }
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[ZHIHU] Searching keyword: ${keyword}`);
      try {
        const searchUrl = `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(keyword)}`;
        await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await this.page!.waitForTimeout(3000);

        // Scroll
        await this.page!.evaluate(() => window.scrollBy(0, 1000));
        await this.page!.waitForTimeout(1000);

        const items = await this.page!.evaluate(() => {
          const results: any[] = [];
          const cards = document.querySelectorAll('.Search-card, .ContentItem');
          
          cards.forEach((card) => {
            const titleEl = card.querySelector('.ContentItem-title a, h2 a');
            const bodyEl = card.querySelector('.RichText, .ContentItem-richText');
            const authorEl = card.querySelector('.AuthorInfo-name, .UserLink-link');
            
            if (titleEl) {
              const href = titleEl.getAttribute('href') || '';
              const contentId = href.split('/').pop() || '';
              const type = href.includes('answer') ? 'answer' : href.includes('article') ? 'article' : 'content';
              
              results.push({
                content_id: contentId,
                content_type: type,
                title: titleEl.textContent?.trim() || '',
                content_url: href.startsWith('http') ? href : 'https://www.zhihu.com' + href,
                desc: bodyEl?.textContent?.trim() || '',
                user_nickname: authorEl?.textContent?.trim() || '',
                creator_hash: authorEl?.getAttribute('href')?.split('/').pop() || '',
              });
            }
          });
          return results;
        });

        console.log(`[ZHIHU] Found ${items.length} answers/articles. Ingesting...`);
        let count = 0;
        
        for (const it of items) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!it.content_id) continue;

          const contentDetail = {
            content_id: it.content_id,
            content_type: it.content_type,
            content_text: it.desc,
            content_url: it.content_url,
            title: it.title,
            desc: it.desc,
            voteup_count: 0,
            comment_count: 0,
            user_nickname: it.user_nickname,
            creator_hash: it.creator_hash,
            source_keyword: keyword,
          };

          await dbStore.storeZhihuContent(contentDetail);
          count++;
          
          await this.page!.waitForTimeout(activeConfig.CRAWLER_MAX_SLEEP_SEC * 1000);
        }
      } catch (err: any) {
        console.error(`[ZHIHU] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }
}
