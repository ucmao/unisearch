import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { CDPBrowserManager } from '../../tools/browser';
import { dbStore } from '../store';
import fs from 'fs';

export class BilibiliCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  public cdpManager: CDPBrowserManager | null = null;

  public async start(): Promise<void> {
    console.log('[BILI] Starting Bilibili crawler...');
    
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

    await this.page.goto('https://www.bilibili.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    }

    console.log('[BILI] Bilibili crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[BILI] Checking login state...');
    let isLoggedIn = await this.checkLoginState();
    
    if (!isLoggedIn && activeConfig.LOGIN_TYPE === 'qrcode') {
      console.log('[BILI] User is not logged in. Triggering login dialog...');
      try {
        await this.page!.click('div.header-login-entry, .header-avatar-wrap', { timeout: 3000 });
      } catch {
        // Ignored
      }
      
      console.log('[BILI] Waiting for user to scan Bilibili QR code...');
      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[BILI] Login successful!');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async checkLoginState(): Promise<boolean> {
    try {
      const visible = await this.page!.isVisible('.header-avatar-wrap, a.header-entry-avatar', { timeout: 1000 });
      return visible;
    } catch {
      return false;
    }
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[BILI] Searching keyword: ${keyword}`);
      try {
        const searchUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`;
        await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await this.page!.waitForTimeout(3000);

        // Scroll to load cards
        await this.page!.evaluate(() => window.scrollBy(0, 800));
        await this.page!.waitForTimeout(1000);

        // Fetch cards from DOM
        const videos = await this.page!.evaluate(() => {
          const items: any[] = [];
          const cards = document.querySelectorAll('.video-list-item, .bili-video-card');
          
          cards.forEach((card) => {
            const titleEl = card.querySelector('h3.title, .bili-video-card__info--tit');
            const linkEl = card.querySelector('a[href*="video/BV"]');
            const authorEl = card.querySelector('.up-name, .bili-video-card__info--author');
            const watchEl = card.querySelector('.watch-num, .bili-video-card__info--play');
            
            if (titleEl && linkEl) {
              const href = linkEl.getAttribute('href') || '';
              const videoId = href.match(/video\/(BV[a-zA-Z0-9]+)/)?.[1] || '';
              
              items.push({
                video_id: videoId,
                title: titleEl.textContent?.trim() || '',
                video_url: href.startsWith('http') ? href : 'https:' + href,
                nickname: authorEl?.textContent?.trim() || '',
                creator_hash: authorEl?.getAttribute('href')?.split('/').pop() || '',
                video_play_count: watchEl?.textContent?.trim() || '0',
              });
            }
          });
          return items;
        });

        console.log(`[BILI] Found ${videos.length} videos. Ingesting...`);
        let count = 0;
        
        for (const v of videos) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!v.video_id) continue;

          const videoDetail = {
            video_id: v.video_id,
            video_url: v.video_url,
            creator_hash: v.creator_hash,
            nickname: v.nickname,
            liked_count: 0,
            video_type: 'video',
            title: v.title,
            desc: v.title,
            create_time: Math.floor(Date.now() / 1000),
            video_play_count: v.video_play_count,
            source_keyword: keyword,
          };

          await dbStore.storeBilibiliVideo(videoDetail);
          count++;
          
          await this.page!.waitForTimeout(activeConfig.CRAWLER_MAX_SLEEP_SEC * 1000);
        }
      } catch (err: any) {
        console.error(`[BILI] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }
}
