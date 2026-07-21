import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyLoginQrCodeRequired,
  notifyLoginSuccess,
  notifyManualVerificationRequired,
  notifyManualVerificationSuccess,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { dbStore } from '../store';
import fs from 'fs';
import { configuredTargets, firstMatch, resolveRedirect } from '../base/connectorHelpers';

interface DouyinSearchCapture {
  ok: boolean;
  status: number;
  data: any;
  bodyError: string;
}

export class DouyinCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  private consecutiveCommentFailures = 0;

  public async start(): Promise<void> {
    console.log('[DY] Starting Douyin crawler (Electron CDP mode)...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'dy');




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

      if (!isLoggedIn) {
        throw new Error('抖音登录等待超时。请点击登录提示中的“打开窗口”，完成登录后重新运行任务。');
      }
    } else if (!isLoggedIn) {
      throw new Error('抖音登录状态无效，请改用二维码登录或更新 Cookie。');
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

    // 3. Only accept selectors that contain account-specific data. Generic navigation
    // elements such as `.tab-user_self` are also rendered for visitors.
    try {
      const selectors = [
        'a[href*="/user/"][href*="sec_uid"] img',
        '[data-e2e="user-avatar"] img[src^="http"]',
        '.header-user-avatar img[src^="http"]',
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

  private async hasManualVerification(): Promise<boolean> {
    const selectors = [
      '#captcha_container',
      '.captcha_verify_container',
      '.captcha-verify-container',
      '[class*="captcha_verify"]',
      'iframe[src*="captcha"]',
    ];
    for (const selector of selectors) {
      if (await this.page!.isVisible(selector, { timeout: 300 }).catch(() => false)) return true;
    }
    const text = await this.page!.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    return /图形验证|安全验证|完成下列验证|拖动滑块|验证后继续/.test(text);
  }

  private captureSearchResponse(timeout = 20000): Promise<DouyinSearchCapture | null> {
    return this.page!.waitForResponse(
      (response) => /\/aweme\/v1\/web\/(?:general\/search\/single|search\/item)\//i.test(response.url())
        && response.request().method() === 'GET',
      { timeout },
    ).then(async (response) => {
      try {
        return { ok: response.ok(), status: response.status(), data: await response.json(), bodyError: '' };
      } catch (error: any) {
        return {
          ok: response.ok(), status: response.status(), data: null,
          bodyError: error.message || String(error),
        };
      }
    }).catch(() => null);
  }

  private async waitForManualVerification(keyword: string): Promise<DouyinSearchCapture | null> {
    console.warn('[DY] Graphical verification detected. Waiting up to 180 seconds for manual completion...');
    notifyManualVerificationRequired('dy', `搜索“${keyword}”需要完成图形验证`);
    const responseAfterVerification = this.captureSearchResponse();
    const startTime = Date.now();
    let stablePasses = 0;
    while (Date.now() - startTime < 180 * 1000) {
      if (await this.hasManualVerification()) {
        stablePasses = 0;
      } else {
        stablePasses++;
        if (stablePasses >= 2) {
          console.log('[DY] Manual verification completed. Resuming search...');
          notifyManualVerificationSuccess('dy');
          return await responseAfterVerification;
        }
      }
      await this.page!.waitForTimeout(1000);
    }
    throw new Error('等待抖音图形验证超时，请重新运行任务并在 3 分钟内完成验证');
  }

  private searchItemsFromPayload(payload: any): any[] {
    if (!Array.isArray(payload?.data)) return [];
    return payload.data.flatMap((item: any) => {
      const awemeInfo = item.aweme_info || item.aweme_mix_info?.mix_items?.[0];
      if (!awemeInfo?.aweme_id) return [];
      const videoItem = awemeInfo.video || {};
      const rawCoverList = (videoItem.raw_cover || videoItem.origin_cover || {}).url_list || [];
      const actualUrlList = videoItem.play_addr_h264?.url_list || videoItem.play_addr_256?.url_list || videoItem.play_addr?.url_list || [];
      const images = awemeInfo.images || [];
      return [{
        aweme_id: String(awemeInfo.aweme_id),
        aweme_type: String(awemeInfo.aweme_type || 'content'),
        title: awemeInfo.desc || '', desc: awemeInfo.desc || '', create_time: awemeInfo.create_time || 0,
        creator_hash: awemeInfo.author?.uid || '', nickname: awemeInfo.author?.nickname || '',
        liked_count: Number(awemeInfo.statistics?.digg_count || 0),
        collected_count: Number(awemeInfo.statistics?.collect_count || 0),
        comment_count: Number(awemeInfo.statistics?.comment_count || 0),
        share_count: Number(awemeInfo.statistics?.share_count || 0),
        aweme_url: `https://www.douyin.com/video/${awemeInfo.aweme_id}`,
        cover_url: rawCoverList.at(-1) || '', video_download_url: actualUrlList.at(-1) || '',
        music_download_url: awemeInfo.music?.play_url?.url_list?.at(-1) || awemeInfo.music?.play_url?.uri || '',
        note_download_url: images.map((img: any) => img.url_list?.at(-1) || '').filter(Boolean).join(','),
      }];
    });
  }

  private async collectRenderedSearchItems(): Promise<any[]> {
    return this.page!.locator('a[href*="/video/"], a[href*="/note/"]').evaluateAll((links) => {
      const seen = new Set<string>();
      return links.flatMap((link) => {
        const href = (link as HTMLAnchorElement).href;
        const id = href.match(/\/(?:video|note)\/(\d+)/)?.[1] || '';
        if (!id || seen.has(id)) return [];
        seen.add(id);
        const img = link.querySelector('img') as HTMLImageElement | null;
        const text = (link.textContent || img?.alt || '').trim();
        return [{ aweme_id: id, aweme_type: href.includes('/note/') ? 'note' : 'video', title: text, desc: text,
          create_time: 0, creator_hash: '', nickname: '', liked_count: 0, collected_count: 0,
          comment_count: 0, share_count: 0, aweme_url: href, cover_url: img?.src || '',
          video_download_url: '', music_download_url: '', note_download_url: '' }];
      });
    });
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[DY] Searching keyword: ${keyword}`);
      try {
        // Let Douyin's own page generate the current signed search request. Hand-built
        // requests quickly become invalid when anti-bot parameters change.
        const searchCapture = this.captureSearchResponse();
        const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`;
        await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        let capture = await searchCapture;
        await this.page!.waitForTimeout(2500);

        if (await this.hasManualVerification()) {
          const verifiedCapture = await this.waitForManualVerification(keyword);
          if (verifiedCapture) capture = verifiedCapture;
          await this.page!.waitForTimeout(3000);
        }

        if (!await this.checkLoginState()) {
          throw new Error('搜索页显示登录已失效，请重新扫码登录');
        }

        let postsRes: any = capture?.data || null;
        if (capture) {
          if (!capture.ok) {
            throw new Error(`抖音搜索接口请求失败（HTTP ${capture.status}）`);
          }
          if (capture.bodyError) {
            console.warn(`[DY] Search response body unavailable via CDP (HTTP ${capture.status}); falling back to rendered page: ${capture.bodyError}`);
          }
          if (postsRes && Number(postsRes.status_code || 0) !== 0) {
            throw new Error(`抖音搜索接口拒绝请求（status_code=${postsRes.status_code}${postsRes.status_msg ? `, ${postsRes.status_msg}` : ''}）`);
          }
        }

        const videoMap = new Map<string, any>();
        const mergeVideos = (items: any[]) => {
          for (const item of items) {
            const existing = videoMap.get(String(item.aweme_id));
            // Prefer signed API metadata over the lean DOM fallback.
            if (!existing || (!existing.creator_hash && item.creator_hash)) videoMap.set(String(item.aweme_id), item);
          }
        };
        mergeVideos(this.searchItemsFromPayload(postsRes));

        // Some page versions hydrate results without exposing the JSON response to
        // Playwright. Keep a DOM fallback so that this is not reported as a fake zero.
        if (videoMap.size === 0) {
          await this.page!.locator('a[href*="/video/"], a[href*="/note/"]').first()
            .waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
          mergeVideos(await this.collectRenderedSearchItems());
        }

        if (videoMap.size === 0) {
          const pageText = (await this.page!.locator('body').innerText().catch(() => '')).slice(0, 2000);
          if (!capture) {
            throw new Error(`未捕获到抖音搜索请求，页面可能被风控或尚未完成加载。页面摘要：${pageText}`);
          }
          if (capture.bodyError) {
            throw new Error(`CDP 无法读取搜索响应，且页面未渲染出作品。请打开内置浏览器检查验证或风控提示。页面摘要：${pageText}`);
          }
          const isExplicitEmptyResult = /暂无搜索结果|没有找到相关|未找到相关|换个关键词试试/.test(pageText);
          if (!isExplicitEmptyResult) {
            throw new Error(`抖音未返回作品，也未显示“无搜索结果”。页面可能仍处于验证或风控状态。页面摘要：${pageText}`);
          }
          console.warn(`[DY] Search explicitly returned no matching content. status_code=${postsRes?.status_code ?? 'unknown'}`);
        }

        // Douyin search is infinite-scroll. Keep scrolling and capture each signed
        // next-page response until the configured item limit is reached.
        const targetCount = activeConfig.CRAWLER_MAX_NOTES_COUNT;
        const maxScrolls = Math.min(30, Math.max(2, Math.ceil(targetCount / 10) + 2));
        let stalledScrolls = 0;
        for (let scroll = 0; videoMap.size < targetCount && scroll < maxScrolls; scroll++) {
          const before = videoMap.size;
          const nextCapturePromise = this.captureSearchResponse(8000);
          await this.page!.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const nextCapture = await nextCapturePromise;
          await this.page!.waitForTimeout(1200);

          if (await this.hasManualVerification()) {
            const verifiedCapture = await this.waitForManualVerification(keyword);
            if (verifiedCapture?.data) mergeVideos(this.searchItemsFromPayload(verifiedCapture.data));
          } else if (nextCapture?.data) {
            if (Number(nextCapture.data.status_code || 0) !== 0) {
              throw new Error(`抖音搜索翻页被拒绝（status_code=${nextCapture.data.status_code}）`);
            }
            mergeVideos(this.searchItemsFromPayload(nextCapture.data));
          }
          mergeVideos(await this.collectRenderedSearchItems());

          if (videoMap.size === before) stalledScrolls++;
          else {
            stalledScrolls = 0;
            console.log(`[DY] Loaded more search results: ${videoMap.size}/${targetCount}`);
          }
          if (stalledScrolls >= 2) break;
        }

        const videos = Array.from(videoMap.values()).slice(0, targetCount);

        console.log(`[DY] Found ${videos.length} videos. Ingesting...`);
        let count = 0;

        // Persist every discovered content record before optional enrichment. A user
        // hiding/closing a verification window or a comment failure must not discard
        // dozens of already discovered videos that only existed in memory.
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
        }
        console.log(`[DY] Persisted ${count} video records before comment enrichment.`);

        if (activeConfig.ENABLE_GET_COMMENTS) {
          let processedComments = 0;
          for (const v of videos.slice(0, count)) {
            if (!this.page || this.page.isClosed()) {
              console.warn(`[DY] Crawler page is unavailable; keeping ${count} saved videos and stopping comment enrichment.`);
              break;
            }
            await this.getAwemeComments(v.aweme_id);
            processedComments++;
            if (this.consecutiveCommentFailures >= 2) break;
            try {
              await this.page.waitForTimeout(activeConfig.CRAWLER_MAX_SLEEP_SEC * 1000);
            } catch {
              console.warn(`[DY] Crawler page closed after ${processedComments} comment items; saved videos are retained.`);
              break;
            }
          }
        }
      } catch (err: any) {
        console.error(`[DY] Search error for keyword ${keyword}:`, err.message);
        throw err;
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
    if (this.consecutiveCommentFailures >= 2) return;
    try {
      // Opening the real detail page lets Douyin generate the current signed comment
      // request. Calling the endpoint with a hand-built URL is commonly answered by
      // an HTML verification page instead of JSON.
      const commentCapture = this.page!.waitForResponse(
        (response) => {
          if (!response.url().includes('/aweme/v1/web/comment/list/')) return false;
          try {
            return new URL(response.url()).searchParams.get('aweme_id') === awemeId;
          } catch {
            return false;
          }
        },
        { timeout: 12000 },
      ).then(async (response) => {
        const contentType = response.headers()['content-type'] || '';
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
        if (!contentType.includes('json')) throw new Error(`接口返回 ${contentType || '未知内容类型'}，可能触发验证`);
        return response.json();
      }).catch((error: any) => ({ __captureError: error.message || String(error) }));

      await this.page!.goto(`https://www.douyin.com/video/${encodeURIComponent(awemeId)}`, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      await this.page!.waitForTimeout(1000);
      await this.page!.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const result = await commentCapture;
      if (result?.__captureError) throw new Error(result.__captureError);
      if (Number(result?.status_code || 0) !== 0) {
        throw new Error(`status_code=${result?.status_code ?? 'unknown'}${result?.status_msg ? `, ${result.status_msg}` : ''}`);
      }
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
      this.consecutiveCommentFailures = 0;
      console.log(`[DY] Stored ${comments.length} comments for ${awemeId}`);
    } catch (error: any) {
      this.consecutiveCommentFailures++;
      console.warn(`[DY] Comments unavailable for ${awemeId}: ${error.message}`);
      if (this.consecutiveCommentFailures >= 2) {
        console.warn('[DY] Comment collection paused after 2 consecutive blocked responses; video collection will continue.');
      }
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
