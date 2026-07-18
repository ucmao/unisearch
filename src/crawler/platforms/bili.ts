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
      const path = require('path');
      const userDataDir = path.join(
        process.cwd(),
        'browser_data',
        activeConfig.USER_DATA_DIR.replace('%s', activeConfig.PLATFORM)
      );
      this.browserContext = await p.chromium.launchPersistentContext(userDataDir, {
        headless: activeConfig.HEADLESS,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });
      this.page = this.browserContext.pages().length > 0 ? this.browserContext.pages()[0] : await this.browserContext.newPage();
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
      if (visible) return true;
    } catch {}
    try {
      const isLoginBtn = await this.page!.isVisible('div.header-login-entry', { timeout: 1000 });
      if (isLoginBtn) return false;
    } catch {}
    try {
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some((c) => c.name === 'SESSDATA' || c.name === 'DedeUserID');
        if (hasSession) {
          const loginBtnExists = await this.page!.isVisible('div.header-login-entry', { timeout: 1000 }).catch(() => false);
          if (loginBtnExists) return false;
          console.log('[BILI] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[BILI] Error checking cookies:', err.message);
    }
    return false;
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

          let detail: any = {};
          try {
            const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${v.video_id}`;
            const res = await this.page!.evaluate(async (url) => {
              const resp = await fetch(url);
              return resp.json();
            }, apiUrl);
            if (res && res.code === 0 && res.data) {
              detail = res.data;
            }
          } catch (e: any) {
            console.error(`[BILI] Failed to fetch details for ${v.video_id}:`, e.message);
          }

          const videoDetail = {
            video_id: v.video_id,
            video_url: v.video_url,
            creator_hash: detail.owner?.mid ? String(detail.owner.mid) : v.creator_hash,
            nickname: detail.owner?.name || v.nickname,
            liked_count: Number(detail.stat?.like || 0),
            video_type: 'video',
            title: detail.title || v.title,
            desc: detail.desc || v.title,
            create_time: detail.pubdate || Math.floor(Date.now() / 1000),
            disliked_count: String(detail.stat?.dislike || 0),
            video_play_count: String(detail.stat?.view || v.video_play_count),
            video_favorite_count: String(detail.stat?.favorite || 0),
            video_share_count: String(detail.stat?.share || 0),
            video_coin_count: String(detail.stat?.coin || 0),
            video_danmaku: String(detail.stat?.danmaku || 0),
            video_comment: String(detail.stat?.reply || 0),
            video_cover_url: detail.pic || '',
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
