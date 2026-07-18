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
      const browser = await p.chromium.launch({ headless: activeConfig.HEADLESS });
      this.browserContext = await browser.newContext();
      this.page = await this.browserContext.newPage();
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
        await this.page!.click('.login-btn, .gn_login', { timeout: 3000 });
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
      const visible = await this.page!.isVisible('.gn_position, .nav-avatar', { timeout: 1000 });
      return visible;
    } catch {
      return false;
    }
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
          
          cardElements.forEach((card) => {
            const mid = card.getAttribute('mid') || '';
            const contentEl = card.querySelector('p.txt[node-type="feed_list_content"]');
            const authorEl = card.querySelector('a.name');
            const urlEl = card.querySelector('.from a[href*="/status/"]');
            
            if (contentEl && authorEl) {
              items.push({
                note_id: mid,
                content: contentEl.textContent?.trim() || '',
                nickname: authorEl.textContent?.trim() || '',
                creator_hash: authorEl.getAttribute('usercard')?.match(/id=([0-9]+)/)?.[1] || '',
                note_url: urlEl ? 'https:' + urlEl.getAttribute('href') : '',
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
            liked_count: '0',
            comments_count: '0',
            shared_count: '0',
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
