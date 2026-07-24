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
        const searchUrl = `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(keyword)}`;
        await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await this.page!.waitForTimeout(3000);

        // Scroll
        await this.page!.evaluate(() => window.scrollBy(0, 1000));
        await this.page!.waitForTimeout(1000);

        const items = await this.page!.evaluate(() => {
          const results: any[] = [];
          const cards = document.querySelectorAll('.Search-card, .ContentItem');
          
          const parseStat = (text: string | null) => {
            if (!text) return 0;
            const match = text.replace(/,/g, '').match(/\d+/);
            return match ? parseInt(match[0]) : 0;
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
              
              results.push({
                content_id: contentId,
                content_type: type,
                title: titleEl.textContent?.trim() || '',
                content_url: href.startsWith('http') ? href : 'https://www.zhihu.com' + href,
                desc: bodyEl?.textContent?.trim() || '',
                user_nickname: authorEl?.textContent?.trim() || '',
                creator_hash: authorEl?.getAttribute('href')?.split('/').pop() || '',
                voteup_count: parseStat(voteUpEl ? voteUpEl.textContent : ''),
                comment_count: parseStat(commentButton ? commentButton.textContent : ''),
              });
            }
          });
          return results;
        });

        console.log(`[ZHIHU] Found ${items.length} answers/articles. Ingesting...`);
        let count = 0;
        
        for (const it of items) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!it.content_id) continue;

          const contentDetail = {
            content_id: it.content_id,
            content_type: it.content_type,
            content_text: it.desc,
            content_url: it.content_url,
            title: it.title,
            desc: it.desc,
            voteup_count: it.voteup_count,
            comment_count: it.comment_count,
            user_nickname: it.user_nickname,
            creator_hash: it.creator_hash,
            source_keyword: keyword,
          };

          await connectorOutput.emitZhihuContent(contentDetail);
          if (activeConfig.ENABLE_GET_COMMENTS) await this.getContentComments(it.content_id, it.content_type);
          count++;
          
          await this.humanDelay(this.page!);
        }
      } catch (err: any) {
        console.error(`[ZHIHU] Search error for keyword ${keyword}:`, err.message);
      }
    }
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
      await this.page!.goto(`https://www.zhihu.com/people/${encodeURIComponent(token)}/posts`, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(1800);
      const links = await this.page!.evaluate(() => Array.from(document.querySelectorAll('a[href*="/answer/"], a[href*="zhuanlan.zhihu.com/p/"]'))
        .map((link) => link.getAttribute('href') || '').filter(Boolean));
      const unique = [...new Set(links)].slice(0, activeConfig.CRAWLER_MAX_NOTES_COUNT);
      console.log(`[ZHIHU] Creator ${token}: discovered ${unique.length} contents`);
      for (const link of unique) await this.fetchContentDetail(link, `作者:${token}`);
    }
  }
}
