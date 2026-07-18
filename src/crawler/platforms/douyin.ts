import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { CDPBrowserManager } from '../../tools/browser';
import { dbStore } from '../store';
import fs from 'fs';

export class DouyinCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  public cdpManager: CDPBrowserManager | null = null;

  public async start(): Promise<void> {
    console.log('[DY] Starting Douyin crawler...');
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

    await this.page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    }

    console.log('[DY] Douyin crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[DY] Checking login state...');
    let isLoggedIn = await this.checkLoginState();
    
    if (!isLoggedIn && activeConfig.LOGIN_TYPE === 'qrcode') {
      console.log('[DY] User is not logged in. Waiting for manual login...');
      // Click login button if exists
      try {
        await this.page!.click('.login-guide, .header-login-btn', { timeout: 3000 });
      } catch {}

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[DY] Login successful!');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async checkLoginState(): Promise<boolean> {
    try {
      const visible = await this.page!.isVisible('.header-user-avatar, .user-avatar', { timeout: 1000 });
      return visible;
    } catch {
      return false;
    }
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[DY] Searching keyword: ${keyword}`);
      try {
        const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`;
        await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await this.page!.waitForTimeout(3000);

        // Scroll to load cards
        await this.page!.evaluate(() => window.scrollBy(0, 1000));
        await this.page!.waitForTimeout(1000);

        const videos = await this.page!.evaluate(() => {
          const items: any[] = [];
          const cards = document.querySelectorAll('li[data-e2e="scroll-item"]');
          
          cards.forEach((card) => {
            const titleEl = card.querySelector('.search-result-card-title, .title-text, h3');
            const linkEl = card.querySelector('a[href*="/video/"]');
            const authorEl = card.querySelector('.author-name, .user-name');
            
            if (titleEl && linkEl) {
              const href = linkEl.getAttribute('href') || '';
              const awemeId = href.match(/video\/([0-9]+)/)?.[1] || '';
              
              items.push({
                aweme_id: awemeId,
                title: titleEl.textContent?.trim() || '',
                aweme_url: href.startsWith('http') ? href : 'https://www.douyin.com' + href,
                nickname: authorEl?.textContent?.trim() || '',
              });
            }
          });
          return items;
        });

        console.log(`[DY] Found ${videos.length} videos. Ingesting...`);
        let count = 0;
        
        for (const v of videos) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!v.aweme_id) continue;

          const awemeDetail = {
            aweme_id: v.aweme_id,
            aweme_url: v.aweme_url,
            nickname: v.nickname,
            creator_hash: '',
            title: v.title,
            desc: v.title,
            create_time: Math.floor(Date.now() / 1000),
            source_keyword: keyword,
          };

          await dbStore.storeDouyinAweme(awemeDetail);
          count++;
          
          await this.page!.waitForTimeout(activeConfig.CRAWLER_MAX_SLEEP_SEC * 1000);
        }
      } catch (err: any) {
        console.error(`[DY] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }
}
