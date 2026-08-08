import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyLoginRequired,
  notifyLoginSuccess,
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

export class XiaoHongShuCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  private signer: XhsSigner | null = null;

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
    if (activeConfig.LOGIN_TYPE === 'cookie' && activeConfig.COOKIES) {
      console.log('[XHS] Logging in via cookies...');
      const cookieDict = this.parseCookies(activeConfig.COOKIES);
      const domain = activeConfig.XHS_INTERNATIONAL ? '.rednote.com' : '.xiaohongshu.com';
      
      const cookiesToSet = Object.entries(cookieDict).map(([name, value]) => ({
        name,
        value,
        domain,
        path: '/',
      }));
      
      await this.browserContext!.addCookies(cookiesToSet);
      await this.page!.reload({ waitUntil: 'domcontentloaded' });
    }

    // Wait for manual login or verification if needed
    let isLoggedIn = await this.checkLoginState();
    if (!isLoggedIn) {
      console.log('[XHS] User is not logged in. Waiting up to 120 seconds for manual login (QR Code scan)...');
      
      // Try to open login dialog if not popped up
      try {
        const loginBtnSelectors = [
          'xpath=//*[@id="app"]/div[1]/div[2]/div[1]/ul/div[1]/button',
          'button:has-text("登录")',
          '.login-btn',
          '.login-button',
          'a:has-text("登录")',
          'span:has-text("登录")'
        ];
        for (const selector of loginBtnSelectors) {
          try {
            const btn = this.page!.locator(selector);
            if (await btn.isVisible({ timeout: 1000 })) {
              await btn.click({ timeout: 2000 });
              break;
            }
          } catch {}
        }
      } catch {
        // Ignored, might already be open
      }

      notifyLoginRequired('xhs', '小红书当前会话未登录，需要在采集浏览器中确认或完成登录');

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[XHS] Login successful!');
          notifyLoginSuccess('xhs');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!isLoggedIn) {
        throw new Error('小红书登录等待超时。请在内置采集浏览器中完成登录后重新运行任务。');
      }
    } else {
      console.log('[XHS] Login confirmed.');
    }
  }

  private async checkLoginState(): Promise<boolean> {
    // 1. Wait a bit for page load to stabilize
    await this.page!.waitForTimeout(1000);

    // 2. Check logged-out indicators first. Public navigation items such as
    // "/publish" can be visible to visitors and must not be used as proof of login.
    if (this.page!.url().includes('/login')) {
      return false;
    }

    const loginSelectors = [
      'xpath=//*[@id="app"]/div[1]/div[2]/div[1]/ul/div[1]/button',
      'button:has-text("登录")',
      'a:has-text("登录")',
      'span:has-text("登录")',
      '.login-btn',
      '.login-button',
      '.login-container'
    ];
    for (const selector of loginSelectors) {
      try {
        const visible = await this.page!.isVisible(selector, { timeout: 500 }).catch(() => false);
        if (visible) return false;
      } catch {}
    }

    // 3. A profile link with a concrete user id is account-specific.
    const profileSelector = "a[href*='/user/profile/']";
    try {
      const profileLinks = this.page!.locator(profileSelector);
      const count = await profileLinks.count();
      for (let index = 0; index < count; index++) {
        const link = profileLinks.nth(index);
        if (!(await link.isVisible().catch(() => false))) continue;

        const href = await link.getAttribute('href');
        if (href && /\/user\/profile\/[^/?#]+/.test(href)) {
          console.log(`[XHS] Login state confirmed via account profile link: ${href}`);
          return true;
        }
      }
    } catch {}

    // 4. A session cookie is the fallback when the responsive layout hides the
    // profile link. Logged-out UI above always takes precedence over this check.
    try {
      const cookies = await this.browserContext!.cookies();
      const hasWebSession = cookies.some((c) => c.name === 'web_session' && c.value.trim().length > 0);
      if (hasWebSession) {
        console.log('[XHS] Login state confirmed via cookies.');
        return true;
      }
    } catch (err: any) {
      console.error('[XHS] Error checking cookies:', err.message);
    }

    return false;
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

        const searchBox = this.page!.locator('.input-box.search-box-in-content').first();
        await searchBox.waitFor({ state: 'visible', timeout: 15000 });
        await searchBox.click();

        const searchInput = this.page!
          .locator('textarea#search-input:visible, textarea#search-input-in-feeds:visible')
          .first();
        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        await searchInput.fill(keyword);

        const [searchResponse] = await Promise.all([
          this.page!.waitForResponse((response) => {
            const url = response.url();
            return response.request().method() === 'POST'
              && url.includes('/api/sns/web/v2/search/notes');
          }, { timeout: 30000 }),
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
            if (imageUrls.length === 0 && card.cover) {
              imageUrls.push(card.cover.url_default || card.cover.url_pre || '');
            }

            const noteDetail = {
              note_id: noteId,
              type: card.type === 'video' ? 'video' : 'normal',
              title: card.display_title || card.title || item.title || '',
              desc: card.desc || item.desc || '',
              video_url: '',
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
    for (const target of configuredTargets('xhs', 'detail')) await this.fetchNoteDetail(target, '指定作品');
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
    sourceKeyword: string,
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
      const videoUrl = card.video?.media?.stream?.h264?.[0]?.master_url
        || card.video?.media?.stream?.h265?.[0]?.master_url
        || '';

      return {
        note_id: noteId,
        type: card.type === 'video' ? 'video' : 'normal',
        title: card.title || '',
        desc: card.desc || '',
        video_url: videoUrl,
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

  private async fetchNoteDetail(target: string, sourceKeyword: string): Promise<any | null> {
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
      const record = {
        note_id: noteId, type: detail.video ? 'video' : 'normal', title: detail.title || '', desc: detail.desc || '',
        video_url: detail.video || '', time: Math.floor(Date.now() / 1000), last_update_time: Math.floor(Date.now() / 1000),
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
}
