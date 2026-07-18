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
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some((c) => c.name === 'passToken');
        if (hasSession) {
          console.log('[KS] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[KS] Error checking cookies:', err.message);
    }
    try {
      const selectors = [
        '.header-user-avatar',
        '.avatar-wrap',
        '.user.item',
        '.text-name',
        'a[href*="/profile"]'
      ];
      for (const selector of selectors) {
        const visible = await this.page!.isVisible(selector, { timeout: 1000 }).catch(() => false);
        if (visible) {
          console.log(`[KS] Login state confirmed via selector: ${selector}`);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[KS] Searching keyword: ${keyword}`);
      try {
        const videos: any[] = [];
        const seenIds = new Set<string>();

        const addFeeds = (feeds: any[]) => {
          if (!feeds) return;
          for (const feed of feeds) {
            const photo = feed.photo;
            const author = feed.author;
            if (photo && photo.id && !seenIds.has(photo.id)) {
              seenIds.add(photo.id);
              
              // Extract first cover URL from coverUrls if coverUrl is empty
              let cover = photo.coverUrl || '';
              if (!cover && photo.coverUrls && photo.coverUrls[0]) {
                cover = photo.coverUrls[0].url || '';
              }

              videos.push({
                video_id: photo.id,
                title: photo.caption || photo.originCaption || '',
                desc: photo.caption || photo.originCaption || '',
                video_url: `https://www.kuaishou.com/short-video/${photo.id}`,
                video_cover_url: cover,
                liked_count: String(photo.realLikeCount || photo.likeCount || '0'),
                viewd_count: String(photo.viewCount || '0'),
                comment_count: String(photo.commentCount || '0'),
                nickname: author ? author.name : '',
                creator_hash: author ? author.id : '',
                create_time: photo.timestamp ? Math.floor(photo.timestamp / 1000) : Math.floor(Date.now() / 1000),
              });
            }
          }
        };

        // 1. Set up network interception for subsequent scrolled pages
        const responseHandler = async (response: any) => {
          if (response.url().includes('/graphql')) {
            try {
              const req = response.request();
              const postData = req.postData();
              if (postData && postData.includes('visionSearchPhoto')) {
                const text = await response.text();
                const json = JSON.parse(text);
                const feeds = json.data?.visionSearchPhoto?.feeds || [];
                console.log(`[KS] Intercepted GraphQL page: ${feeds.length} feeds`);
                addFeeds(feeds);
              }
            } catch (err: any) {
              // Ignore parsing errors (e.g. aborted requests)
            }
          }
        };

        this.page!.on('response', responseHandler);

        // 2. Navigate to search page
        const searchUrl = `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(keyword)}`;
        await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await this.page!.waitForTimeout(3000);

        // 3. Extract initial SSR page feeds from window.INIT_STATE
        const initialFeeds = await this.page!.evaluate(() => {
          if (!(window as any).INIT_STATE) return [];
          const decoded: any = {};
          // Decode Caesar cipher key names (shift -1 charcode)
          for (const [k, v] of Object.entries((window as any).INIT_STATE)) {
            const dk = k.split('').map(c => String.fromCharCode(c.charCodeAt(0) - 1)).join('');
            decoded[dk] = v;
          }
          const searchFeedKey = Object.keys(decoded).find(k => k.includes('search/feed'));
          return decoded[searchFeedKey || '']?.feeds || [];
        });
        console.log(`[KS] Extracted initial SSR page: ${initialFeeds.length} feeds`);
        addFeeds(initialFeeds);

        // 4. Scroll to trigger client-side GraphQL requests to fetch more pages if needed
        let scrollAttempts = 0;
        const maxScrolls = Math.max(1, Math.ceil(activeConfig.CRAWLER_MAX_NOTES_COUNT / 20) - 1);
        while (videos.length < activeConfig.CRAWLER_MAX_NOTES_COUNT && scrollAttempts < maxScrolls) {
          console.log(`[KS] Scrolling to load next page (attempt ${scrollAttempts + 1}/${maxScrolls})...`);
          await this.page!.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
          await this.page!.waitForTimeout(3000);
          scrollAttempts++;
        }

        // Clean up response listener
        this.page!.off('response', responseHandler);

        console.log(`[KS] Found ${videos.length} videos. Ingesting...`);
        let count = 0;
        
        for (const v of videos) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!v.video_id) continue;

          const videoDetail = {
            video_id: v.video_id,
            video_url: v.video_url,
            nickname: v.nickname,
            creator_hash: v.creator_hash,
            title: v.title,
            desc: v.desc,
            create_time: v.create_time,
            liked_count: v.liked_count,
            viewd_count: v.viewd_count,
            comment_count: v.comment_count,
            video_cover_url: v.video_cover_url,
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
