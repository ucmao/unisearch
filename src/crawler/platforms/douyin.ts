import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, notifyLoginQrCodeRequired, notifyLoginSuccess } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { dbStore } from '../store';
import fs from 'fs';
import { configuredTargets, firstMatch, resolveRedirect } from '../base/connectorHelpers';

export class DouyinCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[DY] Starting Douyin crawler (Electron CDP mode)...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    const pages = this.browserContext.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browserContext.newPage();




    const stealthPath = 'libs/stealth.min.js';
    if (fs.existsSync(stealthPath)) {
      await this.browserContext.addInitScript({ path: stealthPath });
    }

    await this.page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    } else if (activeConfig.CRAWLER_TYPE === 'detail') {
      await this.getSpecifiedAwemes();
    } else if (activeConfig.CRAWLER_TYPE === 'creator') {
      await this.getCreatorsAndAwemes();
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
      // Click login button if exists to popup QR code modal
      try {
        await this.page!.click('.login-guide, .header-login-btn, [data-e2e="header-login-btn"]', { timeout: 3000 });
      } catch {}

      await new Promise((r) => setTimeout(r, 1500));
      // Capture QR code image / screenshot for UI frontend
      try {
        let qrBase64 = '';
        const qrEl = await this.page!.$('#login-pannel, .login-mask, .login-guide, div[class*="login-container"]');
        if (qrEl) {
          const buf = await qrEl.screenshot({ type: 'png' });
          qrBase64 = `data:image/png;base64,${buf.toString('base64')}`;
        } else {
          const buf = await this.page!.screenshot({ type: 'png' });
          qrBase64 = `data:image/png;base64,${buf.toString('base64')}`;
        }
        notifyLoginQrCodeRequired('dy', qrBase64);
      } catch (err: any) {
        console.error('[DY] Failed to capture QR code:', err.message);
      }

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[DY] Login successful!');
          notifyLoginSuccess('dy');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async checkLoginState(): Promise<boolean> {
    // 1. If explicit login button / guide is visible, definitely NOT logged in
    try {
      const isLoginBtn = await this.page!.isVisible('.login-guide, .header-login-btn, [data-e2e="header-login-btn"]', { timeout: 1000 }).catch(() => false);
      if (isLoginBtn) return false;
    } catch {}

    // 2. Check session cookies
    try {
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some(
          (c) => c.name === 'sessionid' || c.name === 'sid_guard' || c.name === 'passport_auth_token'
        );
        if (hasSession) {
          const loginBtnExists = await this.page!.isVisible('.login-guide, .header-login-btn, [data-e2e="header-login-btn"]', { timeout: 1000 }).catch(() => false);
          if (loginBtnExists) return false;
          console.log('[DY] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[DY] Error checking cookies:', err.message);
    }

    // 3. Check avatar selectors (excluding invalid generic hrefs like a[href*="/user/self"])
    try {
      const selectors = [
        '[data-e2e="user-avatar"]',
        '.header-user-avatar',
        '.user-avatar',
        '.dy-avatar',
        '.tab-user_self',
        'div[class*="avatar"] img',
      ];
      for (const selector of selectors) {
        const visible = await this.page!.isVisible(selector, { timeout: 500 }).catch(() => false);
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
          if (activeConfig.ENABLE_GET_COMMENTS) await this.getAwemeComments(v.aweme_id);
          count++;
          
          await this.page!.waitForTimeout(activeConfig.CRAWLER_MAX_SLEEP_SEC * 1000);
        }
      } catch (err: any) {
        console.error(`[DY] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }

  private async fetchAwemeDetail(target: string, sourceKeyword: string): Promise<any | null> {
    const resolved = await resolveRedirect(this.page!, target);
    const awemeId = firstMatch(resolved, [
      /\/video\/(\d+)/i, /\/note\/(\d+)/i, /[?&](?:modal_id|aweme_id)=(\d+)/i, /^\s*(\d+)\s*$/,
    ]);
    const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(awemeId)}&device_platform=webapp&aid=6383`;
    try {
      const result = await this.page!.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), apiUrl);
      const info = result?.aweme_detail;
      if (!info?.aweme_id) throw new Error(result?.status_msg || `status ${result?.status_code ?? 'unknown'}`);
      const videoItem = info.video || {};
      const coverList = (videoItem.raw_cover || videoItem.origin_cover || {}).url_list || [];
      const playList = videoItem.play_addr_h264?.url_list || videoItem.play_addr?.url_list || [];
      const images = info.images || [];
      const record = {
        aweme_id: String(info.aweme_id), aweme_type: String(info.aweme_type || 'content'),
        title: info.desc || '', desc: info.desc || '', create_time: info.create_time || 0,
        creator_hash: String(info.author?.uid || info.author?.sec_uid || ''), nickname: info.author?.nickname || '',
        liked_count: Number(info.statistics?.digg_count || 0), collected_count: Number(info.statistics?.collect_count || 0),
        comment_count: Number(info.statistics?.comment_count || 0), share_count: Number(info.statistics?.share_count || 0),
        aweme_url: `https://www.douyin.com/video/${info.aweme_id}`,
        cover_url: coverList.at(-1) || '', video_download_url: playList.at(-1) || '',
        music_download_url: info.music?.play_url?.url_list?.at(-1) || info.music?.play_url?.uri || '',
        note_download_url: images.map((image: any) => image.url_list?.at(-1) || '').filter(Boolean).join(','),
        source_keyword: sourceKeyword,
      };
      await dbStore.storeDouyinAweme(record);
      if (activeConfig.ENABLE_GET_COMMENTS) await this.getAwemeComments(record.aweme_id);
      return record;
    } catch (error: any) {
      console.error(`[DY] Failed to collect detail ${target}: ${error.message}`);
      return null;
    }
  }

  private async getAwemeComments(awemeId: string): Promise<void> {
    const apiUrl = `https://www.douyin.com/aweme/v1/web/comment/list/?aweme_id=${encodeURIComponent(awemeId)}&cursor=0&count=${activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES}&item_type=0&device_platform=webapp&aid=6383`;
    try {
      const result = await this.page!.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), apiUrl);
      const comments = result?.comments || [];
      const store = async (comment: any, parent = '') => dbStore.storeDouyinComment({
        comment_id: String(comment.cid || ''), aweme_id: awemeId, content: comment.text || '',
        create_time: comment.create_time || 0, creator_hash: String(comment.user?.uid || comment.user?.sec_uid || ''),
        nickname: comment.user?.nickname || '', sub_comment_count: comment.reply_comment_total || 0,
        parent_comment_id: parent, like_count: comment.digg_count || 0,
        pictures: (comment.image_list || []).map((image: any) => image.origin_url?.url_list?.at(-1) || '').filter(Boolean).join(','),
      });
      for (const comment of comments) {
        await store(comment);
        if (activeConfig.ENABLE_GET_SUB_COMMENTS) {
          for (const child of comment.reply_comment || []) await store(child, String(comment.cid || ''));
        }
      }
      console.log(`[DY] Stored ${comments.length} comments for ${awemeId}`);
    } catch (error: any) {
      console.error(`[DY] Failed to collect comments for ${awemeId}: ${error.message}`);
    }
  }

  public async getSpecifiedAwemes(): Promise<void> {
    for (const target of configuredTargets('dy', 'detail')) await this.fetchAwemeDetail(target, '指定作品');
  }

  public async getCreatorsAndAwemes(): Promise<void> {
    for (const target of configuredTargets('dy', 'creator')) {
      const resolved = await resolveRedirect(this.page!, target);
      const secUid = firstMatch(resolved, [/\/user\/([^/?#]+)/i, /[?&]sec_uid=([^&#]+)/i]);
      await this.page!.goto(`https://www.douyin.com/user/${encodeURIComponent(secUid)}`, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(2500);
      const ids = await this.page!.evaluate(() => Array.from(document.querySelectorAll('a[href*="/video/"]'))
        .map((link) => link.getAttribute('href')?.match(/\/video\/(\d+)/)?.[1] || '').filter(Boolean));
      const unique = [...new Set(ids)].slice(0, activeConfig.CRAWLER_MAX_NOTES_COUNT);
      console.log(`[DY] Creator ${secUid}: discovered ${unique.length} works`);
      for (const id of unique) await this.fetchAwemeDetail(id, `创作者:${secUid}`);
    }
  }
}
