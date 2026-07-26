import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { configuredTargets, firstMatch, resolveRedirect } from '../base/connectorHelpers';
import { connectorEventEmitter } from '../../core/contracts/connector-event-emitter';

// Tieba's own search stops serving useful results well before this; the cap only
// exists so a query that keeps rendering identical pages cannot loop forever.
const TIEBA_MAX_SEARCH_PAGES = 30;

export class TiebaCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

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
        // Tieba search is truly paginated. Without this loop the crawler only ever
        // saw the first page, so any depth above ~10 items was unreachable while
        // the run still reported success.
        //
        // Baidu uses `pn` for both conventions across its endpoints — a 1-based
        // page index on some, an item offset on others — so the mode is detected
        // from the second request instead of hardcoding a guess.
        const collected = new Map<string, any>();
        let pageSize = 0;
        let offsetMode = false;
        let pagesWithoutNewResults = 0;
        for (let pageNo = 1; collected.size < target && pageNo <= TIEBA_MAX_SEARCH_PAGES; pageNo++) {
          const pn = offsetMode ? (pageNo - 1) * (pageSize || 10) : pageNo;
          const posts = await this.collectSearchPage(keyword, pn);
          const ids = posts.map((post) => post.note_id).filter(Boolean);
          const newIds = ids.filter((id) => !collected.has(id));

          if (pageNo === 1) {
            pageSize = ids.length;
          } else if (pageNo === 2 && !offsetMode && ids.length && pageSize && newIds.length <= 1) {
            // Under offset semantics pn=2 shifts the window by exactly one item,
            // so page 2 returns at most one unseen thread. Requiring near-total
            // overlap keeps a genuinely duplicate-heavy page 2 from misfiring.
            offsetMode = true;
            console.warn('[TIEBA] Detected offset-style pagination; switching pn to item offsets.');
            // Restart from offset 0 so the very first result is not skipped;
            // the dedupe map absorbs the overlap with what page 1 already gave.
            pageNo = 0;
            continue;
          }

          const before = collected.size;
          for (const post of posts) {
            if (!post.note_id || collected.has(post.note_id)) continue;
            collected.set(post.note_id, post);
            if (collected.size >= target) break;
          }
          console.log(`[TIEBA] pn=${pn}: ${posts.length} results, ${collected.size}/${target} collected.`);
          if (collected.size === before) {
            // The last page of a query keeps rendering, it just stops adding
            // anything new, so "no growth" is the only reliable end signal.
            if (++pagesWithoutNewResults >= 2) break;
          } else {
            pagesWithoutNewResults = 0;
          }
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

  private async collectSearchPage(keyword: string, pn: number): Promise<any[]> {
    const searchUrl = `https://tieba.baidu.com/f/search/res?qw=${encodeURIComponent(keyword)}&pn=${pn}`;
    await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await this.page!.waitForTimeout(3000);

    // Scroll
    await this.page!.evaluate(() => window.scrollBy(0, 1000));
    await this.page!.waitForTimeout(1000);

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

  private async getThreadDetail(target: string, sourceKeyword: string): Promise<any | null> {
    const resolved = await resolveRedirect(this.page!, target);
    const noteId = firstMatch(resolved, [/\/p\/(\d+)/i, /[?&]tid=(\d+)/i, /^\s*(\d+)\s*$/]);
    const noteUrl = `https://tieba.baidu.com/p/${encodeURIComponent(noteId)}`;
    try {
      if (!this.page!.url().includes(`/p/${noteId}`)) await this.page!.goto(noteUrl, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(1200);
      const detail = await this.page!.evaluate(() => {
        const title = document.querySelector('.core_title_txt, h1')?.textContent?.trim() || document.title.replace(/_百度贴吧$/, '');
        const forum = document.querySelector('.card_title_fname, a.card_title_fname')?.textContent?.trim() || '';
        const posts = Array.from(document.querySelectorAll('.l_post')).map((post, index) => {
          let field: any = {};
          try { field = JSON.parse(post.getAttribute('data-field') || '{}'); } catch {}
          const author = field.author || {};
          const content = field.content || {};
          return {
            id: String(content.post_id || post.getAttribute('data-pid') || `${Date.now()}-${index}`),
            parentId: String(content.post_id === content.thread_id ? '' : content.thread_id || ''),
            text: post.querySelector('.d_post_content')?.textContent?.trim() || '',
            authorId: String(author.user_id || author.portrait || ''),
            authorName: author.user_name || post.querySelector('.p_author_name')?.textContent?.trim() || '',
            time: content.date || post.querySelector('.tail-info:last-child')?.textContent?.trim() || '',
            subCount: Number(content.comment_num || 0),
          };
        }).filter((post) => post.text);
        return { title, forum, posts };
      });
      const first = detail.posts[0] || {};
      const record = {
        note_id: noteId, title: detail.title || first.text?.slice(0, 100) || '', desc: first.text || '',
        note_url: noteUrl, publish_time: first.time || '', creator_hash: first.authorId || '',
        user_nickname: first.authorName || '', tieba_name: detail.forum || '',
        tieba_link: detail.forum ? `https://tieba.baidu.com/f?kw=${encodeURIComponent(detail.forum.replace(/吧$/, ''))}` : '',
        total_replay_num: Math.max(0, detail.posts.length - 1), total_replay_page: 1, source_keyword: sourceKeyword,
      };
      await connectorOutput.emitTiebaNote(record);
      if (activeConfig.ENABLE_GET_COMMENTS) {
        for (const post of detail.posts.slice(1, activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES + 1)) {
          await connectorOutput.emitTiebaComment({
            comment_id: post.id, parent_comment_id: post.parentId, content: post.text,
            creator_hash: post.authorId, user_nickname: post.authorName,
            tieba_name: detail.forum || '', tieba_link: record.tieba_link,
            publish_time: post.time, sub_comment_count: post.subCount,
            note_id: noteId, note_url: noteUrl,
          });
        }
      }
      console.log(`[TIEBA] Stored thread ${noteId} with ${Math.max(0, detail.posts.length - 1)} visible replies`);
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
