import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { CDPBrowserManager } from '../../tools/browser';
import { dbStore } from '../store';
import fs from 'fs';

export class KuaishouCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  public cdpManager: CDPBrowserManager | null = null;

  public async start(): Promise<void> {
    console.log('[KS] Starting Kuaishou crawler...');
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

    await this.page.goto('https://www.kuaishou.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    }

    console.log('[KS] Kuaishou crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[KS] Checking login state...');
    let isLoggedIn = await this.checkLoginState();
    
    if (!isLoggedIn && activeConfig.LOGIN_TYPE === 'qrcode') {
      console.log('[KS] User is not logged in. Waiting for manual login...');
      try {
        await this.page!.click('.login-btn, .header-login', { timeout: 3000 });
      } catch {}

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[KS] Login successful!');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async checkLoginState(): Promise<boolean> {
    try {
      const visible = await this.page!.isVisible('.header-user-avatar, .avatar-wrap', { timeout: 1000 });
      return visible;
    } catch {
      return false;
    }
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[KS] Searching keyword: ${keyword}`);
      try {
        const searchUrl = `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(keyword)}`;
        await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await this.page!.waitForTimeout(3000);

        // Scroll
        await this.page!.evaluate(() => window.scrollBy(0, 1000));
        await this.page!.waitForTimeout(1000);

        const videos = await this.page!.evaluate(() => {
          const items: any[] = [];
          const cards = document.querySelectorAll('.video-card, .video-item');
          
          cards.forEach((card) => {
            const titleEl = card.querySelector('.title, .video-title');
            const linkEl = card.querySelector('a[href*="/short-video/"], a[href*="/video/"]');
            const authorEl = card.querySelector('.user-name, .author-name');
            
            if (titleEl && linkEl) {
              const href = linkEl.getAttribute('href') || '';
              const videoId = href.split('/').pop()?.split('?')[0] || '';
              
              items.push({
                video_id: videoId,
                title: titleEl.textContent?.trim() || '',
                video_url: href.startsWith('http') ? href : 'https://www.kuaishou.com' + href,
                nickname: authorEl?.textContent?.trim() || '',
              });
            }
          });
          return items;
        });

        console.log(`[KS] Found ${videos.length} videos. Ingesting...`);
        let count = 0;
        
        for (const v of videos) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!v.video_id) continue;

          const videoDetail = {
            video_id: v.video_id,
            video_url: v.video_url,
            nickname: v.nickname,
            creator_hash: '',
            title: v.title,
            desc: v.title,
            create_time: Math.floor(Date.now() / 1000),
            source_keyword: keyword,
          };

          await dbStore.storeKuaishouVideo(videoDetail);
          count++;
          
          await this.page!.waitForTimeout(activeConfig.CRAWLER_MAX_SLEEP_SEC * 1000);
        }
      } catch (err: any) {
        console.error(`[KS] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }
}
