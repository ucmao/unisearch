import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { CDPBrowserManager } from '../../tools/browser';
import { dbStore } from '../store';
import fs from 'fs';

export class WeiboCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  public cdpManager: CDPBrowserManager | null = null;

  public async start(): Promise<void> {
    console.log('[WEIBO] Starting Weibo crawler...');
    const p = require('playwright');
    
    if (activeConfig.ENABLE_CDP_MODE) {
      this.cdpManager = new CDPBrowserManager();
      this.browserContext = await this.cdpManager.launchAndConnect(p);
      this.page = await this.cdpManager.newPage();
    } else {
      const path = require('path');
      const userDataDir = path.join(
        process.cwd(),
        'browser_data',
        activeConfig.USER_DATA_DIR.replace('%s', activeConfig.PLATFORM)
      );
      this.browserContext = await p.chromium.launchPersistentContext(userDataDir, {
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

    const stealthPath = 'libs/stealth.min.js';
    if (fs.existsSync(stealthPath)) {
      await this.browserContext.addInitScript({ path: stealthPath });
    }

    await this.page.goto('https://weibo.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    }

    console.log('[WEIBO] Weibo crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[WEIBO] Checking login state...');
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
      console.log(`[WEIBO] Searching keyword: ${keyword}`);
      try {
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
              if (!text) return '0';
              const cleanText = text.trim();
              if (cleanText.includes('万')) {
                const numStr = cleanText.replace('万', '').trim();
                const val = parseFloat(numStr);
                return isNaN(val) ? '0' : Math.round(val * 10000).toString();
              }
              const match = cleanText.match(/\d+/);
              return match ? match[0] : '0';
            };
            
            cardElements.forEach((card) => {
              const mid = card.getAttribute('mid') || '';
              const contentEl = card.querySelector('p.txt[node-type="feed_list_content"]');
              const authorEl = card.querySelector('a.name');
              const urlEl = card.querySelector('.from a[href*="/status/"]');
              
              const repostEl = card.querySelector('a[action-type="feed_list_forward"]');
              const commentEl = card.querySelector('a[action-type="feed_list_comment"]');
              const likeEl = card.querySelector('.woo-like-count, a[action-type="feed_list_like"]');
              
              if (contentEl && authorEl) {
                items.push({
                  note_id: mid,
                  content: contentEl.textContent?.trim() || '',
                  nickname: authorEl.textContent?.trim() || '',
                  creator_hash: authorEl.getAttribute('usercard')?.match(/id=([0-9]+)/)?.[1] || '',
                  note_url: urlEl ? 'https:' + urlEl.getAttribute('href') : '',
                  shared_count: parseStat(repostEl ? repostEl.textContent : ''),
                  comments_count: parseStat(commentEl ? commentEl.textContent : ''),
                  liked_count: parseStat(likeEl ? likeEl.textContent : ''),
                });
              }
            });
            return items;
          });

        console.log(`[WEIBO] Found ${cards.length} posts. Ingesting...`);
        let count = 0;
        
        for (const c of cards) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!c.note_id) continue;

          const noteDetail = {
            note_id: c.note_id,
            content: c.content,
            nickname: c.nickname,
            creator_hash: c.creator_hash,
            note_url: c.note_url,
            liked_count: c.liked_count,
            comments_count: c.comments_count,
            shared_count: c.shared_count,
            create_time: Math.floor(Date.now() / 1000),
            source_keyword: keyword,
          };

          await dbStore.storeWeiboNote(noteDetail);
          count++;
          
          await this.page!.waitForTimeout(activeConfig.CRAWLER_MAX_SLEEP_SEC * 1000);
        }
      } catch (err: any) {
        console.error(`[WEIBO] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }
}
