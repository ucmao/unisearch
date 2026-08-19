import { BrowserContext, CDPSession, Locator, Page } from 'playwright';
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
} from '../base/connectorHelpers';
import { XhsSigner } from '../base/xhsSigner';
import { MANUAL_LOGIN_TIMEOUT_MS, MANUAL_VERIFICATION_TIMEOUT_MS } from '../base/interactiveTimeouts';

type XhsLoginState = 'authenticated' | 'unauthenticated' | 'verification' | 'unknown';

const XHS_AUTH_COOKIES = new Set(['web_session', 'id_token', 'a1']);
const LOGIN_INITIAL_SETTLE_MS = 1_500;
const LOGIN_SUCCESS_SETTLE_MS = 3_000;

export class XiaoHongShuCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  private signer: XhsSigner | null = null;
  private cdpSession: CDPSession | null = null;
  private lastPositiveLoginAt = 0;

  private get apiHost(): string {
    return activeConfig.XHS_INTERNATIONAL ? 'webapi.rednote.com' : 'edith.xiaohongshu.com';
  }

  private get indexUrl(): string {
    return activeConfig.XHS_INTERNATIONAL ? 'https://www.rednote.com' : 'https://www.xiaohongshu.com';
  }

  public async start(): Promise<void> {
    console.log('[XHS] Starting XiaoHongShu crawler (Electron CDP mode)...');

    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'xhs');

    // Record the web app's own signed requests so API calls can reuse their shape.
    this.signer = new XhsSigner(this.page);
    this.signer.attach();




    // Navigate to homepage
    await this.page.goto(this.indexUrl, { waitUntil: 'domcontentloaded' });

    // Handle Login
    await this.handleLogin();

    await this.primeSigner();

    // Run Crawler Tasks
    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    } else if (activeConfig.CRAWLER_TYPE === 'detail') {
      await this.getSpecifiedNotes();
    } else if (activeConfig.CRAWLER_TYPE === 'creator') {
      await this.getCreatorsAndNotes();
    }

    console.log('[XHS] XiaoHongShu crawler finished.');
  }

  /**
   * Browse the explore feed briefly so the web app issues its own signed
   * requests; those become the template every later API call is built from.
   */
  private async primeSigner(): Promise<void> {
    if (this.signer?.hasTemplate()) return;
    try {
      if (!this.page!.url().includes('/explore')) {
        await this.page!.goto(`${this.indexUrl}/explore`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
      const ready = await this.signer!.waitForTemplate(15000);
      console.log(ready
        ? '[XHS] Signed request template captured; API mode enabled.'
        : '[XHS] No signed request captured yet; will retry after the first UI search.');
    } catch (error: any) {
      console.warn(`[XHS] Failed to prime the signer: ${error.message}`);
    }
  }

  private async handleLogin(): Promise<void> {
    console.log('[XHS] Verifying login status...');
    await this.page!.waitForTimeout(LOGIN_INITIAL_SETTLE_MS);
    const startedAt = Date.now();
    let loginControlClicked = false;
    let loginNotificationSent = false;

    while (Date.now() - startedAt < MANUAL_LOGIN_TIMEOUT_MS) {
      const state = await this.inspectLoginState();
      if (state === 'verification') {
        await this.waitForManualVerification('小红书要求完成账号或设备安全验证');
        continue;
      }
      if (state === 'authenticated') {
        await this.page!.waitForTimeout(LOGIN_SUCCESS_SETTLE_MS);
        const stableState = await this.inspectLoginState();
        if (stableState === 'verification') {
          await this.waitForManualVerification('登录后触发小红书安全确认');
          continue;
        }
        if (stableState !== 'unauthenticated') {
          console.log(loginNotificationSent ? '[XHS] Login successful and session stabilized.' : '[XHS] Login confirmed.');
          if (loginNotificationSent) notifyLoginSuccess('xhs');
          return;
        }
      }

      if (state === 'unauthenticated' && !loginControlClicked) {
        loginControlClicked = await this.clickExplicitLoginControl();
      }
      if ((state === 'unauthenticated' || Date.now() - startedAt > 10_000) && !loginNotificationSent) {
        const reason = state === 'unauthenticated'
          ? '小红书明确显示当前会话未登录，请在采集浏览器中完成登录'
          : '小红书登录状态暂时无法确认，请在采集浏览器中检查登录或验证页面';
        notifyLoginRequired('xhs', reason);
        loginNotificationSent = true;
      }
      await this.page!.waitForTimeout(1_000);
    }

    throw new Error('小红书登录或安全验证等待超时。请在内置采集浏览器中完成验证后重新运行任务。');
  }

  /** Authentication cookie names from the Electron page's actual session partition. */
  private async authCookieNames(): Promise<string[] | null> {
    if (!this.page || !this.browserContext) return null;
    try {
      if (!this.cdpSession) this.cdpSession = await this.browserContext.newCDPSession(this.page);
      const { cookies } = await this.cdpSession.send('Network.getCookies', {
        urls: [this.indexUrl, `https://${this.apiHost}`],
      });
      return (cookies || [])
        .filter((cookie: any) => XHS_AUTH_COOKIES.has(cookie.name) && String(cookie.value || '').trim().length > 0)
        .map((cookie: any) => cookie.name);
    } catch (error: any) {
      console.warn(`[XHS] Failed to inspect partition cookies through CDP: ${error?.message || error}`);
      this.cdpSession = null;
      return null;
    }
  }

  /** Positive account evidence must come from the site chrome, not an author card in the feed. */
  private async hasAccountProfileEvidence(): Promise<boolean> {
    if (!this.page) return false;
    return this.page.evaluate(() => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/user/profile/"]')).some((link) => {
      if (link.getClientRects().length === 0) return false;
      const href = link.getAttribute('href') || '';
      if (!/\/user\/profile\/[^/?#]+/.test(href)) return false;
      if (href.includes('parent_page_channel_type=web_profile_board')) return true;
      return Boolean(link.closest('header, nav, aside, [class*="sidebar"], [class*="side-bar"], [class*="channel-list"]'));
    })).catch(() => false);
  }

  /** Only an exact, visible login control in account/navigation chrome is negative evidence. */
  private async hasExplicitLoginPrompt(): Promise<boolean> {
    if (!this.page) return false;
    const legacyButton = this.page.locator('xpath=//*[@id="app"]/div[1]/div[2]/div[1]/ul/div[1]/button');
    if (await legacyButton.isVisible({ timeout: 300 }).catch(() => false)) return true;
    return this.page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('button, a')).some((element) => {
      if (element.textContent?.trim() !== '登录' || element.getClientRects().length === 0) return false;
      const excluded = element.closest('[class*="comment"], [class*="note-item"], [class*="feed-card"]');
      if (excluded) return false;
      return Boolean(element.closest('header, nav, aside, [class*="sidebar"], [class*="side-bar"], [class*="login"]'));
    })).catch(() => false);
  }

  private async clickExplicitLoginControl(): Promise<boolean> {
    if (!this.page || !(await this.hasExplicitLoginPrompt())) return false;
    const selectors = [
      'xpath=//*[@id="app"]/div[1]/div[2]/div[1]/ul/div[1]/button',
      'header button, header a, nav button, nav a, aside button, aside a',
      '[class*="sidebar"] button, [class*="sidebar"] a, [class*="side-bar"] button, [class*="side-bar"] a',
      '[class*="login"] button, [class*="login"] a',
    ];
    for (const selector of selectors) {
      const candidates = this.page.locator(selector);
      const count = Math.min(await candidates.count().catch(() => 0), 100);
      for (let index = 0; index < count; index++) {
        const candidate = candidates.nth(index);
        const text = (await candidate.textContent().catch(() => ''))?.trim();
        if (selector !== selectors[0] && text !== '登录') continue;
        if (!(await candidate.isVisible().catch(() => false))) continue;
        await candidate.click({ timeout: 2_000 }).catch(() => {});
        console.log('[XHS] Opened the explicit account login control.');
        return true;
      }
    }
    return false;
  }

  private async hasManualVerification(): Promise<boolean> {
    if (!this.page) return false;
    const selectors = [
      '[class*="captcha"]',
      '[class*="verify-modal"]',
      '[class*="risk-modal"]',
      'iframe[src*="captcha"]',
      'iframe[src*="verify"]',
    ];
    for (const selector of selectors) {
      if (await this.page.isVisible(selector, { timeout: 250 }).catch(() => false)) return true;
    }
    const text = await this.page.locator('body').innerText({ timeout: 1_000 }).catch(() => '');
    return /账号异常|登录环境异常|设备异常|安全验证|风险验证|扫码确认|确认当前登录|验证当前设备/.test(text);
  }

  /** A normal QR/phone login dialog can sit above cached account chrome. */
  private async hasVisibleLoginDialog(): Promise<boolean> {
    if (!this.page) return false;
    return this.page.evaluate(() => {
      const selectors = [
        '[role="dialog"]',
        '.login-container',
        '[class*="login-modal"]',
        '[class*="login-container"]',
        '[class*="qrcode"]',
        '[class*="qr-code"]',
      ];
      return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(','))).some((element) => {
        if (element.getClientRects().length === 0) return false;
        const text = element.innerText || element.textContent || '';
        const hasLoginText = /扫码登录|手机号登录|验证码登录|密码登录|请使用小红书.*扫码|登录后/.test(text);
        const hasLoginMechanism = Boolean(element.querySelector(
          'input[type="tel"], input[placeholder*="手机号"], canvas, img[src*="qr"], [class*="qrcode"], [class*="qr-code"]',
        ));
        return hasLoginText && hasLoginMechanism;
      });
    }).catch(() => false);
  }

  private async inspectLoginState(): Promise<XhsLoginState> {
    if (!this.page) return 'unknown';
    if (await this.hasManualVerification()) return 'verification';
    // The login modal overlays a still-hydrated account page. It must win over
    // profile links and cookies or we start crawling behind the QR code.
    if (await this.hasVisibleLoginDialog()) return 'unauthenticated';
    if (await this.hasAccountProfileEvidence()) {
      this.lastPositiveLoginAt = Date.now();
      console.log('[XHS] Login state confirmed via account profile chrome.');
      return 'authenticated';
    }

    const cookieNames = await this.authCookieNames();
    const explicitLogin = this.page.url().includes('/login') || await this.hasExplicitLoginPrompt();
    if (explicitLogin) return 'unauthenticated';
    if (cookieNames?.length) {
      this.lastPositiveLoginAt = Date.now();
      console.log(`[XHS] Login state confirmed via partition cookies (${cookieNames.join(', ')}).`);
      return 'authenticated';
    }
    if (Date.now() - this.lastPositiveLoginAt < 30_000) {
      console.log('[XHS] Retaining recently confirmed login state while account chrome is loading.');
      return 'authenticated';
    }
    return 'unknown';
  }

  private async waitForManualVerification(reason: string): Promise<void> {
    console.warn(`[XHS] Manual verification detected: ${reason}`);
    notifyManualVerificationRequired('xhs', reason);
    const startedAt = Date.now();
    let stablePasses = 0;
    while (Date.now() - startedAt < MANUAL_VERIFICATION_TIMEOUT_MS) {
      if (await this.hasManualVerification()) {
        stablePasses = 0;
      } else {
        stablePasses++;
        if (stablePasses >= 2) {
          notifyManualVerificationSuccess('xhs');
          console.log('[XHS] Manual verification completed; waiting for the account session to stabilize.');
          await this.page!.waitForTimeout(LOGIN_SUCCESS_SETTLE_MS);
          return;
        }
      }
      await this.page!.waitForTimeout(1_000);
    }

    throw new Error('小红书安全验证等待超时。请完成验证后重新运行任务。');
  }

  private async openSearchInput(timeoutMs = 15_000): Promise<Locator> {
    // Prefer the site's stable search ids one by one. A selector union is
    // returned in DOM order rather than selector order, so a broad
    // `input[placeholder*="搜索"]` can accidentally win over the main search
    // box and submit an unrelated control elsewhere on the page.
    const directSelectors = [
      'textarea#search-input:visible',
      'textarea#search-input-in-feeds:visible',
      'input#search-input:visible',
      'input#search-input-in-feeds:visible',
    ];
    for (const selector of directSelectors) {
      const input = this.page!.locator(selector).first();
      if (await input.isVisible({ timeout: 300 }).catch(() => false)) return input;
    }

    const searchBox = this.page!.locator('.input-box.search-box-in-content').first();
    await searchBox.waitFor({ state: 'visible', timeout: timeoutMs });
    await searchBox.click();
    const scopedInput = searchBox.locator('textarea:visible, input:visible').first();
    await scopedInput.waitFor({ state: 'visible', timeout: 10_000 });
    return scopedInput;
  }

  /** Ignore restored searches, lazy-loads and other in-flight search requests. */
  private isSearchResponseForKeyword(response: any, keyword: string, page = 1): boolean {
    const request = response.request();
    if (request.method() !== 'POST' || !response.url().includes('/api/sns/web/v2/search/notes')) return false;
    try {
      const body = request.postDataJSON();
      return String(body?.keyword || '').trim() === keyword.trim()
        && Number(body?.page ?? 1) === page;
    } catch {
      return false;
    }
  }

  /** Login can be invalidated after the initial check; recover instead of timing out behind the modal. */
  private async openSearchInputWithAuthRecovery(): Promise<Locator> {
    const initialState = await this.inspectLoginState();
    if (initialState === 'unauthenticated' || initialState === 'verification') {
      console.warn(`[XHS] Search UI is blocked by login state (${initialState}); returning to the authentication flow.`);
      await this.recoverSearchAuthentication();
      return this.openSearchInput(30_000);
    }

    try {
      return await this.openSearchInput();
    } catch (error) {
      const state = await this.inspectLoginState();
      if (state === 'authenticated') throw error;
      console.warn(`[XHS] Search UI is blocked by login state (${state}); returning to the authentication flow.`);
      await this.recoverSearchAuthentication();
      return this.openSearchInput(30_000);
    }
  }

  private async recoverSearchAuthentication(): Promise<void> {
    await this.handleLogin();
    if (!this.page!.url().includes('/explore')) {
      await this.page!.goto(`${this.indexUrl}/explore`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    await this.page!.waitForTimeout(LOGIN_INITIAL_SETTLE_MS);
  }

  public async search(): Promise<void> {
    console.log('[XHS] Beginning keyword search...');
    const keywords = activeConfig.KEYWORDS.split(',');
    const indexUrl = this.indexUrl;

    for (const keyword of keywords) {
      console.log(`[XHS] Searching keyword: ${keyword}`);
      
      try {
        // Xiaohongshu's current web app no longer reliably accepts direct
        // navigation to /search_result. Use the homepage search box so the app
        // creates its signed request to the current v2 API on so.xiaohongshu.com.
        if (!this.page!.url().startsWith(`${indexUrl}/explore`)) {
          await this.page!.goto(indexUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        const searchInput = await this.openSearchInputWithAuthRecovery();
        await searchInput.fill(keyword);
        const submittedKeyword = (await searchInput.inputValue()).trim();
        if (submittedKeyword !== keyword.trim()) {
          throw new Error(`Search input mismatch: expected "${keyword.trim()}", got "${submittedKeyword}"`);
        }

        const [searchResponse] = await Promise.all([
          this.page!.waitForResponse(
            (response) => this.isSearchResponseForKeyword(response, keyword, 1),
            { timeout: 30000 },
          ),
          searchInput.press('Enter'),
        ]);

        if (!searchResponse.ok()) {
          throw new Error(`Search request returned HTTP ${searchResponse.status()}`);
        }

        const searchResult = await searchResponse.json();
        if (!searchResult?.success) {
          throw new Error(`Search API rejected the request: ${searchResult?.msg || searchResult?.code || 'unknown error'}`);
        }

        const notes = searchResult.data?.items;
        if (!Array.isArray(notes)) throw new Error('Search API returned an invalid items payload');

        console.log(`[XHS] Initial page returned ${notes.length} notes.`);
        let count = 0;
        let pageIndex = 1;
        const targetCount = activeConfig.CRAWLER_MAX_NOTES_COUNT || 20;
        const seenNoteIds = new Set<string>();
        let pagesWithoutNewNotes = 0;
        let hasMore = searchResult.data?.has_more !== false && searchResult.data?.has_more !== 0;

        let currentNotes = notes;
        while (currentNotes.length > 0 && count < targetCount) {
          const before = count;
          console.log(`[XHS] Processing page ${pageIndex} (${currentNotes.length} notes, collected ${count}/${targetCount})...`);
          for (const item of currentNotes) {
            if (count >= targetCount) break;
            if (item.model_type === 'rec_query' || item.model_type === 'hot_query') continue;

            const card = item.note_card || item;
            const noteId = item.id || item.note_id || card.note_id;
            if (!noteId || seenNoteIds.has(String(noteId))) continue;
            seenNoteIds.add(String(noteId));

            const user = card.user || item.user || {};
            const interactInfo = card.interact_info || item.interact_info || {};
            const imageUrls = (card.image_list || item.image_list || [])
              .map((image: any) => image.url || image.url_default || image.info_list?.[0]?.url || '')
              .filter(Boolean);
            const coverUrl = card.cover?.url_default || card.cover?.url_pre || card.cover?.url || card.cover?.info_list?.[0]?.url || imageUrls[0] || '';
            if (imageUrls.length === 0 && coverUrl) {
              imageUrls.push(coverUrl);
            }

            const noteDetail = {
              note_id: noteId,
              type: card.type === 'video' ? 'video' : 'normal',
              title: card.display_title || card.title || item.title || '',
              desc: card.desc || item.desc || '',
              video_url: '',
              cover_url: coverUrl,
              time: card.time || item.time || Math.floor(Date.now() / 1000),
              last_update_time: Math.floor(Date.now() / 1000),
              creator_hash: user.user_id || user.id || '',
              nickname: user.nickname || user.nick_name || '',
              liked_count: interactInfo.liked_count || 0,
              collected_count: interactInfo.collected_count || 0,
              comment_count: interactInfo.comment_count || 0,
              share_count: interactInfo.shared_count || interactInfo.share_count || 0,
              image_list: imageUrls.filter(Boolean).join(','),
              tag_list: '',
              note_url: `${indexUrl}/explore/${noteId}?xsec_token=${encodeURIComponent(item.xsec_token || '')}&xsec_source=pc_search`,
              source_keyword: keyword,
              xsec_token: item.xsec_token || '',
            };

            await connectorOutput.emitXhsNote(noteDetail);
            count++;

            // Crawl comments if enabled
            if (activeConfig.ENABLE_GET_COMMENTS) {
              await this.crawlComments(noteDetail.note_id, noteDetail.xsec_token);
            }

            await this.humanDelay(this.page!);
          }

          if (count >= targetCount) break;
          pagesWithoutNewNotes = count === before ? pagesWithoutNewNotes + 1 : 0;
          if (!hasMore || pagesWithoutNewNotes >= 2) break;

          pageIndex++;
          const nextPage = await this.fetchSearchPage(keyword, pageIndex, count, targetCount);
          currentNotes = nextPage.items;
          hasMore = nextPage.hasMore;
        }
        reportKeywordSearchCompletion('小红书', keyword, count, targetCount,
          hasMore ? '连续页面没有新增唯一内容或翻页请求中断' : '平台已返回当前可见末页');
      } catch (err: any) {
        console.error(`[XHS] Error searching keyword ${keyword}:`, err.message);
        throw err;
      }
    }
  }

  /**
   * Page 1 comes from the UI so the app produces a signed request we can clone;
   * every later page is a direct signed API call, which avoids the scroll race
   * and is roughly an order of magnitude faster.
   */
  private async fetchSearchPage(
    keyword: string,
    pageIndex: number,
    collected: number,
    targetCount: number,
  ): Promise<{ items: any[]; hasMore: boolean }> {
    const bodyTemplate = this.signer?.getSearchBodyTemplate();
    if (this.signer?.hasTemplate() && bodyTemplate) {
      try {
        console.log(`[XHS] Requesting search page ${pageIndex} via signed API (${collected}/${targetCount})...`);
        const payload = await this.signer.request<any>({
          host: this.apiHost,
          path: '/api/sns/web/v2/search/notes',
          method: 'POST',
          body: { ...bodyTemplate, keyword, page: pageIndex },
        });
        return {
          items: payload?.data?.items || [],
          hasMore: payload?.data?.has_more !== false && payload?.data?.has_more !== 0,
        };
      } catch (error: any) {
        console.warn(`[XHS] Signed search pagination failed, falling back to scrolling: ${error.message}`);
      }
    }

    console.log(`[XHS] Scrolling to fetch search page ${pageIndex} (${collected}/${targetCount})...`);
    try {
      const [nextResponse] = await Promise.all([
        this.page!.waitForResponse((response) => {
          const url = response.url();
          return response.request().method() === 'POST' && url.includes('/api/sns/web/v2/search/notes');
        }, { timeout: 8000 }),
        this.page!.evaluate(() => window.scrollBy(0, 3000)),
      ]);
      const nextData = await nextResponse.json();
      return {
        items: nextData.data?.items || [],
        hasMore: nextData.data?.has_more !== false && nextData.data?.has_more !== 0,
      };
    } catch {
      console.log('[XHS] No further search pages returned or scroll timeout.');
      return { items: [], hasMore: false };
    }
  }

  private async crawlComments(noteId: string, xsecToken: string): Promise<void> {
    console.log(`[XHS] Crawling comments for note: ${noteId}`);
    if (!this.signer?.hasTemplate()) {
      console.warn('[XHS] No signed request template captured yet; skipping comments.');
      return;
    }

    const maxComments = activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES;
    let cursor = '';
    let count = 0;
    let emptyFirstPage = false;

    try {
      while (count < maxComments) {
        const query = new URLSearchParams({
          note_id: noteId,
          cursor,
          top_comment_id: '',
          image_formats: 'jpg,webp,avif',
          xsec_token: xsecToken,
        });
        const payload = await this.signer.request<any>({
          host: this.apiHost,
          path: `/api/sns/web/v2/comment/page?${query.toString()}`,
        });

        const comments = payload?.data?.comments || [];
        if (comments.length === 0) {
          emptyFirstPage = cursor === '';
          break;
        }
        console.log(`[XHS] Crawled ${comments.length} comments (total ${count + comments.length}).`);

        for (const commentItem of comments) {
          if (count >= maxComments) break;

          const dbComment = {
            comment_id: commentItem.id,
            create_time: commentItem.create_time,
            note_id: noteId,
            content: commentItem.content,
            creator_hash: commentItem.user_info?.user_id || '',
            nickname: commentItem.user_info?.nickname || '',
            sub_comment_count: Number(commentItem.sub_comment_count) || 0,
            pictures: commentItem.pictures?.map((p: any) => p.url || '').join(',') || '',
            parent_comment_id: '',
            like_count: commentItem.like_count || 0,
          };

          await connectorOutput.emitXhsComment(dbComment);
          count++;

          if (dbComment.sub_comment_count > 0) {
            count += await this.storeSubComments(
              noteId, xsecToken, commentItem, maxComments - count,
            );
          }
        }

        if (!payload?.data?.has_more) break;
        cursor = payload.data.cursor || '';
        if (!cursor) break;
        await this.humanDelay(this.page!);
      }
      // Xiaohongshu answers an unauthenticated session with an empty comment list
      // and HTTP 461 rather than an error, so "0 comments" would otherwise look
      // like a note nobody replied to. Say which one it actually is.
      if (emptyFirstPage) {
        console.warn(`[XHS] Note ${noteId} returned no comments on the first page — `
          + '若该笔记确有评论，通常是当前会话未登录或触发风控，小红书对这类请求返回空列表而非报错。');
      }
    } catch (err: any) {
      console.error(`[XHS] Error crawling comments for note ${noteId}:`, err.message);
    }
  }

  /**
   * Store a root comment's replies, and return how many were stored.
   *
   * The comment/page response already carries the first reply of every root
   * comment inline (`sub_comments`), so that one is free. `/comment/sub/page` is
   * designed to continue from there — it takes `sub_comment_cursor` from the root
   * — which is why it used to be called with an empty cursor and a hard `num=10`:
   * a root with 29 replies could never yield more than 10, and the same reply was
   * fetched twice. Now the inline one is kept and the cursor is followed until the
   * platform says there is no more or the note's comment budget is used up.
   */
  private async storeSubComments(
    noteId: string,
    xsecToken: string,
    rootComment: any,
    budget: number,
  ): Promise<number> {
    const rootCommentId = String(rootComment.id || '');
    if (!rootCommentId || budget <= 0) return 0;

    let stored = 0;
    const emit = async (sub: any) => {
      await connectorOutput.emitXhsComment({
        comment_id: sub.id,
        create_time: sub.create_time,
        note_id: noteId,
        content: sub.content,
        creator_hash: sub.user_info?.user_id || '',
        nickname: sub.user_info?.nickname || '',
        sub_comment_count: 0,
        pictures: sub.pictures?.map((p: any) => p.url || '').join(',') || '',
        parent_comment_id: rootCommentId,
        like_count: sub.like_count || 0,
      });
      stored++;
    };

    const seen = new Set<string>();
    for (const sub of rootComment.sub_comments || []) {
      if (stored >= budget) return stored;
      if (sub?.id) seen.add(String(sub.id));
      await emit(sub);
    }

    // Nothing left behind the inline reply — no request needed at all.
    if (!rootComment.sub_comment_has_more) return stored;

    let cursor = String(rootComment.sub_comment_cursor || '');
    try {
      while (stored < budget) {
        const query = new URLSearchParams({
          note_id: noteId,
          root_comment_id: rootCommentId,
          num: String(Math.min(10, budget - stored)),
          cursor,
          image_formats: 'jpg,webp,avif',
          xsec_token: xsecToken,
        });
        const payload = await this.signer!.request<any>({
          host: this.apiHost,
          path: `/api/sns/web/v2/comment/sub/page?${query.toString()}`,
        });
        const subComments = payload?.data?.comments || [];
        if (!subComments.length) break;

        for (const sub of subComments) {
          if (stored >= budget) break;
          const id = String(sub?.id || '');
          if (id && seen.has(id)) continue;
          if (id) seen.add(id);
          await emit(sub);
        }

        if (!payload?.data?.has_more) break;
        const next = String(payload?.data?.cursor || '');
        if (!next || next === cursor) break;
        cursor = next;
        await this.humanDelay(this.page!);
      }
    } catch (err: any) {
      console.error(`[XHS] Error crawling sub comments of ${rootCommentId}:`, err.message);
    }
    return stored;
  }

  public async getSpecifiedNotes(): Promise<void> {
    for (const target of configuredTargets('xhs', 'detail')) await this.fetchNoteDetail(target);
  }

  public async getCreatorsAndNotes(): Promise<void> {
    const indexUrl = this.indexUrl;
    for (const target of configuredTargets('xhs', 'creator')) {
      const resolved = await resolveRedirect(this.page!, target);
      const creatorId = firstMatch(resolved, [/\/user\/profile\/([^/?#]+)/i, /[?&]user_id=([^&#]+)/i]);
      const xsecToken = resolved.match(/[?&]xsec_token=([^&#]+)/i)?.[1] || '';
      const xsecSource = resolved.match(/[?&]xsec_source=([^&#]+)/i)?.[1] || 'pc_user';
      const profileUrl = `${indexUrl}/user/profile/${encodeURIComponent(creatorId)}`
        + `${xsecToken ? `?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=${encodeURIComponent(xsecSource)}` : ''}`;
      await this.page!.goto(profileUrl, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(2200);

      let unique = await this.listCreatorNotesViaApi(creatorId, xsecToken, xsecSource);
      if (unique === null) {
        console.warn(`[XHS] Creator API unavailable for ${creatorId}; falling back to profile scrolling.`);
        unique = await this.listCreatorNotesViaDom();
      }
      console.log(`[XHS] Creator ${creatorId}: discovered ${unique.length} works`);
      for (const note of unique) await this.fetchNoteDetail(note.href, `创作者:${creatorId}`);
    }
  }

  /** Cursor through the signed creator feed until it reports has_more=false. */
  private async listCreatorNotesViaApi(
    creatorId: string,
    xsecToken: string,
    xsecSource: string,
  ): Promise<Array<{ id: string; href: string }> | null> {
    if (!this.signer?.hasTemplate()) return null;
    const limit = creatorItemLimit();
    const notes = new Map<string, { id: string; href: string }>();
    const seenCursors = new Set<string>();
    let cursor = '';
    try {
      while (!creatorLimitReached(notes.size, limit)) {
        if (seenCursors.has(cursor)) {
          console.warn(`[XHS] Creator cursor repeated (${cursor || '<first>'}); stopping to avoid a loop.`);
          break;
        }
        seenCursors.add(cursor);
        const query = new URLSearchParams({
          num: '30', cursor, user_id: creatorId,
          image_formats: 'jpg,webp,avif', xsec_token: xsecToken, xsec_source: xsecSource,
        });
        const payload = await this.signer.request<any>({
          host: this.apiHost,
          path: `/api/sns/web/v1/user_posted?${query.toString()}`,
        });
        const batch = payload?.data?.notes || [];
        const before = notes.size;
        for (const item of batch) {
          const id = String(item.note_id || item.id || '');
          if (!id) continue;
          const token = String(item.xsec_token || '');
          notes.set(id, {
            id,
            href: `${this.indexUrl}/explore/${id}`
              + `${token ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_user` : ''}`,
          });
          if (creatorLimitReached(notes.size, limit)) break;
        }
        const hasMore = Boolean(payload?.data?.has_more);
        const nextCursor = String(payload?.data?.cursor || '');
        if (!hasMore || !batch.length || notes.size === before || !nextCursor) break;
        cursor = nextCursor;
        await this.humanDelay(this.page!);
      }
      return [...notes.values()];
    } catch (error: any) {
      console.warn(`[XHS] Creator pagination failed: ${error.message}`);
      return notes.size ? [...notes.values()] : null;
    }
  }

  /** Browser-driven fallback; the page itself signs every lazy-load request. */
  private async listCreatorNotesViaDom(): Promise<Array<{ id: string; href: string }>> {
    const limit = creatorItemLimit();
    const notes = new Map<string, { id: string; href: string }>();
    let stagnantRounds = 0;
    while (!creatorLimitReached(notes.size, limit) && stagnantRounds < 4) {
      const visible = await this.page!.evaluate(() => Array.from(document.querySelectorAll('a[href*="/explore/"]')).map((link) => {
        const href = link.getAttribute('href') || '';
        return { href, id: href.match(/\/explore\/([^/?#]+)/)?.[1] || '' };
      }).filter((item) => item.id));
      const before = notes.size;
      for (const note of visible) {
        notes.set(note.id, note);
        if (creatorLimitReached(notes.size, limit)) break;
      }
      stagnantRounds = notes.size > before ? 0 : stagnantRounds + 1;
      if (!creatorLimitReached(notes.size, limit)) {
        await this.page!.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await this.page!.waitForTimeout(1400);
      }
    }
    return [...notes.values()];
  }

  /**
   * Structured note detail from the signed feed API. Returns null so the caller
   * can fall back to DOM scraping when signing or the endpoint is unavailable.
   */
  private async fetchNoteDetailFromApi(
    noteId: string,
    xsecToken: string,
    noteUrl: string,
    sourceKeyword?: string,
  ): Promise<any | null> {
    if (!this.signer?.hasTemplate()) return null;
    try {
      const payload = await this.signer.request<any>({
        host: this.apiHost,
        path: '/api/sns/web/v1/feed',
        method: 'POST',
        body: {
          source_note_id: noteId,
          image_formats: ['jpg', 'webp', 'avif'],
          extra: { need_body_topic: '1' },
          xsec_source: 'pc_search',
          xsec_token: xsecToken,
        },
      });

      const card = payload?.data?.items?.[0]?.note_card;
      if (!card) return null;

      const interact = card.interact_info || {};
      const images = (card.image_list || [])
        .map((image: any) => image.url_default || image.url || image.info_list?.[0]?.url || '')
        .filter(Boolean);
      const coverUrl = card.cover?.url_default || card.cover?.url_pre || card.cover?.url || card.cover?.info_list?.[0]?.url || images[0] || '';
      if (images.length === 0 && coverUrl) {
        images.push(coverUrl);
      }
      const videoUrl = card.video?.media?.stream?.h264?.[0]?.master_url
        || card.video?.media?.stream?.h265?.[0]?.master_url
        || '';

      return {
        note_id: noteId,
        type: card.type === 'video' ? 'video' : 'normal',
        title: card.title || '',
        desc: card.desc || '',
        video_url: videoUrl,
        cover_url: coverUrl,
        time: card.time || Math.floor(Date.now() / 1000),
        last_update_time: card.last_update_time || Math.floor(Date.now() / 1000),
        creator_hash: card.user?.user_id || '',
        nickname: card.user?.nickname || '',
        liked_count: Number(interact.liked_count) || 0,
        collected_count: Number(interact.collected_count) || 0,
        comment_count: Number(interact.comment_count) || 0,
        share_count: Number(interact.share_count ?? interact.shared_count) || 0,
        image_list: [...new Set<string>(images)].join(','),
        tag_list: (card.tag_list || []).map((tag: any) => tag.name || '').filter(Boolean).join(','),
        note_url: noteUrl,
        source_keyword: sourceKeyword,
        xsec_token: xsecToken,
      };
    } catch (error: any) {
      console.warn(`[XHS] Signed detail request failed for ${noteId}, falling back to DOM: ${error.message}`);
      return null;
    }
  }

  private async fetchNoteDetail(target: string, sourceKeyword?: string): Promise<any | null> {
    const indexUrl = this.indexUrl;
    const resolved = await resolveRedirect(this.page!, target);
    const noteId = firstMatch(resolved, [/\/explore\/([^/?#]+)/i, /\/discovery\/item\/([^/?#]+)/i, /[?&]note_id=([^&#]+)/i]);
    const xsecToken = resolved.match(/[?&]xsec_token=([^&#]+)/i)?.[1] || '';
    const noteUrl = /^https?:\/\//i.test(resolved) && resolved.includes(noteId)
      ? resolved
      : `${indexUrl}/explore/${encodeURIComponent(noteId)}${xsecToken ? `?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_user` : ''}`;

    const apiRecord = await this.fetchNoteDetailFromApi(noteId, xsecToken, noteUrl, sourceKeyword);
    if (apiRecord) {
      await connectorOutput.emitXhsNote(apiRecord);
      if (activeConfig.ENABLE_GET_COMMENTS) await this.crawlComments(noteId, xsecToken);
      return apiRecord;
    }

    try {
      if (this.page!.url() !== noteUrl) await this.page!.goto(noteUrl, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(1800);
      const detail = await this.page!.evaluate((expectedId) => {
        const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() || '';
        const attr = (selector: string, name: string) => document.querySelector(selector)?.getAttribute(name) || '';
        const parseMetric = (value: string) => {
          const normalized = value.replace(/,/g, '').trim();
          if (normalized.includes('万')) return Math.round((parseFloat(normalized) || 0) * 10000);
          return Number(normalized.match(/\d+/)?.[0] || 0);
        };
        const authorLink = document.querySelector('a[href*="/user/profile/"]');
        const images = Array.from(document.querySelectorAll('.note-slider img, .swiper-slide img, meta[property="og:image"]'))
          .map((node) => node.getAttribute(node.tagName === 'META' ? 'content' : 'src') || '').filter(Boolean);
        const stats = Array.from(document.querySelectorAll('.interact-container span, [class*="engage"] span')).map((node) => node.textContent?.trim() || '');
        return {
          id: expectedId,
          title: text('#detail-title, .title') || attr('meta[property="og:title"]', 'content'),
          desc: text('#detail-desc, .desc') || attr('meta[property="og:description"]', 'content'),
          nickname: text('.author-wrapper .name, .username') || attr('meta[name="author"]', 'content'),
          creatorId: authorLink?.getAttribute('href')?.match(/\/user\/profile\/([^/?#]+)/)?.[1] || '',
          images,
          likes: parseMetric(stats[0] || ''), collects: parseMetric(stats[1] || ''), comments: parseMetric(stats[2] || ''),
          video: attr('video', 'src') || attr('meta[property="og:video"]', 'content'),
        };
      }, noteId);
      const coverUrl = detail.images[0] || '';
      const record = {
        note_id: noteId, type: detail.video ? 'video' : 'normal', title: detail.title || '', desc: detail.desc || '',
        video_url: detail.video || '', cover_url: coverUrl, time: Math.floor(Date.now() / 1000), last_update_time: Math.floor(Date.now() / 1000),
        creator_hash: detail.creatorId || '', nickname: detail.nickname || '', liked_count: detail.likes || 0,
        collected_count: detail.collects || 0, comment_count: detail.comments || 0, share_count: 0,
        image_list: [...new Set(detail.images || [])].join(','), tag_list: '', note_url: noteUrl,
        source_keyword: sourceKeyword, xsec_token: xsecToken,
      };
      await connectorOutput.emitXhsNote(record);
      if (activeConfig.ENABLE_GET_COMMENTS) await this.crawlComments(noteId, xsecToken);
      return record;
    } catch (error: any) {
      console.error(`[XHS] Failed to collect detail ${target}: ${error.message}`);
      return null;
    }
  }

}
