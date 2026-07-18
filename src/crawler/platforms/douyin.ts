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

    await this.page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    }

    console.log('[DY] Douyin crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[DY] Checking login state...');

    if (activeConfig.LOGIN_TYPE === 'cookie' && activeConfig.COOKIES) {
      console.log('[DY] Logging in via cookies...');
      const cookieDict = this.parseCookies(activeConfig.COOKIES);
      const cookiesToSet = Object.entries(cookieDict).map(([name, value]) => ({
        name,
        value,
        domain: '.douyin.com',
        path: '/',
      }));
      await this.browserContext!.addCookies(cookiesToSet);
      await this.page!.reload({ waitUntil: 'domcontentloaded' });
    }

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
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some(
          (c) => c.name === 'sessionid' || c.name === 'sid_guard' || c.name === 'passport_auth_token'
        );
        if (hasSession) {
          console.log('[DY] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[DY] Error checking cookies:', err.message);
    }

    try {
      const selectors = [
        '[data-e2e="user-avatar"]',
        '.header-user-avatar',
        '.user-avatar',
        '.dy-avatar',
        'a[href*="/user/self"]',
        '.tab-user_self',
        'div[class*="avatar"] img',
      ];
      for (const selector of selectors) {
        const visible = await this.page!.isVisible(selector, { timeout: 1000 }).catch(() => false);
        if (visible) {
          console.log(`[DY] Login state confirmed via selector: ${selector}`);
          return true;
        }
      }
    } catch {}

    return false;
  }

  private parseCookies(cookieStr: string): Record<string, string> {
    const dict: Record<string, string> = {};
    cookieStr.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        dict[parts[0].trim()] = parts.slice(1).join('=').trim();
      }
    });
    return dict;
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[DY] Searching keyword: ${keyword}`);
      try {
        // Ensure we are on the Douyin domain so fetch inherits cookies
        if (!this.page!.url().includes('douyin.com')) {
          await this.page!.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded' });
          await this.page!.waitForTimeout(3000);
        }

        const countToFetch = Math.max(activeConfig.CRAWLER_MAX_NOTES_COUNT, 15);
        const queryParams: Record<string, string> = {
          device_platform: 'webapp',
          aid: '6383',
          channel: 'channel_pc_web',
          pc_client_type: '1',
          version_code: '190600',
          version_name: '19.6.0',
          cookie_enabled: 'true',
          screen_width: '1440',
          screen_height: '900',
          browser_language: 'zh-CN',
          browser_platform: 'MacIntel',
          browser_name: 'Chrome',
          browser_version: '126.0.0.0',
          browser_online: 'true',
          engine_name: 'Blink',
          engine_version: '126.0.0.0',
          os_name: 'Mac OS',
          os_version: '10.15.7',
          platform: 'PC',
          webid: '7378810571505847586',
          
          search_channel: 'aweme_general',
          enable_history: '1',
          keyword: keyword,
          search_source: 'tab_search',
          query_correct_type: '1',
          is_filter_search: '0',
          from_group_id: '7378810571505847586',
          offset: '0',
          count: String(countToFetch),
          need_filter_settings: '1',
          list_type: 'multi',
        };

        const queryString = Object.entries(queryParams)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('&');

        const apiUrl = `https://www.douyin.com/aweme/v1/web/general/search/single/?${queryString}`;

        const postsRes = await this.page!.evaluate(async ({ url, kw }) => {
          const resp = await fetch(url, {
            headers: {
              'accept': 'application/json, text/plain, */*',
              'referer': `https://www.douyin.com/search/${encodeURIComponent(kw)}?type=general`,
            }
          });
          return resp.json();
        }, { url: apiUrl, kw: keyword });

        const videos: any[] = [];
        if (postsRes && postsRes.data) {
          for (const item of postsRes.data) {
            const awemeInfo = item.aweme_info || item.aweme_mix_info?.mix_items?.[0];
            if (awemeInfo && awemeInfo.aweme_id) {
              const videoItem = awemeInfo.video || {};
              const rawCoverList = (videoItem.raw_cover || videoItem.origin_cover || {}).url_list || [];
              const coverUrl = rawCoverList.length > 1 ? rawCoverList[1] : (rawCoverList.length > 0 ? rawCoverList[0] : '');

              const actualUrlList = videoItem.play_addr_h264?.url_list || videoItem.play_addr_256?.url_list || videoItem.play_addr?.url_list || [];
              const videoDownloadUrl = actualUrlList.length > 0 ? actualUrlList[actualUrlList.length - 1] : '';

              const musicItem = awemeInfo.music || {};
              const musicDownloadUrl = musicItem.play_url?.uri || '';

              const images = awemeInfo.images || [];
              const noteDownloadUrl = images.map((img: any) => img.url_list?.[img.url_list.length - 1] || '').filter(Boolean).join(',');

              videos.push({
                aweme_id: awemeInfo.aweme_id,
                aweme_type: String(awemeInfo.aweme_type || 'content'),
                title: awemeInfo.desc || '',
                desc: awemeInfo.desc || '',
                create_time: awemeInfo.create_time || 0,
                creator_hash: awemeInfo.author?.uid || '',
                nickname: awemeInfo.author?.nickname || '',
                liked_count: Number(awemeInfo.statistics?.digg_count || 0),
                collected_count: Number(awemeInfo.statistics?.collect_count || 0),
                comment_count: Number(awemeInfo.statistics?.comment_count || 0),
                share_count: Number(awemeInfo.statistics?.share_count || 0),
                aweme_url: `https://www.douyin.com/video/${awemeInfo.aweme_id}`,
                cover_url: coverUrl,
                video_download_url: videoDownloadUrl,
                music_download_url: musicDownloadUrl,
                note_download_url: noteDownloadUrl,
              });
            }
          }
        }

        console.log(`[DY] Found ${videos.length} videos. Ingesting...`);
        let count = 0;
        
        for (const v of videos) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!v.aweme_id) continue;

          const awemeDetail = {
            aweme_id: v.aweme_id,
            aweme_type: v.aweme_type,
            title: v.title,
            desc: v.desc,
            create_time: v.create_time,
            creator_hash: v.creator_hash,
            nickname: v.nickname,
            liked_count: v.liked_count,
            collected_count: v.collected_count,
            comment_count: v.comment_count,
            share_count: v.share_count,
            aweme_url: v.aweme_url,
            cover_url: v.cover_url,
            video_download_url: v.video_download_url,
            music_download_url: v.music_download_url,
            note_download_url: v.note_download_url,
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
