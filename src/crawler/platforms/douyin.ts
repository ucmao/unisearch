import { BrowserContext, Page, Response as PlaywrightResponse } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyLoginRequired,
  notifyLoginSuccess,
  notifyManualVerificationRequired,
  notifyManualVerificationSuccess,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import {
  configuredTargets,
  creatorItemLimit,
  creatorLimitReached,
  firstMatch,
  reportKeywordSearchCompletion,
  resolveRedirect,
  searchPageBudget,
} from '../base/connectorHelpers';

interface DouyinSearchCapture {
  ok: boolean;
  status: number;
  data: any;
  bodyError: string;
}

export function extractDouyinAwemeId(value: string): string {
  const text = String(value || '');
  return text.match(/(?:\/video\/|\/note\/|\/item\/|\/aweme\/)(\d{8,})/i)?.[1]
    || text.match(/[?&#](?:modal_id|aweme_id|item_id)=(\d{8,})/i)?.[1]
    || '';
}

export function decodeHttpChunkedText(value: string): string | null {
  const source = Buffer.from(String(value || ''), 'utf8');
  const chunks: Buffer[] = [];
  let offset = 0;
  let decodedAny = false;

  while (offset < source.length) {
    const lineFeed = source.indexOf(0x0a, offset);
    if (lineFeed < 0) return null;
    let lineEnd = lineFeed;
    if (lineEnd > offset && source[lineEnd - 1] === 0x0d) lineEnd--;
    const sizeLine = source.subarray(offset, lineEnd).toString('ascii').trim();
    const match = sizeLine.match(/^([0-9a-f]+)(?:;.*)?$/i);
    if (!match) return null;

    const size = Number.parseInt(match[1], 16);
    if (!Number.isFinite(size)) return null;
    offset = lineFeed + 1;
    if (size === 0) return decodedAny ? Buffer.concat(chunks).toString('utf8') : '';
    if (offset + size > source.length) return null;

    chunks.push(source.subarray(offset, offset + size));
    decodedAny = true;
    offset += size;
    if (source[offset] === 0x0d) offset++;
    if (source[offset] === 0x0a) offset++;
  }

  return decodedAny ? Buffer.concat(chunks).toString('utf8') : null;
}

export function cleanHttpChunkedJson(raw: string): string {
  let text = String(raw || '').trim();
  // Strip leading chunk hex headers if present (e.g. "1b5e4 {" or "1b5e4\r\n{")
  text = text.replace(/^[0-9a-fA-F]{1,8}\s+/, '').replace(/^[0-9a-fA-F]{1,8}\r?\n/, '');
  // Strip trailing chunk zero
  text = text.replace(/\r?\n0\r?\n[\s\S]*$/, '');
  // Remove all intermediate HTTP chunk size lines like \r\n1f40\r\n or \n1f40\n or \r\n1f40 {
  text = text.replace(/\r?\n[0-9a-fA-F]{1,8}\s*\r?\n/g, '').replace(/\r?\n[0-9a-fA-F]{1,8}\s+/g, '');
  return text;
}

export function parseDouyinSearchBody(value: string): any | null {
  const rawText = String(value || '');
  const text = rawText.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const dechunked = decodeHttpChunkedText(rawText);
  if (dechunked !== null) {
    try {
      return JSON.parse(dechunked);
    } catch {}
  }

  const cleaned = cleanHttpChunkedJson(rawText);
  try {
    return JSON.parse(cleaned);
  } catch {}

  const candidates = [cleaned, dechunked || '', text];
  for (const cand of candidates) {
    if (!cand) continue;
    const start = cand.indexOf('{');
    const end = cand.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = cand.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {}
      try {
        const cleanedSlice = slice.replace(/\r?\n[0-9a-fA-F]{1,8}\r?\n/g, '').replace(/\r?\n[0-9a-fA-F]{1,8}\s+/g, '');
        return JSON.parse(cleanedSlice);
      } catch {}
    }
  }

  return null;
}

export function describeDouyinSearchBody(value: string): string {
  const text = String(value || '');
  const prefix = text.slice(0, 80).replace(/[\r\n\t]+/g, ' ');
  return `bytes=${Buffer.byteLength(text, 'utf8')}, prefix=${JSON.stringify(prefix)}`;
}

// Douyin serves the search feed from several endpoints depending on the page
// build (`.../general/search/single/`, `.../search/item/`, and the newer
// `.../general/search/stream/`). Matching the family instead of exact paths
// keeps the crawler alive across their A/B rollouts.
const DOUYIN_SEARCH_ENDPOINT = /\/aweme\/v1\/web\/[^?]*search[^?]*\//i;
const DOUYIN_CREATOR_ENDPOINT = /\/aweme\/v1\/web\/aweme\/post\//i;

export class DouyinCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  private consecutiveCommentFailures = 0;
  private consecutiveDetailFailures = 0;
  // A persistent listener + buffer, rather than one-shot waitForResponse calls.
  // The one-shot version raced with page load and with the 3-minute captcha wait:
  // its 20s timer expired long before the response it was meant to catch arrived.
  private searchResponseBuffer: DouyinSearchCapture[] = [];
  private searchResponseWaiters: Array<(capture: DouyinSearchCapture) => void> = [];
  private searchListenerAttached = false;

  private async installPageSearchCapture(): Promise<void> {
    // Electron's CDP target may report a response but reject Network.getResponseBody
    // after the page has consumed it. Capture a clone inside the page before that
    // happens, while still letting Douyin's original request run unchanged.
    await this.page!.addInitScript(() => {
      const marker = /\/aweme\/v1\/web\/[^?]*search[^?]*\//i;
      const key = '__unisearchDouyinSearchBodies';
      const push = (entry: any) => {
        const buffer = ((window as any)[key] ||= []);
        buffer.push(entry);
        if (buffer.length > 20) buffer.splice(0, buffer.length - 20);
      };

      const originalFetch = window.fetch.bind(window) as (...args: any[]) => Promise<Response>;
      window.fetch = async (...args: any[]) => {
        const response = await originalFetch(...args);
        const url = String(args[0]?.url || args[0] || '');
        if (marker.test(url)) {
          void response.clone().text().then((body) => push({ url, status: response.status, body })).catch(() => {});
        }
        return response;
      };

      const originalOpen: any = XMLHttpRequest.prototype.open;
      const originalSend: any = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(this: XMLHttpRequest, method: string, url: string, async = true, username?: string, password?: string) {
        (this as any).__unisearchUrl = String(url);
        return originalOpen.call(this, method, url, async, username, password);
      } as typeof XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.send = function(this: XMLHttpRequest, ...args: any[]) {
        this.addEventListener('load', () => {
          const url = String((this as any).__unisearchUrl || '');
          if (marker.test(url)) push({ url, status: this.status, body: this.responseText });
        });
        return originalSend.apply(this, args as any);
      };
    });
  }

  private async readPageSearchPayload(): Promise<any | null> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const entry = await this.page!.evaluate(() => {
        const key = '__unisearchDouyinSearchBodies';
        const buffer = ((window as any)[key] || []) as Array<{ body?: string }>;
        const item = buffer.shift();
        return item?.body || null;
      }).catch(() => null);
      if (entry) {
        return parseDouyinSearchBody(entry);
      }
      await this.page!.waitForTimeout(100);
    }
    return null;
  }

  private async replaySignedSearchRequest(response: PlaywrightResponse): Promise<any | null> {
    if (!this.browserContext) return null;
    const sourceHeaders = await response.request().allHeaders().catch(() => response.request().headers());
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(sourceHeaders)) {
      if (/^(?:host|connection|content-length|accept-encoding)$/i.test(name)) continue;
      if (name.startsWith(':')) continue;
      headers[name] = value;
    }

    const replay = await this.browserContext.request.get(response.url(), {
      headers,
      timeout: 20000,
      failOnStatusCode: false,
    });
    const rawBody = await replay.text();
    const data = parseDouyinSearchBody(rawBody);
    if (data) {
      console.log(`[DY] Recovered search JSON by replaying the page-signed request (HTTP ${replay.status()}).`);
      return data;
    }
    console.warn(`[DY] Page-signed search replay was unreadable (HTTP ${replay.status()}; ${describeDouyinSearchBody(rawBody)}).`);
    return null;
  }

  public async start(): Promise<void> {
    console.log('[DY] Starting Douyin crawler (Electron CDP mode)...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'douyin');

    await this.installPageSearchCapture();

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
      notifyLoginRequired('douyin', '抖音当前会话未登录，需要在采集浏览器中确认或完成登录');

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[DY] Login successful!');
          notifyLoginSuccess('douyin');
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

    // Douyin can retain session-looking cookies after the server has invalidated
    // them. The rendered login wall is authoritative and must win over cookies.
    try {
      const bodyText = await this.page!.locator('body').innerText({ timeout: 1500 }).catch(() => '');
      if (/登录后即可搜索更多精彩视频|扫码登录[\s\S]{0,200}验证码登录/.test(bodyText)) {
        return false;
      }
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

  private attachSearchResponseListener(): void {
    if (this.searchListenerAttached) return;
    this.searchListenerAttached = true;
    this.page!.on('response', (response) => {
      if (response.request().method() !== 'GET') return;
      if (!DOUYIN_SEARCH_ENDPOINT.test(response.url())) return;
      void (async () => {
        let capture: DouyinSearchCapture;
        try {
          // Electron CDP can expose HTTP chunk framing in the response body
          // (for example "b025\\n{...}"). Playwright's response.json() then
          // fails before our framing cleanup gets a chance to run. Read text
          // first and parse it with the same tolerant parser used by the page
          // capture fallback.
          const rawBody = await response.text();
          let data = parseDouyinSearchBody(rawBody);
          if (!data) {
            data = await this.replaySignedSearchRequest(response).catch((error: any) => {
              console.warn(`[DY] Page-signed search replay failed: ${error.message || String(error)}`);
              return null;
            });
          }
          capture = {
            ok: response.ok(), status: response.status(), data,
            bodyError: data ? '' : `抖音搜索响应不是有效 JSON（${describeDouyinSearchBody(rawBody)}）`,
          };
        } catch (error: any) {
          capture = {
            ok: response.ok(), status: response.status(), data: null,
            bodyError: error.message || String(error),
          };
        }
        const waiter = this.searchResponseWaiters.shift();
        if (waiter) waiter(capture);
        else this.searchResponseBuffer.push(capture);
      })();
    });
  }

  /** Payloads that already arrived are returned immediately; otherwise wait. */
  private nextSearchResponse(timeout = 20000): Promise<DouyinSearchCapture | null> {
    const buffered = this.searchResponseBuffer.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve) => {
      const waiter = (capture: DouyinSearchCapture) => {
        clearTimeout(timer);
        resolve(capture);
      };
      const timer = setTimeout(() => {
        this.searchResponseWaiters = this.searchResponseWaiters.filter((item) => item !== waiter);
        resolve(null);
      }, timeout);
      this.searchResponseWaiters.push(waiter);
    });
  }

  /** Payloads from a previous keyword must not leak into the next one. */
  private resetSearchResponses(): void {
    this.searchResponseBuffer = [];
  }

  private async waitForInteractiveLogin(reason: string): Promise<void> {
    console.warn(`[DY] Login is required: ${reason}`);
    notifyLoginRequired('douyin', reason);
    const startTime = Date.now();
    while (Date.now() - startTime < 120 * 1000) {
      if (await this.checkLoginState()) {
        console.log('[DY] Login successful. Resuming crawler...');
        notifyLoginSuccess('douyin');
        return;
      }
      await this.page!.waitForTimeout(1000);
    }
    throw new Error('抖音登录等待超时。请点击工作区登录提示，打开采集浏览器完成登录后重试。');
  }

  private async openSearchPage(keyword: string, allowLoginRetry = true): Promise<DouyinSearchCapture | null> {
    this.attachSearchResponseListener();
    this.resetSearchResponses();
    const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`;
    await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // The timer starts after navigation completes, so a slow first paint no longer
    // eats the capture window; anything that already landed is buffered anyway.
    let capture = await this.nextSearchResponse(20000);

    if (await this.hasManualVerification()) {
      const verifiedCapture = await this.waitForManualVerification(keyword);
      if (verifiedCapture) capture = verifiedCapture;
    }

    if (!await this.checkLoginState()) {
      if (!allowLoginRetry) throw new Error('搜索页显示登录仍未生效，请重新登录后再试');
      await this.waitForInteractiveLogin(`搜索“${keyword}”时抖音判定当前登录已失效`);
      return this.openSearchPage(keyword, false);
    }

    // Risk control can serve an interstitial that neither trips the captcha
    // detector nor issues a search request. One reload usually clears it.
    if (!capture) {
      console.warn('[DY] No search response after first load. Reloading once...');
      this.resetSearchResponses();
      await this.page!.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      capture = await this.nextSearchResponse(15000);
    }
    return capture;
  }

  private async waitForManualVerification(keyword: string): Promise<DouyinSearchCapture | null> {
    console.warn('[DY] Graphical verification detected. Waiting up to 180 seconds for manual completion...');
    notifyManualVerificationRequired('douyin', `搜索“${keyword}”需要完成图形验证`);
    const startTime = Date.now();
    let stablePasses = 0;
    while (Date.now() - startTime < 180 * 1000) {
      if (await this.hasManualVerification()) {
        stablePasses = 0;
      } else {
        stablePasses++;
        if (stablePasses >= 2) {
          console.log('[DY] Manual verification completed. Resuming search...');
          notifyManualVerificationSuccess('douyin');
          // Only start waiting now: the user may have taken minutes to solve the
          // captcha, and any response from before it is stale.
          this.resetSearchResponses();
          const afterVerification = await this.nextSearchResponse(15000);
          if (afterVerification) return afterVerification;
          // Some captcha flows leave the page on the challenge URL without
          // re-issuing the search, so ask for it explicitly.
          await this.page!.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          return await this.nextSearchResponse(20000);
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
    return this.page!.locator('a, [data-aweme-id], [data-id], [data-e2e], div[data-url]').evaluateAll((nodes) => {
      const seen = new Set<string>();
      return nodes.flatMap((node) => {
        const element = node as HTMLElement;
        const href = (element as HTMLAnchorElement).href || '';
        const raw = [href, element.getAttribute('data-aweme-id') || '', element.getAttribute('data-id') || '',
          element.getAttribute('data-e2e') || '', element.getAttribute('data-url') || '',
          (element.outerHTML || '').slice(0, 500)].join(' ');
        const id = raw.match(/(?:\/video\/|\/note\/|\/item\/|\/aweme\/)(\d{8,})/i)?.[1]
          || raw.match(/[?&#](?:modal_id|aweme_id|item_id)=(\d{8,})/i)?.[1]
          || raw.match(/\b(7\d{18})\b/)?.[1]
          || (element.getAttribute('data-aweme-id') || '').match(/\d{8,}/)?.[0]
          || '';
        if (!id || seen.has(id)) return [];
        seen.add(id);
        const img = element.querySelector('img') as HTMLImageElement | null;
        const text = (element.textContent || img?.alt || '').trim();
        return [{ aweme_id: id, aweme_type: /\/note\//i.test(raw) ? 'note' : 'video', title: text, desc: text,
          create_time: 0, creator_hash: '', nickname: '', liked_count: 0, collected_count: 0,
          comment_count: 0, share_count: 0, aweme_url: href || `https://www.douyin.com/video/${id}`, cover_url: img?.src || '',
          video_download_url: '', music_download_url: '', note_download_url: '' }];
      });
    });
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    const failures: string[] = [];
    for (const keyword of keywords) {
      console.log(`[DY] Searching keyword: ${keyword}`);
      try {
        // Let Douyin's own page generate the current signed search request. Hand-built
        // requests quickly become invalid when anti-bot parameters change.
        const capture = await this.openSearchPage(keyword);

        const postsRes: any = capture?.data || null;
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

        if (videoMap.size === 0 && capture?.bodyError) {
          mergeVideos(this.searchItemsFromPayload(await this.readPageSearchPayload()));
        }

        // Some page versions hydrate results without exposing the JSON response to
        // Playwright. Keep a DOM fallback so that this is not reported as a fake zero.
        if (videoMap.size === 0) {
          const cardTarget = this.page!.locator('a[href*="/video/"], a[href*="/note/"], [data-aweme-id]');
          await cardTarget.first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});

          const endTime = Date.now() + 5000;
          while (videoMap.size === 0 && Date.now() < endTime) {
            mergeVideos(await this.collectRenderedSearchItems());
            if (videoMap.size > 0) break;
            await this.page!.waitForTimeout(500);
          }
        }

        if (videoMap.size === 0) {
          const pageText = (await this.page!.locator('body').innerText().catch(() => '')).slice(0, 2000);
          // The full page text goes to the log, never into the error message: it
          // is unreadable in the UI and its stray "验证"/"登录" words hijack
          // classifyConnectorError into reporting the wrong failure code.
          console.warn(`[DY] Empty search result. Page text: ${pageText}`);
          if (!capture) {
            throw new Error('未捕获到抖音搜索请求，页面可能被风控或尚未完成加载。请打开内置采集浏览器查看抖音页面当前状态。');
          }
          if (capture.bodyError) {
            throw new Error('CDP 无法读取搜索响应，且页面未渲染出作品。请打开内置采集浏览器检查是否有验证或风控提示。');
          }
          const isExplicitEmptyResult = /暂无搜索结果|没有找到相关|未找到相关|换个关键词试试/.test(pageText);
          if (!isExplicitEmptyResult) {
            throw new Error('抖音未返回作品，也未显示“无搜索结果”，页面可能仍处于验证或风控状态。详细页面内容见采集日志。');
          }
          console.warn(`[DY] Search explicitly returned no matching content. status_code=${postsRes?.status_code ?? 'unknown'}`);
        }

        // Douyin search is infinite-scroll. Keep scrolling and capture each signed
        // next-page response until the configured item limit is reached.
        const targetCount = activeConfig.CRAWLER_MAX_NOTES_COUNT;
        // Leave room for duplicate/recommendation cards. A target of 300 used
        // to receive only the exact theoretical 30 scrolls and often stopped
        // short even when the platform still had results.
        const maxScrolls = searchPageBudget(targetCount, 10, 8, 80);
        let stalledScrolls = 0;
        for (let scroll = 0; videoMap.size < targetCount && scroll < maxScrolls; scroll++) {
          const before = videoMap.size;
          await this.page!.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const nextCapture = await this.nextSearchResponse(8000);
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
          if (nextCapture?.data && Number(nextCapture.data.has_more) === 0) break;
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

          await connectorOutput.emitDouyinAweme(awemeDetail);
          count++;
        }
        console.log(`[DY] Persisted ${count} video records before comment enrichment.`);
        reportKeywordSearchCompletion('抖音', keyword, count, targetCount,
          stalledScrolls >= 2 ? '连续两次滚动没有新增唯一内容' : '平台搜索流已停止返回新内容');

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
              await this.humanDelay(this.page);
            } catch {
              console.warn(`[DY] Crawler page closed after ${processedComments} comment items; saved videos are retained.`);
              break;
            }
          }
        }
      } catch (err: any) {
        console.error(`[DY] Search error for keyword ${keyword}:`, err.message);
        failures.push(`"${keyword}": ${err.message}`);
      }
    }
    if (failures.length && failures.length === keywords.length) {
      throw new Error(`全部关键词采集失败：${failures.join('；')}`);
    } else if (failures.length) {
      console.warn(`[DY] ${failures.length}/${keywords.length} 个关键词采集失败，其余关键词已正常入库: ${failures.join('；')}`);
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
      this.consecutiveDetailFailures = 0;
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
      await connectorOutput.emitDouyinAweme(record);
      if (activeConfig.ENABLE_GET_COMMENTS) await this.getAwemeComments(record.aweme_id);
      return record;
    } catch (error: any) {
      this.consecutiveDetailFailures++;
      console.error(`[DY] Failed to collect detail ${target}: ${error.message}`);
      if (this.consecutiveDetailFailures >= 3 && !(await this.checkLoginState())) {
        throw new Error(`连续 ${this.consecutiveDetailFailures} 个作品采集失败，且登录状态已失效: ${error.message}`, { cause: error });
      }
      return null;
    }
  }

  // Douyin's comment endpoint tolerates a bare, cookie-authenticated fetch without
  // a_bogus/msToken most of the time (verified empirically against a logged-in
  // session), unlike search which Douyin signs and risk-controls much more tightly.
  // Returns null on anything short of a clean JSON success so the caller can fall
  // back to a real page navigation.
  private async fetchCommentsBare(awemeId: string): Promise<any | null> {
    const url = `https://www.douyin.com/aweme/v1/web/comment/list/?device_platform=webapp&aid=6383&aweme_id=${encodeURIComponent(awemeId)}&cursor=0&count=20&item_type=0`;
    try {
      const result = await this.page!.evaluate(async (u) => {
        const res = await fetch(u, { credentials: 'include' });
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('json')) return null;
        return res.json();
      }, url);
      if (!result || Number(result.status_code || 0) !== 0) return null;
      return result;
    } catch {
      return null;
    }
  }

  private async storeComments(awemeId: string, result: any): Promise<number> {
    const comments = result?.comments || [];
    const store = async (comment: any, parent = '') => connectorOutput.emitDouyinComment({
      comment_id: String(comment.cid || ''), aweme_id: awemeId, content: comment.text || '',
      create_time: comment.create_time || 0, creator_hash: String(comment.user?.uid || comment.user?.sec_uid || ''),
      nickname: comment.user?.nickname || '', sub_comment_count: comment.reply_comment_total || 0,
      parent_comment_id: parent, like_count: comment.digg_count || 0,
      pictures: (comment.image_list || []).map((image: any) => image.origin_url?.url_list?.at(-1) || '').filter(Boolean).join(','),
    });
    for (const comment of comments) {
      await store(comment);
      // reply_comment is inlined by the comment list endpoint itself.
      for (const child of comment.reply_comment || []) await store(child, String(comment.cid || ''));
    }
    return comments.length;
  }

  private async getAwemeComments(awemeId: string): Promise<void> {
    if (this.consecutiveCommentFailures >= 2) return;
    try {
      // Fast path: skip the full page navigation entirely when the bare fetch works.
      const bare = await this.fetchCommentsBare(awemeId);
      if (bare) {
        const count = await this.storeComments(awemeId, bare);
        this.consecutiveCommentFailures = 0;
        console.log(`[DY] Stored ${count} comments for ${awemeId} (bare fetch)`);
        return;
      }

      // Fallback: opening the real detail page lets Douyin generate the current signed
      // comment request. A hand-built URL is sometimes answered with a verification
      // page instead of JSON, so let the real front-end sign it when the bare path fails.
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
      const count = await this.storeComments(awemeId, result);
      this.consecutiveCommentFailures = 0;
      console.log(`[DY] Stored ${count} comments for ${awemeId}`);
    } catch (error: any) {
      this.consecutiveCommentFailures++;
      console.warn(`[DY] Comments unavailable for ${awemeId}: ${error.message}`);
      if (this.consecutiveCommentFailures >= 2) {
        console.warn('[DY] Comment collection paused after 2 consecutive blocked responses; video collection will continue.');
      }
    }
  }

  public async getSpecifiedAwemes(): Promise<void> {
    for (const target of configuredTargets('douyin', 'detail')) await this.fetchAwemeDetail(target, '指定作品');
  }

  public async getCreatorsAndAwemes(): Promise<void> {
    for (const target of configuredTargets('douyin', 'creator')) {
      const resolved = await resolveRedirect(this.page!, target);
      const secUid = firstMatch(resolved, [/\/user\/([^/?#]+)/i, /[?&]sec_uid=([^&#]+)/i]);
      const unique = await this.collectCreatorAwemeIds(secUid);
      console.log(`[DY] Creator ${secUid}: discovered ${unique.length} works`);
      for (const id of unique) await this.fetchAwemeDetail(id, `创作者:${secUid}`);
    }
  }

  /**
   * Let the real profile page sign its lazy-load requests, and harvest both the
   * structured responses and rendered links until the feed reaches its end.
   */
  private async collectCreatorAwemeIds(secUid: string): Promise<string[]> {
    const limit = creatorItemLimit();
    const ids = new Set<string>();
    let terminalSeen = false;
    const pending = new Set<Promise<void>>();
    const capture = (response: PlaywrightResponse) => {
      if (!DOUYIN_CREATOR_ENDPOINT.test(response.url())) return;
      const task = (async () => {
        try {
          const payload = parseDouyinSearchBody(await response.text());
          for (const aweme of payload?.aweme_list || []) {
            const id = String(aweme?.aweme_id || '');
            if (id && !creatorLimitReached(ids.size, limit)) ids.add(id);
          }
          if (Number(payload?.has_more || 0) === 0) terminalSeen = true;
        } catch {
          // DOM extraction below remains available when CDP drops a body.
        }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task));
    };
    this.page!.on('response', capture);
    try {
      await this.page!.goto(`https://www.douyin.com/user/${encodeURIComponent(secUid)}`, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(2500);
      let stagnantRounds = 0;
      while (!terminalSeen && !creatorLimitReached(ids.size, limit) && stagnantRounds < 5) {
        if (pending.size) await Promise.allSettled([...pending]);
        const visible = await this.page!.evaluate(() => Array.from(
          document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]'),
        ).map((link) => link.getAttribute('href')?.match(/\/(?:video|note)\/(\d+)/)?.[1] || '').filter(Boolean));
        const before = ids.size;
        for (const id of visible) {
          ids.add(id);
          if (creatorLimitReached(ids.size, limit)) break;
        }
        stagnantRounds = ids.size > before ? 0 : stagnantRounds + 1;
        if (!terminalSeen && !creatorLimitReached(ids.size, limit)) {
          await this.page!.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await this.page!.waitForTimeout(1600);
        }
      }
      if (pending.size) await Promise.allSettled([...pending]);
    } finally {
      this.page!.off('response', capture);
    }
    const collected = [...ids];
    return limit === null ? collected : collected.slice(0, limit);
  }
}
