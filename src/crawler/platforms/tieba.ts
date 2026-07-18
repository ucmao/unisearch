import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { CDPBrowserManager } from '../../tools/browser';
import { dbStore } from '../store';
import fs from 'fs';

export class TiebaCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  public cdpManager: CDPBrowserManager | null = null;

  public async start(): Promise<void> {
    console.log('[TIEBA] Starting Tieba crawler...');
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

    await this.page.goto('https://tieba.baidu.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    }

    console.log('[TIEBA] Tieba crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[TIEBA] Checking login state...');
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
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some((c) => c.name === 'STOKEN' || c.name === 'PTOKEN');
        if (hasSession) {
          console.log('[TIEBA] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[TIEBA] Error checking cookies:', err.message);
    }
    try {
      const visible = await this.page!.isVisible('.u_username, .user_name', { timeout: 1000 });
      return visible;
    } catch {
      return false;
    }
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[TIEBA] Searching keyword: ${keyword}`);
      try {
        const searchUrl = `https://tieba.baidu.com/f/search/res?qw=${encodeURIComponent(keyword)}`;
        await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await this.page!.waitForTimeout(3000);

        // Scroll
        await this.page!.evaluate(() => window.scrollBy(0, 1000));
        await this.page!.waitForTimeout(1000);

        const posts = await this.page!.evaluate(() => {
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

        console.log(`[TIEBA] Found ${posts.length} threads. Ingesting...`);
        let count = 0;
        
        for (const p of posts) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!p.note_id) continue;

          const noteDetail = {
            note_id: p.note_id,
            title: p.title,
            desc: p.desc,
            note_url: p.note_url,
            user_nickname: p.user_nickname,
            creator_hash: p.creator_hash,
            total_replay_num: p.comment_count,
            total_replay_page: Math.ceil(p.comment_count / 30),
            tieba_name: p.tieba_name,
            tieba_link: p.tieba_link,
            source_keyword: keyword,
          };

          await dbStore.storeTiebaNote(noteDetail);
          count++;
          
          await this.page!.waitForTimeout(activeConfig.CRAWLER_MAX_SLEEP_SEC * 1000);
        }
      } catch (err: any) {
        console.error(`[TIEBA] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }
}
