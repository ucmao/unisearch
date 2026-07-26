import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { configuredTargets, firstMatch, resolveRedirect, stripHtml } from '../base/connectorHelpers';

/** Search pages return ~10-15 posts each; this caps paging when CRAWLER_MAX_NOTES_COUNT is large. */
const WEIBO_SEARCH_MAX_PAGES = 10;

export class WeiboCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[WEIBO] Starting Weibo crawler (Electron CDP mode)...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'weibo');

    await this.page.goto('https://weibo.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    } else if (activeConfig.CRAWLER_TYPE === 'detail') {
      await this.getSpecifiedNotes();
    } else if (activeConfig.CRAWLER_TYPE === 'creator') {
      await this.getCreatorsAndNotes();
    }

    console.log('[WEIBO] Weibo crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[WEIBO] Checking login state...');
    if (activeConfig.LOGIN_TYPE === 'cookie' && activeConfig.COOKIES) {
      await this.applyCookieHeader(this.browserContext!, activeConfig.COOKIES, '.weibo.com');
      await this.page!.reload({ waitUntil: 'domcontentloaded' });
    }
    let isLoggedIn = await this.checkLoginState();
    
    if (!isLoggedIn && activeConfig.LOGIN_TYPE === 'qrcode') {
      console.log('[WEIBO] User is not logged in. Waiting for manual login...');
      try {
        await this.page!.click('.login-btn, .gn_login, button:has-text("登录"), a:has-text("登录")', { timeout: 3000 });
      } catch {}

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[WEIBO] Login successful!');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async checkLoginState(): Promise<boolean> {
    try {
      const url = this.page!.url();
      if (url.includes('newlogin') || url.includes('login')) {
        return false;
      }
      const hasPublishBox = await this.page!.isVisible('[placeholder*="有什么新鲜事"]', { timeout: 1000 });
      if (hasPublishBox) return true;
    } catch {}
    try {
      const isLoginBtn = await this.page!.isVisible('.login-btn, .gn_login, button:has-text("登录"), a:has-text("登录")', { timeout: 1000 });
      if (isLoginBtn) return false;
    } catch {}
    try {
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some((c) => c.name === 'SUB');
        if (hasSession) {
          const url = this.page!.url();
          if (url.includes('newlogin') || url.includes('login')) return false;
          const loginBtnExists = await this.page!.isVisible('.login-btn, .gn_login, button:has-text("登录"), a:has-text("登录")', { timeout: 1000 }).catch(() => false);
          if (loginBtnExists) return false;
          console.log('[WEIBO] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[WEIBO] Error checking cookies:', err.message);
    }
    return false;
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      const trimmed = keyword.trim();
      if (!trimmed) continue;
      console.log(`[WEIBO] Searching keyword: ${trimmed}`);
      try {
        const statuses = await this.executeHybrid(
          () => this.searchByMobileApi(trimmed),
          () => this.searchByDom(trimmed),
        );
        console.log(`[WEIBO] Found ${statuses.length} posts. Ingesting...`);

        // storeStatus may pull comments from weibo.com/ajax/*, which is same-origin only.
        if (activeConfig.ENABLE_GET_COMMENTS) {
          await this.page!.goto('https://weibo.com', { waitUntil: 'domcontentloaded' });
        }
        for (const status of statuses) {
          await this.storeStatus(status, trimmed);
          await this.humanDelay(this.page!);
        }
      } catch (err: any) {
        console.error(`[WEIBO] Search error for keyword ${trimmed}:`, err.message);
      }
    }
  }

  /**
   * Search via the mobile JSON API. Runs inside the page so the Sina visitor system
   * (genvisitor2 + device fingerprint) completes in a real browser and grants the
   * cookies the endpoint requires — no login needed for search.
   */
  private async searchByMobileApi(keyword: string): Promise<any[]> {
    const containerId = `100103type=1&q=${keyword}`;
    const searchPage = `https://m.weibo.cn/search?containerid=${encodeURIComponent(containerId)}`;
    await this.page!.goto(searchPage, { waitUntil: 'domcontentloaded' });

    const collected: any[] = [];
    const seen = new Set<string>();
    for (let pageNo = 1; pageNo <= WEIBO_SEARCH_MAX_PAGES; pageNo++) {
      let batch = await this.fetchMobileSearchPage(containerId, pageNo);
      if (batch === null) {
        // Visitor challenge served instead of JSON — reload the page to redo the handshake.
        await this.page!.goto(searchPage, { waitUntil: 'domcontentloaded' });
        batch = await this.fetchMobileSearchPage(containerId, pageNo);
      }
      if (batch === null) {
        console.warn(`[WEIBO] Visitor challenge unresolved on page ${pageNo}, stopping keyword "${keyword}".`);
        break;
      }
      if (!batch.length) break;

      for (const mblog of batch) {
        const noteId = String(mblog.mid || mblog.id || '');
        if (!noteId || seen.has(noteId)) continue;
        seen.add(noteId);
        collected.push(await this.normalizeMobileStatus(mblog));
        if (collected.length >= activeConfig.CRAWLER_MAX_NOTES_COUNT) return collected;
      }
      await this.humanDelay(this.page!);
    }
    return collected;
  }

  /** Returns the page's mblogs, or null when the visitor system intercepted the request. */
  private async fetchMobileSearchPage(containerId: string, pageNo: number): Promise<any[] | null> {
    const apiUrl = `https://m.weibo.cn/api/container/getIndex?containerid=${encodeURIComponent(containerId)}&page_type=searchall&page=${pageNo}`;
    const payload = await this.page!.evaluate(async (url) => {
      const response = await fetch(url, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const body = await response.text();
      if (!body.trim().startsWith('{')) return null;
      return JSON.parse(body);
    }, apiUrl);

    if (payload === null) return null;
    if (payload.ok !== 1) return [];

    // card_type 9 carries one mblog; card_type 11 groups several under card_group.
    const mblogs: any[] = [];
    for (const card of payload?.data?.cards || []) {
      if (card.mblog) mblogs.push(card.mblog);
      for (const child of card.card_group || []) if (child.mblog) mblogs.push(child.mblog);
    }
    return mblogs;
  }

  /** Maps a mobile mblog onto the PC status shape that storeStatus consumes. */
  private async normalizeMobileStatus(mblog: any): Promise<any> {
    return {
      idstr: String(mblog.mid || mblog.id || ''),
      mblogid: mblog.bid || '',
      text_raw: mblog.isLongText ? await this.fetchLongText(String(mblog.id || mblog.mid || ''), mblog.text) : mblog.text,
      created_at: mblog.created_at || '',
      user: { idstr: String(mblog.user?.id || ''), screen_name: mblog.user?.screen_name || '' },
      attitudes_count: mblog.attitudes_count || 0,
      comments_count: mblog.comments_count || 0,
      reposts_count: mblog.reposts_count || 0,
    };
  }

  /** Search results truncate long posts; /statuses/extend returns the full body. */
  private async fetchLongText(statusId: string, fallback: string): Promise<string> {
    if (!statusId) return fallback;
    try {
      const payload = await this.page!.evaluate(async (id) => {
        const response = await fetch(`https://m.weibo.cn/statuses/extend?id=${encodeURIComponent(id)}`, {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const body = await response.text();
        return body.trim().startsWith('{') ? JSON.parse(body) : null;
      }, statusId);
      return payload?.data?.longTextContent || fallback;
    } catch {
      return fallback;
    }
  }

  /** Legacy DOM scrape of s.weibo.com, kept as the fallback when the JSON API yields nothing. */
  private async searchByDom(keyword: string): Promise<any[]> {
    const searchUrl = `https://s.weibo.com/weibo?q=${encodeURIComponent(keyword)}`;
    await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await this.page!.waitForTimeout(3000);

    // Scroll
    await this.page!.evaluate(() => window.scrollBy(0, 1000));
    await this.page!.waitForTimeout(1000);

    const cards = await this.page!.evaluate(() => {
      const items: any[] = [];
      const cardElements = document.querySelectorAll('.card-wrap[mid]');

      const parseStat = (text: string | null) => {
        if (!text) return 0;
        const cleanText = text.trim();
        if (cleanText.includes('万')) {
          const val = parseFloat(cleanText.replace('万', '').trim());
          return isNaN(val) ? 0 : Math.round(val * 10000);
        }
        const match = cleanText.match(/\d+/);
        return match ? Number(match[0]) : 0;
      };

      cardElements.forEach((card) => {
        const contentEl = card.querySelector('p.txt[node-type="feed_list_content"]');
        const authorEl = card.querySelector('a.name');
        if (!contentEl || !authorEl) return;

        const repostEl = card.querySelector('a[action-type="feed_list_forward"]');
        const commentEl = card.querySelector('a[action-type="feed_list_comment"]');
        const likeEl = card.querySelector('.woo-like-count, a[action-type="feed_list_like"]');

        items.push({
          idstr: card.getAttribute('mid') || '',
          // The card only renders a relative date ("今天 16:32"); leave create_time unset
          // rather than stamping the collection time onto it.
          created_at: '',
          mblogid: card.querySelector('.from a[href*="/status/"]')?.getAttribute('href')?.match(/\/status\/([A-Za-z0-9]+)/)?.[1] || '',
          text_raw: contentEl.textContent?.trim() || '',
          user: {
            idstr: authorEl.getAttribute('usercard')?.match(/id=([0-9]+)/)?.[1] || '',
            screen_name: authorEl.textContent?.trim() || '',
          },
          reposts_count: parseStat(repostEl ? repostEl.textContent : ''),
          comments_count: parseStat(commentEl ? commentEl.textContent : ''),
          attitudes_count: parseStat(likeEl ? likeEl.textContent : ''),
        });
      });
      return items;
    });

    return cards.filter((card: any) => card.idstr).slice(0, activeConfig.CRAWLER_MAX_NOTES_COUNT);
  }

  private async storeStatus(status: any, sourceKeyword: string): Promise<any | null> {
    if (!status?.id && !status?.idstr) return null;
    const noteId = String(status.idstr || status.id);
    const userId = String(status.user?.idstr || status.user?.id || '');
    const record = {
      note_id: noteId,
      content: stripHtml(status.text_raw || status.text || ''),
      nickname: status.user?.screen_name || '', creator_hash: userId,
      note_url: status.mblogid && userId ? `https://weibo.com/${userId}/${status.mblogid}` : `https://weibo.com/detail/${noteId}`,
      liked_count: status.attitudes_count || 0, comments_count: status.comments_count || 0,
      shared_count: status.reposts_count || 0,
      create_time: status.created_at ? Math.floor(new Date(status.created_at).getTime() / 1000) : 0,
      create_date_time: status.created_at || '', source_keyword: sourceKeyword,
    };
    await connectorOutput.emitWeiboNote(record);
    if (activeConfig.ENABLE_GET_COMMENTS) await this.getNoteComments(noteId);
    return record;
  }

  private async fetchNoteDetail(target: string, sourceKeyword: string): Promise<any | null> {
    const resolved = await resolveRedirect(this.page!, target);
    let noteId = resolved.match(/\/detail\/(\d+)/i)?.[1]
      || resolved.match(/[?&]id=(\d+)/i)?.[1]
      || resolved.match(/^\s*(\d+)\s*$/)?.[1]
      || '';
    if (!noteId && /^https?:\/\//i.test(resolved)) {
      noteId = await this.page!.evaluate(() => document.querySelector('[mid]')?.getAttribute('mid') || '');
    }
    try {
      if (!noteId) throw new Error('无法从链接识别微博数字 ID');
      const status = await this.page!.evaluate(async (id) => {
        const response = await fetch(`https://weibo.com/ajax/statuses/show?id=${encodeURIComponent(id)}`, { credentials: 'include' });
        return response.json();
      }, noteId);
      if (!status?.id && !status?.idstr) throw new Error(status?.msg || 'status not found');
      return await this.storeStatus(status, sourceKeyword);
    } catch (error: any) {
      console.error(`[WEIBO] Failed to collect detail ${target}: ${error.message}`);
      return null;
    }
  }

  private async getNoteComments(noteId: string): Promise<void> {
    const url = `https://weibo.com/ajax/statuses/buildComments?is_reload=1&id=${encodeURIComponent(noteId)}&is_show_bulletin=2&fetch_level=0&max_id=0&count=${activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES}`;
    try {
      const result = await this.page!.evaluate(async (apiUrl) => (await fetch(apiUrl, { credentials: 'include' })).json(), url);
      const comments = result?.data || [];
      const store = async (comment: any, parent = '') => connectorOutput.emitWeiboComment({
        comment_id: String(comment.idstr || comment.id || ''), note_id: noteId,
        content: stripHtml(comment.text_raw || comment.text || ''),
        create_time: comment.created_at ? Math.floor(new Date(comment.created_at).getTime() / 1000) : 0,
        create_date_time: comment.created_at || '', creator_hash: String(comment.user?.idstr || comment.user?.id || ''),
        nickname: comment.user?.screen_name || '', comment_like_count: comment.like_counts || 0,
        sub_comment_count: comment.total_number || 0, parent_comment_id: parent,
      });
      for (const comment of comments) {
        await store(comment);
        // The reply array rides along in the same response; keeping it costs nothing.
        for (const child of comment.comments || []) await store(child, String(comment.idstr || comment.id || ''));
      }
      console.log(`[WEIBO] Stored ${comments.length} comments for ${noteId}`);
    } catch (error: any) {
      console.error(`[WEIBO] Failed to collect comments for ${noteId}: ${error.message}`);
    }
  }

  public async getSpecifiedNotes(): Promise<void> {
    for (const target of configuredTargets('weibo', 'detail')) await this.fetchNoteDetail(target, '指定微博');
  }

  public async getCreatorsAndNotes(): Promise<void> {
    for (const target of configuredTargets('weibo', 'creator')) {
      const resolved = await resolveRedirect(this.page!, target);
      const uid = firstMatch(resolved, [/\/u\/(\d+)/i, /weibo\.com\/(\d+)/i, /[?&]uid=(\d+)/i, /^\s*(\d+)\s*$/]);
      const url = `https://weibo.com/ajax/statuses/mymblog?uid=${encodeURIComponent(uid)}&page=1&feature=0`;
      try {
        const result = await this.page!.evaluate(async (apiUrl) => (await fetch(apiUrl, { credentials: 'include' })).json(), url);
        const statuses = result?.data?.list || [];
        console.log(`[WEIBO] Creator ${uid}: discovered ${statuses.length} posts`);
        for (const status of statuses.slice(0, activeConfig.CRAWLER_MAX_NOTES_COUNT)) await this.storeStatus(status, `用户:${uid}`);
      } catch (error: any) {
        console.error(`[WEIBO] Failed to collect creator ${uid}: ${error.message}`);
      }
    }
  }
}
