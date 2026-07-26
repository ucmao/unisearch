import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { configuredTargets, firstMatch, resolveRedirect } from '../base/connectorHelpers';
import { connectorEventEmitter } from '../../core/contracts/connector-event-emitter';

// Tieba's own search stops serving useful results well before this; the cap only
// exists so a query that keeps answering identical pages cannot loop forever.
const TIEBA_MAX_SEARCH_PAGES = 30;
/** `rn` the search page asks for itself; larger values are not honoured. */
const TIEBA_SEARCH_PAGE_SIZE = 20;
const TIEBA_SEARCH_API = '/mo/q/search/multsearch';

/** A floor (楼层) of a thread — what Tieba calls a post and we store as a comment. */
interface ThreadPost {
  id: string;
  parentId: string;
  text: string;
  authorId: string;
  authorName: string;
  time: string;
  subCount: number;
  /** Replies the thread payload already carried; the rest need `/p/comment`. */
  subComments: SubComment[];
}

interface ThreadPage {
  title: string;
  forum: string;
  totalPages: number;
  /** Thread-level author, which is the only reliable way to spot the opening post. */
  authorId: string;
  authorName: string;
  createTime: string;
  posts: ThreadPost[];
}

/** A 楼中楼 reply hanging off one floor. */
interface SubComment {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  time: string;
}

/** The search payload carries titles and abstracts with HTML entities still in them. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/** The JSON API returns unix seconds; the stored shape has always been a local string. */
function formatTiebaTime(seconds: unknown): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value * 1000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export class TiebaCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  /** The signed `multsearch` URL captured for the keyword currently being walked. */
  private searchEndpoint: { keyword: string; url: string } | null = null;

  public async start(): Promise<void> {
    console.log('[TIEBA] Starting Tieba crawler (Electron CDP mode)...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'tieba');




    await this.page.goto('https://tieba.baidu.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    } else if (activeConfig.CRAWLER_TYPE === 'detail') {
      await this.getSpecifiedThreads();
    } else if (activeConfig.CRAWLER_TYPE === 'creator') {
      await this.getSubjectsAndThreads();
    }

    console.log('[TIEBA] Tieba crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[TIEBA] Checking login state...');
    if (activeConfig.LOGIN_TYPE === 'cookie' && activeConfig.COOKIES) {
      await this.applyCookieHeader(this.browserContext!, activeConfig.COOKIES, '.baidu.com');
      await this.page!.reload({ waitUntil: 'domcontentloaded' });
    }
    let isLoggedIn = await this.checkLoginState();
    
    if (!isLoggedIn && activeConfig.LOGIN_TYPE === 'qrcode') {
      console.log('[TIEBA] User is not logged in. Waiting for manual login...');
      try {
        await this.page!.click('.u_login, .header-login', { timeout: 3000 });
      } catch {}

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[TIEBA] Login successful!');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async checkLoginState(): Promise<boolean> {
    try {
      const visible = await this.page!.isVisible('.u_username, .user_name', { timeout: 1000 });
      if (visible) return true;
    } catch {}
    try {
      const isLoginBtn = await this.page!.isVisible('.u_login, .header-login', { timeout: 1000 });
      if (isLoginBtn) return false;
    } catch {}
    try {
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some((c) => c.name === 'STOKEN' || c.name === 'PTOKEN');
        if (hasSession) {
          const loginBtnExists = await this.page!.isVisible('.u_login, .header-login', { timeout: 1000 }).catch(() => false);
          if (loginBtnExists) return false;
          console.log('[TIEBA] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[TIEBA] Error checking cookies:', err.message);
    }
    return false;
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    const target = Math.max(1, activeConfig.CRAWLER_MAX_NOTES_COUNT);
    for (const keyword of keywords) {
      console.log(`[TIEBA] Searching keyword: ${keyword} (target ${target})`);
      try {
        // Tieba search is truly paginated, but only through its JSON endpoint —
        // the rendered page shows five threads and ignores `pn` in the URL, so
        // scraping the DOM capped every keyword at five results no matter the
        // configured depth.
        const collected = new Map<string, any>();
        let pagesWithoutNewResults = 0;
        for (let pn = 1; collected.size < target && pn <= TIEBA_MAX_SEARCH_PAGES; pn++) {
          const { posts, hasMore } = await this.collectSearchPage(keyword, pn);
          const before = collected.size;
          for (const post of posts) {
            if (!post.note_id || collected.has(post.note_id)) continue;
            collected.set(post.note_id, post);
            if (collected.size >= target) break;
          }
          console.log(`[TIEBA] pn=${pn}: ${posts.length} results, ${collected.size}/${target} collected.`);
          if (!posts.length) break;
          if (collected.size === before) {
            // A tail page keeps answering, it just stops adding anything new.
            if (++pagesWithoutNewResults >= 2) break;
          } else {
            pagesWithoutNewResults = 0;
          }
          if (!hasMore) break;
          await this.humanDelay(this.page!);
        }

        const posts = [...collected.values()];
        if (posts.length < target) {
          connectorEventEmitter.send({
            type: 'warning',
            code: 'PARTIAL_RESULT',
            message: `贴吧关键词“${keyword}”只找到 ${posts.length} 条结果（目标 ${target} 条），可能是该词在贴吧的结果本就有限。`,
          });
        }
        await this.ingestSearchResults(posts, keyword);
      } catch (err: any) {
        console.error(`[TIEBA] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }

  /**
   * Locate the signed search call the results page makes for itself.
   *
   * `/f/search/res` is a Vue app that renders five threads and never reads `pn`
   * off the URL; the real result set comes from `multsearch`, which does paginate.
   * That endpoint is signed, but the signature only covers the query — swapping
   * `pn` on a captured URL is accepted — so the page is loaded once per keyword
   * and its own request is reused instead of reimplementing Baidu's signature.
   */
  protected async resolveSearchEndpoint(keyword: string): Promise<string | null> {
    if (this.searchEndpoint?.keyword === keyword) return this.searchEndpoint.url;
    let captured = '';
    const capture = (request: any) => {
      const url = request.url();
      if (!captured && url.includes(TIEBA_SEARCH_API)) captured = url;
    };
    this.page!.on('request', capture);
    try {
      await this.page!.goto(
        `https://tieba.baidu.com/f/search/res?ie=utf-8&qw=${encodeURIComponent(keyword)}`,
        { waitUntil: 'domcontentloaded' },
      );
      for (let waited = 0; waited < 20 && !captured; waited++) await this.page!.waitForTimeout(300);
    } catch (error: any) {
      console.error(`[TIEBA] Failed to open search page for ${keyword}: ${error.message}`);
    } finally {
      this.page!.off('request', capture);
    }
    if (!captured) return null;
    this.searchEndpoint = { keyword, url: captured };
    return captured;
  }

  /** Map one `multsearch` payload; kept pure so the mapping can be tested. */
  protected normalizeSearchPayload(payload: any): { posts: any[]; hasMore: boolean } {
    const cards: any[] = payload?.data?.card_list || [];
    // The list also carries forum, user and recommendation cards; only threads
    // are results.
    const posts = cards
      .filter((card) => card?.cardInfo === 'thread' && card?.data?.tid)
      .map((card) => {
        const thread = card.data;
        const forum = String(thread.forum_name || thread.forum_info?.forum_name || '');
        return {
          note_id: String(thread.tid),
          title: decodeEntities(String(thread.title || '')),
          desc: decodeEntities(String(thread.content || thread.abstract || '')),
          note_url: `https://tieba.baidu.com/p/${thread.tid}`,
          user_nickname: String(thread.user?.show_nickname || thread.user?.user_name || ''),
          creator_hash: String(thread.user?.user_id || ''),
          comment_count: Number(thread.post_num || 0),
          tieba_name: forum,
          tieba_link: forum ? `https://tieba.baidu.com/f?kw=${encodeURIComponent(forum)}` : '',
        };
      });
    return { posts, hasMore: Number(payload?.data?.has_more || 0) === 1 };
  }

  protected async collectSearchPage(keyword: string, pn: number): Promise<{ posts: any[]; hasMore: boolean }> {
    const endpoint = await this.resolveSearchEndpoint(keyword);
    if (!endpoint) {
      console.warn('[TIEBA] Search API request was never observed — '
        + '贴吧搜索页结构可能又变了，本次仅解析首屏结果。');
      return { posts: pn === 1 ? await this.collectSearchPageFromDom() : [], hasMore: false };
    }
    const url = new URL(endpoint);
    url.searchParams.set('pn', String(pn));
    url.searchParams.set('rn', String(TIEBA_SEARCH_PAGE_SIZE));
    try {
      // Fetched from the page so the call carries the browser's own session.
      const payload = await this.page!.evaluate(async (target: string) => {
        const response = await fetch(target, { credentials: 'include' });
        if (!response.ok) return null;
        try { return await response.json(); } catch { return null; }
      }, url.toString());
      return this.normalizeSearchPayload(payload);
    } catch (error: any) {
      console.error(`[TIEBA] Search page ${pn} failed for ${keyword}: ${error.message}`);
      return { posts: [], hasMore: false };
    }
  }

  /** Last resort when the JSON call cannot be captured: the five rendered cards. */
  private async collectSearchPageFromDom(): Promise<any[]> {
    return this.page!.evaluate(() => {
      const items: any[] = [];
      const postElements = document.querySelectorAll('.thread-content-box');

      postElements.forEach((post) => {
        const titleEl = post.querySelector('.title-wrap span');
        const descEl = post.querySelector('.abstract-wrap span');
        const authorEl = post.querySelector('.forum-attention');
        const linkEl = post.querySelector('.action-link-bg, .comment-link-zone, .item-link-bg');
        const tiebaNameEl = post.querySelector('.forum-name-text');

        const href = linkEl ? linkEl.getAttribute('href') || '' : '';
        const noteId = href.match(/p\/([0-9]+)/)?.[1] || '';

        const itemWarps = Array.from(post.querySelectorAll('.item-warp'));
        let commentCount = 0;

        itemWarps.forEach((warp) => {
          const iconUse = warp.querySelector('use');
          const iconHref = iconUse ? (iconUse.getAttribute('xlink:href') || iconUse.getAttribute('href') || '') : '';
          const numEl = warp.querySelector('.action-number');
          const valText = numEl ? numEl.textContent?.trim() || '' : '';

          if (iconHref.includes('comment')) {
            commentCount = parseInt(valText) || 0;
          }
        });

        if (titleEl) {
          const tiebaName = tiebaNameEl?.textContent?.trim() || '';
          items.push({
            note_id: noteId,
            title: titleEl.textContent?.trim() || '',
            desc: descEl?.textContent?.trim() || '',
            note_url: href.startsWith('http') ? href : 'https://tieba.baidu.com' + href,
            user_nickname: authorEl?.textContent?.trim() || '',
            creator_hash: authorEl ? authorEl.textContent?.trim() || '' : '',
            comment_count: commentCount,
            tieba_name: tiebaName,
            tieba_link: tiebaName ? `https://tieba.baidu.com/f?kw=${encodeURIComponent(tiebaName.replace('吧', ''))}` : '',
          });
        }
      });
      return items;
    });
  }

  private async ingestSearchResults(posts: any[], keyword: string): Promise<void> {
    console.log(`[TIEBA] Ingesting ${posts.length} threads for “${keyword}”...`);
    // Every thread is persisted before any detail navigation happens: comment
    // fetching moves the shared page away from the search results, and a failure
    // partway through must not discard threads already found.
    for (const post of posts) {
      await connectorOutput.emitTiebaNote({
        note_id: post.note_id,
        title: post.title,
        desc: post.desc,
        note_url: post.note_url,
        user_nickname: post.user_nickname,
        creator_hash: post.creator_hash,
        total_replay_num: post.comment_count,
        total_replay_page: Math.ceil(post.comment_count / 30),
        tieba_name: post.tieba_name,
        tieba_link: post.tieba_link,
        source_keyword: keyword,
      });
    }

    if (!activeConfig.ENABLE_GET_COMMENTS) return;
    for (const post of posts) {
      await this.getThreadDetail(post.note_url, keyword);
      await this.humanDelay(this.page!);
    }
  }

  /**
   * Turn one `/c/f/pb/page_pc` payload into the shape the collector works with.
   * Kept pure so the mapping can be tested against a captured payload.
   */
  protected normalizeThreadPayload(payload: any): ThreadPage {
    const names = new Map<string, string>();
    for (const user of payload?.user_list || []) {
      names.set(String(user.id || ''), String(user.name_show || user.name || ''));
    }
    const threadId = String(payload?.thread?.id || '');
    const posts: ThreadPost[] = (payload?.post_list || []).map((post: any) => {
      const authorId = String(post.author_id || '');
      // `content` is a rich-text array; type 0 is the plain-text run, the rest are
      // emoticons, images and links that carry no text of their own.
      const text = (post.content || [])
        .filter((part: any) => part?.type === 0 && part?.text)
        .map((part: any) => part.text)
        .join('')
        .trim();
      const inline = (post.sub_post_list?.sub_post_list || []).map((sub: any) => ({
        id: String(sub.id || ''),
        text: (sub.content || []).filter((part: any) => part?.type === 0 && part?.text)
          .map((part: any) => part.text).join('').trim(),
        authorId: String(sub.author_id || ''),
        authorName: names.get(String(sub.author_id || '')) || '',
        time: formatTiebaTime(sub.time),
      })).filter((sub: SubComment) => sub.id && sub.text);
      return {
        id: String(post.id || ''),
        parentId: threadId,
        text,
        authorId,
        authorName: names.get(authorId) || '',
        time: formatTiebaTime(post.time),
        subCount: Number(post.sub_post_number || 0),
        subComments: inline,
      };
    }).filter((post: ThreadPost) => post.text);
    const author = payload?.thread?.author || {};
    return {
      title: String(payload?.thread?.title || ''),
      forum: String(payload?.display_forum?.name || payload?.forum?.name || ''),
      totalPages: Number(payload?.page?.total_page || 1),
      authorId: String(author.id || ''),
      authorName: String(author.name_show || author.name || ''),
      createTime: formatTiebaTime(payload?.thread?.create_time),
      posts,
    };
  }

  /**
   * Collect a thread's floors.
   *
   * Tieba's PC site is a Vue app now: there is no `.l_post` markup and `?pn=` does
   * nothing — floors arrive from `POST /c/f/pb/page_pc` and are rendered into a
   * virtual list. That endpoint rejects hand-made calls (`error_code 110001`)
   * because it is signed, so rather than reimplement the signature we let the page
   * make its own requests and read the replies off the wire, scrolling the list to
   * ask for the next page.
   */
  protected async collectThreadPages(noteUrl: string, maxFloors: number): Promise<ThreadPage[]> {
    const payloads: any[] = [];
    const capture = async (response: any) => {
      if (!response.url().includes('/c/f/pb/page_pc')) return;
      try { payloads.push(await response.json()); } catch { /* non-JSON error page */ }
    };
    this.page!.on('response', capture);
    try {
      await this.page!.goto(noteUrl, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(2500);

      const floors = () => payloads.reduce((sum, item) => sum + (item?.post_list?.length || 0), 0);
      let idleRounds = 0;
      // 20 scrolls at ~15 floors a page is far more than any comment budget needs;
      // it only bounds a thread that keeps answering without advancing.
      for (let round = 0; round < 20 && floors() < maxFloors && idleRounds < 3; round++) {
        const before = payloads.length;
        const scrolled = await this.page!.evaluate(() => {
          const box = document.querySelector('.pc-pb-box');
          if (!box) return false;
          box.scrollTop = box.scrollHeight;
          box.dispatchEvent(new Event('scroll', { bubbles: true }));
          return true;
        });
        if (!scrolled) break;
        await this.page!.waitForTimeout(1200);
        idleRounds = payloads.length > before ? 0 : idleRounds + 1;
        const last = payloads[payloads.length - 1];
        if (last && last.page && !last.page.has_more) break;
      }
    } catch (error: any) {
      console.error(`[TIEBA] Failed to read thread pages for ${noteUrl}: ${error.message}`);
    } finally {
      this.page!.off('response', capture);
    }
    return payloads
      .filter((payload) => payload?.error_code === 0 || payload?.post_list)
      .map((payload) => this.normalizeThreadPayload(payload));
  }

  /**
   * Fetch a floor's 楼中楼 replies from within the page, so the request carries the
   * browser's own session. The endpoint returns an HTML fragment, not JSON.
   */
  protected async fetchSubComments(threadId: string, postId: string, limit: number): Promise<SubComment[]> {
    if (limit <= 0) return [];
    try {
      return await this.page!.evaluate(async ({ tid, pid, max }) => {
        const collected: any[] = [];
        for (let pn = 1; pn <= 10 && collected.length < max; pn++) {
          const url = `https://tieba.baidu.com/p/comment?tid=${tid}&pid=${pid}&pn=${pn}`;
          const response = await fetch(url, { credentials: 'include' });
          if (!response.ok) break;
          const fragment = new DOMParser().parseFromString(await response.text(), 'text/html');
          const items = Array.from(fragment.querySelectorAll('.lzl_single_post'));
          if (!items.length) break;
          for (const item of items) {
            let field: any = {};
            try { field = JSON.parse(item.getAttribute('data-field') || '{}'); } catch {}
            const text = item.querySelector('.lzl_content_main')?.textContent?.trim() || '';
            if (!text) continue;
            collected.push({
              id: String(field.spid || ''),
              text,
              // The fragment carries no numeric user id, only the portrait token.
              authorId: String(field.portrait || ''),
              authorName: String(field.showname || field.user_name || item.querySelector('.at')?.textContent?.trim() || ''),
              time: item.querySelector('.lzl_time')?.textContent?.trim() || '',
            });
            if (collected.length >= max) break;
          }
          if (items.length < 10) break;
        }
        return collected.filter((comment) => comment.id);
      }, { tid: threadId, pid: postId, max: limit });
    } catch (error: any) {
      console.error(`[TIEBA] Failed to fetch sub-comments for post ${postId}: ${error.message}`);
      return [];
    }
  }

  private async getThreadDetail(target: string, sourceKeyword: string): Promise<any | null> {
    const resolved = await resolveRedirect(this.page!, target);
    const noteId = firstMatch(resolved, [/\/p\/(\d+)/i, /[?&]tid=(\d+)/i, /^\s*(\d+)\s*$/]);
    const noteUrl = `https://tieba.baidu.com/p/${encodeURIComponent(noteId)}`;
    const maxComments = Math.max(0, activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES);
    try {
      const pages = await this.collectThreadPages(noteUrl, maxComments + 1);
      if (!pages.length) {
        console.warn(`[TIEBA] Thread ${noteId} returned no page payload — `
          + '贴吧 PC 端接口或页面结构可能又变了，或当前会话被风控拦截。');
        return null;
      }
      const firstPage = pages[0];
      const floors: ThreadPost[] = [];
      const seenIds = new Set<string>();
      let originalPost: ThreadPost | undefined;

      // The virtual list re-renders pages as it scrolls, so the same floor can show
      // up in more than one payload; ids decide what is actually new.
      for (const page of pages) {
        for (const post of page.posts) {
          if (seenIds.has(post.id)) continue;
          seenIds.add(post.id);
          // `thread.post_id` is the first post of whichever page the payload covers,
          // not the opening post, so the thread-level author is what identifies it.
          const isOpening = !originalPost && !floors.length
            && (!firstPage.authorId || post.authorId === firstPage.authorId);
          if (isOpening) originalPost = post;
          else floors.push(post);
        }
      }

      const forum = pages.find((page) => page.forum)?.forum || '';
      const record = {
        note_id: noteId, title: firstPage.title || originalPost?.text?.slice(0, 100) || '',
        desc: originalPost?.text || '', note_url: noteUrl,
        publish_time: originalPost?.time || firstPage.createTime || '',
        creator_hash: originalPost?.authorId || firstPage.authorId || '',
        user_nickname: originalPost?.authorName || firstPage.authorName || '',
        tieba_name: forum,
        tieba_link: forum ? `https://tieba.baidu.com/f?kw=${encodeURIComponent(forum.replace(/吧$/, ''))}` : '',
        total_replay_num: floors.length, total_replay_page: firstPage.totalPages,
        source_keyword: sourceKeyword,
      };
      await connectorOutput.emitTiebaNote(record);

      let stored = 0;
      let subTotal = 0;
      if (activeConfig.ENABLE_GET_COMMENTS) {
        for (const post of floors) {
          if (stored >= maxComments) break;
          await connectorOutput.emitTiebaComment({
            comment_id: post.id, parent_comment_id: post.parentId, content: post.text,
            creator_hash: post.authorId, user_nickname: post.authorName,
            tieba_name: forum, tieba_link: record.tieba_link,
            publish_time: post.time, sub_comment_count: post.subCount,
            note_id: noteId, note_url: noteUrl,
          });
          stored++;
          if (post.subCount <= 0) continue;

          // The thread payload inlines up to four replies per floor, so those are
          // free. Only what is left over costs a request, and floors share one
          // budget with their 楼中楼 so a busy floor cannot starve the ones after it.
          const emitted = new Set<string>();
          const replies = [...post.subComments];
          if (post.subCount > replies.length) {
            const remaining = maxComments - stored - replies.length;
            replies.push(...await this.fetchSubComments(noteId, post.id, remaining));
          }

          for (const sub of replies) {
            // The fragment can hand back a full page of 10 regardless of what we
            // asked for, so the budget is enforced here rather than trusted upstream.
            if (stored >= maxComments) break;
            if (emitted.has(sub.id)) continue;
            emitted.add(sub.id);
            await connectorOutput.emitTiebaComment({
              // parent_comment_id points at the floor, so the reply tree stays reconstructable.
              comment_id: sub.id, parent_comment_id: post.id, content: sub.text,
              creator_hash: sub.authorId, user_nickname: sub.authorName,
              tieba_name: forum, tieba_link: record.tieba_link,
              publish_time: sub.time, sub_comment_count: 0,
              note_id: noteId, note_url: noteUrl,
            });
            stored++;
            subTotal++;
          }
        }
      }
      console.log(`[TIEBA] Stored thread ${noteId}: ${stored - subTotal} replies`
        + `${subTotal ? ` + ${subTotal} sub-replies` : ''} from ${pages.length} payload(s)`
        + ` of ${firstPage.totalPages} page(s)`);
      return record;
    } catch (error: any) {
      console.error(`[TIEBA] Failed to collect thread ${target}: ${error.message}`);
      return null;
    }
  }

  public async getSpecifiedThreads(): Promise<void> {
    for (const target of configuredTargets('tieba', 'detail')) await this.getThreadDetail(target, '指定帖子');
  }

  public async getSubjectsAndThreads(): Promise<void> {
    for (const target of configuredTargets('tieba', 'creator')) {
      const isUser = /home\/main|portrait=|un=/.test(target);
      const resolved = /^https?:\/\//i.test(target) ? await resolveRedirect(this.page!, target) : target;
      const url = isUser
        ? resolved
        : `https://tieba.baidu.com/f?kw=${encodeURIComponent(firstMatch(resolved, [/[?&]kw=([^&#]+)/i]).replace(/吧$/, ''))}`;
      await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(1800);
      const links = await this.page!.evaluate(() => Array.from(document.querySelectorAll('a[href*="/p/"]'))
        .map((link) => link.getAttribute('href')?.match(/\/p\/(\d+)/)?.[1] || '').filter(Boolean));
      const unique = [...new Set(links)].slice(0, activeConfig.CRAWLER_MAX_NOTES_COUNT);
      console.log(`[TIEBA] Subject ${target}: discovered ${unique.length} threads`);
      for (const id of unique) await this.getThreadDetail(id, `主体:${target}`);
    }
  }
}
