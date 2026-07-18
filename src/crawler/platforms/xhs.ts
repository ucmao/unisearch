import { chromium, Playwright, BrowserContext, Page, asyncPlaywright } from 'playwright';
import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { CDPBrowserManager } from '../../tools/browser';
import { dbStore } from '../store';

export class XiaoHongShuCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  public cdpManager: CDPBrowserManager | null = null;

  public async start(): Promise<void> {
    console.log('[XHS] Starting XiaoHongShu crawler...');
    
    // Choose standard or CDP launch
    const p = require('playwright');
    const playwrightInstance = await p.chromium.launch ? p : null; // In node it resolves standard playwright package
    
    // We will use standard chromium if cdp is disabled
    const playwright = await require('playwright').chromium ? require('playwright') : null;

    if (activeConfig.ENABLE_CDP_MODE) {
      console.log('[XHS] Launching browser in CDP mode');
      this.cdpManager = new CDPBrowserManager();
      this.browserContext = await this.cdpManager.launchAndConnect(playwright);
      this.page = await this.cdpManager.newPage();
    } else {
      console.log('[XHS] Launching browser in standard mode');
      const path = require('path');
      const userDataDir = path.join(
        process.cwd(),
        'browser_data',
        activeConfig.USER_DATA_DIR.replace('%s', activeConfig.PLATFORM)
      );
      this.browserContext = await playwright.chromium.launchPersistentContext(userDataDir, {
        headless: activeConfig.HEADLESS,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });
      this.page = this.browserContext.pages().length > 0 ? this.browserContext.pages()[0] : await this.browserContext.newPage();
    }

    // Add stealth init script
    const stealthPath = 'libs/stealth.min.js';
    if (fs.existsSync(stealthPath)) {
      await this.browserContext.addInitScript({ path: stealthPath });
    }

    // Navigate to homepage
    const indexUrl = activeConfig.XHS_INTERNATIONAL ? 'https://www.rednote.com' : 'https://www.xiaohongshu.com';
    await this.page.goto(indexUrl, { waitUntil: 'domcontentloaded' });

    // Handle Login
    await this.handleLogin();

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

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[XHS] Login successful!');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!isLoggedIn) {
        throw new Error('Login failed: QR Code scan timeout');
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
    const indexUrl = activeConfig.XHS_INTERNATIONAL ? 'https://www.rednote.com' : 'https://www.xiaohongshu.com';
    
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

        console.log(`[XHS] Found ${notes.length} notes. Ingesting...`);
        let count = 0;
        
        for (const item of notes) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (item.model_type === 'rec_query' || item.model_type === 'hot_query') continue;

          // v2 search results keep display fields under note_card while the id
          // and xsec_token remain on the outer item.
          const card = item.note_card || item;
          const noteId = item.id || item.note_id || card.note_id;
          if (!noteId) continue;

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

          await dbStore.storeXhsNote(noteDetail);
          count++;

          // Crawl comments if enabled
          if (activeConfig.ENABLE_GET_COMMENTS) {
            await this.crawlComments(noteDetail.note_id, noteDetail.xsec_token);
          }

          await this.page!.waitForTimeout(activeConfig.CRAWLER_MAX_SLEEP_SEC * 1000);
        }
      } catch (err: any) {
        console.error(`[XHS] Error searching keyword ${keyword}:`, err.message);
        throw err;
      }
    }
  }

  private async crawlComments(noteId: string, xsecToken: string): Promise<void> {
    console.log(`[XHS] Crawling comments for note: ${noteId}`);
    try {
      const comments = await this.page!.evaluate(async ({ id, token }) => {
        try {
          const apiHost = window.location.hostname.includes('rednote.com') ? 'webapi.rednote.com' : 'edith.xiaohongshu.com';
          const url = `https://${apiHost}/web_api/sns/v2/comment/page?note_id=${id}&xsec_token=${token}&image_formats=jpg,webp,gif`;

          const resp = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json, text/plain, */*',
            },
          });
          
          const text = await resp.text();
          const data = JSON.parse(text);
          return data.data?.comments || [];
        } catch (err: any) {
          return [];
        }
      }, { id: noteId, token: xsecToken });

      console.log(`[XHS] Crawled ${comments.length} comments.`);
      
      let count = 0;
      for (const commentItem of comments) {
        if (count >= activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES) break;

        const dbComment = {
          comment_id: commentItem.id,
          create_time: commentItem.create_time,
          note_id: noteId,
          content: commentItem.content,
          creator_hash: commentItem.user_info?.user_id || '',
          nickname: commentItem.user_info?.nickname || '',
          sub_comment_count: commentItem.sub_comment_count || 0,
          pictures: commentItem.pictures?.map((p: any) => p.url || '').join(',') || '',
          parent_comment_id: '',
          like_count: commentItem.like_count || 0,
        };

        await dbStore.storeXhsComment(dbComment);
        count++;

        // Sub comments crawling
        if (activeConfig.ENABLE_GET_SUB_COMMENTS && dbComment.sub_comment_count > 0) {
          await this.crawlSubComments(noteId, xsecToken, dbComment.comment_id);
        }
      }
    } catch (err: any) {
      console.error(`[XHS] Error crawling comments for note ${noteId}:`, err.message);
    }
  }

  private async crawlSubComments(noteId: string, xsecToken: string, rootCommentId: string): Promise<void> {
    try {
      const subComments = await this.page!.evaluate(async ({ id, token, rootId }) => {
        try {
          const apiHost = window.location.hostname.includes('rednote.com') ? 'webapi.rednote.com' : 'edith.xiaohongshu.com';
          const url = `https://${apiHost}/web_api/sns/v2/comment/sub/page?note_id=${id}&xsec_token=${token}&root_comment_id=${rootId}&page_size=10&image_formats=jpg,webp,gif`;

          const resp = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json, text/plain, */*',
            },
          });
          
          const text = await resp.text();
          const data = JSON.parse(text);
          return data.data?.comments || [];
        } catch (err: any) {
          return [];
        }
      }, { id: noteId, token: xsecToken, rootId: rootCommentId });

      for (const sub of subComments) {
        const dbSub = {
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
        };
        await dbStore.storeXhsComment(dbSub);
      }
    } catch (err: any) {
      console.error(`[XHS] Error crawling sub comments:`, err.message);
    }
  }

  public async getSpecifiedNotes(): Promise<void> {
    console.log('[XHS] Specified notes details crawling (placeholder)...');
    // Port of specified notes details using page.evaluate('/web_api/sns/v1/note/detail')
  }

  public async getCreatorsAndNotes(): Promise<void> {
    console.log('[XHS] Creator posted notes crawling (placeholder)...');
    // Port of creator posted notes using page.evaluate('/web_api/sns/v1/user/posted')
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
import fs from 'fs';
