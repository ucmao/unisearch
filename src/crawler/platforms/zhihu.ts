import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { configuredTargets, firstMatch, resolveRedirect, stripHtml } from '../base/connectorHelpers';

export class ZhihuCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[ZHIHU] Starting Zhihu crawler (Electron CDP mode)...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'zhihu');

    await this.page.goto('https://www.zhihu.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    } else if (activeConfig.CRAWLER_TYPE === 'detail') {
      await this.getSpecifiedContents();
    } else if (activeConfig.CRAWLER_TYPE === 'creator') {
      await this.getCreatorsAndContents();
    }

    console.log('[ZHIHU] Zhihu crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[ZHIHU] Checking login state...');
    if (activeConfig.LOGIN_TYPE === 'cookie' && activeConfig.COOKIES) {
      await this.applyCookieHeader(this.browserContext!, activeConfig.COOKIES, '.zhihu.com');
      await this.page!.reload({ waitUntil: 'domcontentloaded' });
    }
    let isLoggedIn = await this.checkLoginState();
    
    if (!isLoggedIn && activeConfig.LOGIN_TYPE === 'qrcode') {
      console.log('[ZHIHU] User is not logged in. Waiting for manual login...');
      try {
        await this.page!.click('.AppHeader-login, .SignFlow-tabs', { timeout: 3000 });
      } catch {}

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[ZHIHU] Login successful!');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async checkLoginState(): Promise<boolean> {
    try {
      const visible = await this.page!.isVisible('.AppHeader-profile, .AppHeader-user', { timeout: 1000 });
      if (visible) return true;
    } catch {}
    try {
      const isLoginBtn = await this.page!.isVisible('.AppHeader-login, .SignFlow-tabs', { timeout: 1000 });
      if (isLoginBtn) return false;
    } catch {}
    try {
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some((c) => c.name === 'z_c0');
        if (hasSession) {
          const loginBtnExists = await this.page!.isVisible('.AppHeader-login, .SignFlow-tabs', { timeout: 1000 }).catch(() => false);
          if (loginBtnExists) return false;
          console.log('[ZHIHU] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[ZHIHU] Error checking cookies:', err.message);
    }
    return false;
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[ZHIHU] Searching keyword: ${keyword}`);
      try {
        const targetCount = activeConfig.CRAWLER_MAX_NOTES_COUNT || 20;
        // The web app signs /api/v4/search_v3 itself (x-zse-96 is bound to the
        // exact path+query, so replaying a captured header set is not an
        // option). Let the page issue its own requests and harvest the JSON —
        // it carries the full body, real timestamps and unrounded counters that
        // the rendered cards no longer expose.
        let items = await this.collectSearchApiResults(keyword, targetCount);

        if (items.length === 0) {
          console.warn('[ZHIHU] search_v3 responses unavailable, falling back to DOM extraction...');
          items = await this.collectSearchDomResults();
        }

        console.log(`[ZHIHU] Found ${items.length} answers/articles. Ingesting...`);
        let count = 0;

        for (const it of items) {
          if (count >= targetCount) break;
          if (!it.content_id) continue;

          await connectorOutput.emitZhihuContent({ ...it, source_keyword: keyword });
          if (activeConfig.ENABLE_GET_COMMENTS) await this.getContentComments(it.content_id, it.content_type);
          count++;

          await this.humanDelay(this.page!);
        }
      } catch (err: any) {
        console.error(`[ZHIHU] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }

  /**
   * Drive the search page and collect every /api/v4/search_v3 payload it
   * produces, scrolling until the target count is reached or the feed stops
   * growing.
   */
  private async collectSearchApiResults(keyword: string, targetCount: number): Promise<any[]> {
    const page = this.page!;
    const collected: any[] = [];
    const seen = new Set<string>();

    const onResponse = async (response: any) => {
      if (!response.url().includes('/api/v4/search_v3')) return;
      let payload: any;
      try {
        payload = await response.json();
      } catch {
        return;
      }
      for (const entry of payload?.data || []) {
        const record = this.buildSearchRecord(entry);
        if (!record || seen.has(record.content_id)) continue;
        seen.add(record.content_id);
        collected.push(record);
      }
    };

    page.on('response', onResponse);
    try {
      const searchUrl = `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(keyword)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      let stagnantRounds = 0;
      while (collected.length < targetCount && stagnantRounds < 3) {
        const before = collected.length;
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        stagnantRounds = collected.length > before ? 0 : stagnantRounds + 1;
      }
    } finally {
      page.off('response', onResponse);
    }

    if (collected.length) {
      console.log(`[ZHIHU] Harvested ${collected.length} items from search_v3 responses.`);
    }
    return collected;
  }

  /** Map one search_v3 entry onto the Zhihu content record shape. */
  private buildSearchRecord(entry: any): any | null {
    const object = entry?.object || entry;
    const contentId = String(object?.id || '');
    if (!contentId || entry?.type === 'search_query' || entry?.type === 'relevant_query') return null;

    const rawType = String(object.type || '');
    const type = rawType === 'article' ? 'article' : rawType === 'question' ? 'question' : 'answer';
    const question = object.question || {};
    const author = object.author || {};
    const body = stripHtml(object.content || object.excerpt || '');

    return {
      content_id: contentId,
      content_type: type,
      content_text: body,
      content_url: type === 'article'
        ? `https://zhuanlan.zhihu.com/p/${contentId}`
        : type === 'question'
          ? `https://www.zhihu.com/question/${contentId}`
          : `https://www.zhihu.com/question/${question.id || ''}/answer/${contentId}`,
      question_id: String(question.id || ''),
      title: stripHtml(object.title || question.name || question.title || ''),
      desc: stripHtml(object.excerpt || object.content || ''),
      created_time: object.created_time || object.created || 0,
      updated_time: object.updated_time || object.updated || 0,
      voteup_count: object.voteup_count || object.vote_count || 0,
      comment_count: object.comment_count || 0,
      creator_hash: author.url_token || String(author.id || ''),
      user_nickname: author.name || '',
    };
  }

  /** Legacy card scraper, kept as a fallback when no API payload is observed. */
  private async collectSearchDomResults(): Promise<any[]> {
    return await this.page!.evaluate(() => {
      const results: any[] = [];
      const cards = document.querySelectorAll('.Search-card, .ContentItem');

      // Cards render abbreviated counters ("赞同 1.2 万"), so the unit has to be
      // applied — a bare \d+ match would report that as 1.
      const parseStat = (text: string | null) => {
        if (!text) return 0;
        const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([万千亿])?/);
        if (!match) return 0;
        const scale = match[2] === '亿' ? 1e8 : match[2] === '万' ? 1e4 : match[2] === '千' ? 1e3 : 1;
        return Math.round(parseFloat(match[1]) * scale);
      };

      cards.forEach((card) => {
        const titleEl = card.querySelector('.ContentItem-title a, h2 a');
        const bodyEl = card.querySelector('.RichText, .ContentItem-richText');
        const authorEl = card.querySelector('.AuthorInfo-name, .UserLink-link');

        const voteUpEl = card.querySelector('.VoteButton--up, .VoteButton');
        const commentButton = Array.from(card.querySelectorAll('button.ContentItem-action, a.ContentItem-action')).find(b => b.textContent?.includes('评论'));

        if (titleEl) {
          const href = titleEl.getAttribute('href') || '';
          const contentId = href.split('/').pop() || '';
          const type = href.includes('answer') ? 'answer' : href.includes('article') ? 'article' : 'content';
          const desc = bodyEl?.textContent?.trim() || '';

          results.push({
            content_id: contentId,
            content_type: type,
            title: titleEl.textContent?.trim() || '',
            content_url: href.startsWith('http') ? href : 'https://www.zhihu.com' + href,
            content_text: desc,
            desc,
            user_nickname: authorEl?.textContent?.trim() || '',
            creator_hash: authorEl?.getAttribute('href')?.split('/').pop() || '',
            voteup_count: parseStat(voteUpEl ? voteUpEl.textContent : ''),
            comment_count: parseStat(commentButton ? commentButton.textContent : ''),
          });
        }
      });
      return results;
    });
  }

  private async fetchContentDetail(target: string, sourceKeyword: string): Promise<any | null> {
    const resolved = await resolveRedirect(this.page!, target);
    const answerId = resolved.match(/\/answer\/(\d+)/i)?.[1];
    const articleId = resolved.match(/(?:zhuanlan\.zhihu\.com\/p|\/article)\/(\d+)/i)?.[1];
    const questionId = resolved.match(/\/question\/(\d+)/i)?.[1];
    const rawId = /^\d+$/.test(resolved.trim()) ? resolved.trim() : '';
    const type = answerId ? 'answer' : articleId ? 'article' : questionId ? 'question' : 'answer';
    const contentId = answerId || articleId || questionId || rawId;
    const apiUrl = type === 'article'
      ? `https://www.zhihu.com/api/v4/articles/${contentId}`
      : type === 'question'
        ? `https://www.zhihu.com/api/v4/questions/${contentId}`
        : `https://www.zhihu.com/api/v4/answers/${contentId}`;
    try {
      const result = await this.page!.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).json(), apiUrl);
      if (!result?.id) throw new Error(result?.message || 'content not found');
      const question = result.question || (type === 'question' ? result : {});
      const author = result.author || {};
      const record = {
        content_id: String(result.id), content_type: type,
        content_text: stripHtml(result.content || result.detail || result.excerpt || ''),
        content_url: type === 'article'
          ? `https://zhuanlan.zhihu.com/p/${result.id}`
          : type === 'question'
            ? `https://www.zhihu.com/question/${result.id}`
            : `https://www.zhihu.com/question/${question.id || ''}/answer/${result.id}`,
        question_id: String(question.id || ''), title: result.title || question.title || '',
        desc: stripHtml(result.excerpt || result.content || result.detail || ''),
        created_time: result.created_time || result.created || 0,
        updated_time: result.updated_time || result.updated || 0,
        voteup_count: result.voteup_count || result.vote_count || 0,
        comment_count: result.comment_count || 0, source_keyword: sourceKeyword,
        creator_hash: author.url_token || String(author.id || ''), user_nickname: author.name || '',
      };
      await connectorOutput.emitZhihuContent(record);
      if (activeConfig.ENABLE_GET_COMMENTS) await this.getContentComments(record.content_id, type);
      return record;
    } catch (error: any) {
      console.error(`[ZHIHU] Failed to collect detail ${target}: ${error.message}`);
      return null;
    }
  }

  private async getContentComments(contentId: string, contentType: string): Promise<void> {
    const resource = contentType === 'article' ? 'articles' : contentType === 'question' ? 'questions' : 'answers';
    const url = `https://www.zhihu.com/api/v4/${resource}/${encodeURIComponent(contentId)}/root_comments?order=normal&limit=${activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES}&offset=0&status=open`;
    try {
      const result = await this.page!.evaluate(async (apiUrl) => (await fetch(apiUrl, { credentials: 'include' })).json(), url);
      const comments = result?.data || [];
      const store = async (comment: any, parent = '') => connectorOutput.emitZhihuComment({
        comment_id: String(comment.id || ''), parent_comment_id: parent,
        content: stripHtml(comment.content || ''), publish_time: comment.created_time || 0,
        sub_comment_count: comment.child_comment_count || 0, like_count: comment.vote_count || 0,
        dislike_count: comment.dislike_count || 0, content_id: contentId, content_type: contentType,
        creator_hash: comment.author?.member?.url_token || comment.author?.url_token || '',
        user_nickname: comment.author?.member?.name || comment.author?.name || '',
      });
      for (const comment of comments) {
        await store(comment);
        if (activeConfig.ENABLE_GET_SUB_COMMENTS) {
          for (const child of comment.child_comments || []) await store(child, String(comment.id || ''));
        }
      }
      console.log(`[ZHIHU] Stored ${comments.length} comments for ${contentType}:${contentId}`);
    } catch (error: any) {
      console.error(`[ZHIHU] Failed to collect comments for ${contentType}:${contentId}: ${error.message}`);
    }
  }

  public async getSpecifiedContents(): Promise<void> {
    for (const target of configuredTargets('zhihu', 'detail')) await this.fetchContentDetail(target, '指定内容');
  }

  public async getCreatorsAndContents(): Promise<void> {
    for (const target of configuredTargets('zhihu', 'creator')) {
      const resolved = await resolveRedirect(this.page!, target);
      const token = firstMatch(resolved, [/\/people\/([^/?#]+)/i, /[?&]url_token=([^&#]+)/i]);
      const limit = activeConfig.CRAWLER_MAX_NOTES_COUNT || 20;

      // The member endpoints already return full records, so one paged request
      // replaces the old "scrape a screenful of links, then hit the detail API
      // once per link" pattern.
      const records = [
        ...await this.fetchCreatorRecords(token, 'answers', limit),
        ...await this.fetchCreatorRecords(token, 'articles', limit),
      ].slice(0, limit);

      if (records.length) {
        console.log(`[ZHIHU] Creator ${token}: collected ${records.length} contents via member API`);
        for (const record of records) {
          await connectorOutput.emitZhihuContent(record);
          if (activeConfig.ENABLE_GET_COMMENTS) await this.getContentComments(record.content_id, record.content_type);
          await this.humanDelay(this.page!);
        }
        continue;
      }

      console.warn(`[ZHIHU] Member API returned nothing for ${token}, falling back to profile page links...`);
      await this.page!.goto(`https://www.zhihu.com/people/${encodeURIComponent(token)}/posts`, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(1800);
      const links = await this.page!.evaluate(() => Array.from(document.querySelectorAll('a[href*="/answer/"], a[href*="zhuanlan.zhihu.com/p/"]'))
        .map((link) => link.getAttribute('href') || '').filter(Boolean));
      const unique = [...new Set(links)].slice(0, limit);
      console.log(`[ZHIHU] Creator ${token}: discovered ${unique.length} contents`);
      for (const link of unique) await this.fetchContentDetail(link, `作者:${token}`);
    }
  }

  /** Page through /api/v4/members/{token}/{answers|articles}. */
  private async fetchCreatorRecords(token: string, resource: 'answers' | 'articles', limit: number): Promise<any[]> {
    const include = resource === 'answers'
      ? 'data[*].content,excerpt,voteup_count,comment_count,created_time,updated_time,question.title,author.url_token'
      : 'data[*].content,excerpt,voteup_count,comment_count,created,updated,author.url_token';
    const records: any[] = [];

    // Zhihu's member API is served from the site origin, so an in-page fetch
    // carries the session cookies and signing wrapper for free.
    if (!this.page!.url().includes('zhihu.com')) {
      await this.page!.goto(`https://www.zhihu.com/people/${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded' });
    }

    let offset = 0;
    while (records.length < limit) {
      const url = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(token)}/${resource}`
        + `?include=${encodeURIComponent(include)}&offset=${offset}&limit=20&sort_by=created`;
      let payload: any;
      try {
        payload = await this.page!.evaluate(async (apiUrl) => (await fetch(apiUrl, { credentials: 'include' })).json(), url);
      } catch (error: any) {
        console.error(`[ZHIHU] Failed to page ${resource} for ${token}: ${error.message}`);
        break;
      }
      const batch = payload?.data;
      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const item of batch) {
        const record = this.buildSearchRecord({ object: { ...item, type: resource === 'articles' ? 'article' : 'answer' } });
        if (record) records.push({ ...record, source_keyword: `作者:${token}` });
      }

      if (payload?.paging?.is_end) break;
      offset += batch.length;
      await this.humanDelay(this.page!);
    }
    return records.slice(0, limit);
  }
}
