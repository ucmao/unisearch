import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { dbStore } from '../store';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class KimiCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[KIMI] Starting Kimi AI Web QA crawler...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'kimi');

    console.log('[KIMI] Navigating to Kimi Web Chat (https://kimi.moonshot.cn/)...');
    await this.page.goto('https://kimi.moonshot.cn/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
      console.warn(`[KIMI] Initial page load warning: ${err.message}`);
    });

    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search' || !activeConfig.CRAWLER_TYPE) {
      await this.search();
    } else {
      await this.search();
    }

    console.log('[KIMI] Kimi AI Web QA crawler finished.');
  }

  private async checkLoginState(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const url = this.page.url();
      if (url.includes('login') || url.includes('sign_in')) return false;

      const hasLoginDialog = await this.page.isVisible('[class*="login-modal"], [class*="login-dialog"], [class*="login-container"], [class*="mask"]', { timeout: 1000 }).catch(() => false);
      if (hasLoginDialog) return false;

      const hasAvatar = await this.page.isVisible('[class*="avatar"], [class*="user-icon"], [class*="user-profile"], .avatar-container', { timeout: 1000 }).catch(() => false);
      if (hasAvatar) return true;

      const hasLoginBtn = await this.page.isVisible('button:has-text("登录"), a:has-text("登录"), span:has-text("登录"), [class*="login-btn"]', { timeout: 1000 }).catch(() => false);
      if (hasLoginBtn) return false;

      const inputReady = await this.findInputSelector();
      return !!inputReady;
    } catch {
      return false;
    }
  }

  private async handleLogin(): Promise<void> {
    if (activeConfig.COOKIES && this.browserContext) {
      console.log('[KIMI] Applying provided cookies...');
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.moonshot.cn');
      await this.page!.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    console.log('[KIMI] Checking login status...');
    let isLoggedIn = await this.checkLoginState();
    if (!isLoggedIn) {
      console.log('[KIMI] User is not logged in or login dialog is present. Waiting up to 120s for manual login in crawler window...');

      try {
        const loginBtnSelectors = [
          'button:has-text("登录")',
          'a:has-text("登录")',
          'span:has-text("登录")',
          '[class*="login-btn"]',
          '[class*="login-button"]',
        ];
        for (const selector of loginBtnSelectors) {
          if (await this.page!.isVisible(selector).catch(() => false)) {
            await this.page!.click(selector).catch(() => {});
            break;
          }
        }
      } catch {}

      const startTime = Date.now();
      const maxLoginWaitMs = 120000;
      let lastLogTs = 0;

      while (Date.now() - startTime < maxLoginWaitMs) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[KIMI] Login verified successfully!');
          break;
        }
        if (Date.now() - lastLogTs > 10000) {
          const remainingSec = Math.round((maxLoginWaitMs - (Date.now() - startTime)) / 1000);
          console.log(`[KIMI] Waiting for user to complete login in the crawler window... (${remainingSec}s remaining)`);
          lastLogTs = Date.now();
        }
        await sleep(1500);
      }

      if (!isLoggedIn) {
        console.warn('[KIMI] 120s login wait timeout. Will attempt to proceed if input box is ready.');
      }
    } else {
      console.log('[KIMI] Login state verified.');
    }
  }

  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 1;

    for (let i = 0; i < Math.min(keywords.length, maxItems); i++) {
      const keyword = keywords[i];
      console.log(`[KIMI] [${i + 1}/${keywords.length}] Processing AI QA prompt: "${keyword}"...`);

      try {
        await this.askQuestion(keyword);
      } catch (err: any) {
        console.error(`[KIMI] Failed to process prompt "${keyword}": ${err.message}`);
      }
    }
  }

  private async findInputSelector(): Promise<string | null> {
    if (!this.page) return null;
    const inputSelectors = [
      'div[contenteditable="true"]',
      '.editor-input',
      '#chat-input',
      'textarea',
      'div[role="textbox"]',
    ];

    for (const sel of inputSelectors) {
      const visible = await this.page.isVisible(sel).catch(() => false);
      if (visible) return sel;
    }

    const hasAnyInput = await this.page.evaluate(() => {
      const el = document.querySelector('div[contenteditable="true"], .editor-input, textarea, #chat-input, div[role="textbox"]');
      return !!el;
    }).catch(() => false);

    if (hasAnyInput) {
      return 'div[contenteditable="true"], .editor-input, textarea, #chat-input, div[role="textbox"]';
    }

    return null;
  }

  private async askQuestion(question: string): Promise<void> {
    if (!this.page) return;

    console.log('[KIMI] Waiting for Kimi page input box to be ready (up to 60s)...');

    let inputSelectorFound: string | null = null;
    const startTime = Date.now();
    const waitTimeoutMs = 60000;

    while (Date.now() - startTime < waitTimeoutMs) {
      inputSelectorFound = await this.findInputSelector();
      if (inputSelectorFound) break;
      await sleep(1500);
    }

    if (!inputSelectorFound) {
      throw new Error('Kimi chat input box not found within 60s. Please ensure you are logged into https://kimi.moonshot.cn/ in the crawler window.');
    }

    console.log(`[KIMI] Found chat input box using selector: ${inputSelectorFound}`);

    try {
      // Focus on input box
      await this.page.click(inputSelectorFound, { timeout: 3000 }).catch(() => {});
      await sleep(200);

      // Clear existing content and simulate physical keyboard input to activate React state & send button!
      await this.page.keyboard.press('ControlOrMeta+A').catch(() => {});
      await this.page.keyboard.press('Backspace').catch(() => {});
      await sleep(200);

      await this.page.keyboard.insertText(question).catch(async () => {
        await this.page!.fill(inputSelectorFound!, question);
      });
    } catch (err: any) {
      console.warn(`[KIMI] Input box interaction warning: ${err.message}`);
    }

    await sleep(600);

    // Try clicking send button (circular arrow button on Kimi page)
    const sendButtonSelectors = [
      'button:has(svg)',
      'button:has(path)',
      'button[aria-label*="发送"]',
      'button[data-testid*="send"]',
      'button[type="submit"]',
      '.send-button',
      '.send-btn',
      '[class*="send"]',
      'button:has-text("发送")',
    ];

    let sent = false;
    for (const btnSel of sendButtonSelectors) {
      if (await this.page.isVisible(btnSel).catch(() => false)) {
        console.log(`[KIMI] Clicking send button via selector: ${btnSel}`);
        await this.page.click(btnSel).catch(() => {});
        sent = true;
        break;
      }
    }

    // Always follow up with physical Keyboard Enter press
    console.log('[KIMI] Pressing physical Keyboard Enter to ensure prompt submission...');
    await this.page.keyboard.press('Enter').catch(() => {});

    console.log('[KIMI] Prompt submitted. Waiting for Kimi streaming response...');

    const responseStartTime = Date.now();
    const maxWaitMs = 120000;
    let lastContentLength = 0;
    let stableCount = 0;

    while (Date.now() - responseStartTime < maxWaitMs) {
      await sleep(1500);

      const isGenerating = await this.page.isVisible('.stop-button, .stop-icon, button:has-text("停止"), [class*="stop"]').catch(() => false);

      const responseText = await this.page.evaluate(() => {
        const candidateSelectors = [
          '.segment-content',
          '.chat-segment-text',
          '.markdown-body',
          '.markdown',
          '[class*="markdown"]',
          '[class*="segment"]',
          '[class*="chat-message"]',
          '[class*="message-content"]',
          '[class*="chat-content"]',
        ];
        let text = '';
        for (const sel of candidateSelectors) {
          const found = Array.from(document.querySelectorAll(sel));
          if (found.length > 0) {
            const last = found[found.length - 1];
            text = (last as HTMLElement).innerText || '';
            if (text.length > 0) break;
          }
        }
        return text;
      }).catch(() => '');

      const currentLen = responseText.length;
      console.log(`[KIMI] Generation progress check: length = ${currentLen} chars (generating = ${isGenerating})`);

      if (!isGenerating && currentLen > 0) {
        if (currentLen === lastContentLength) {
          stableCount++;
          if (stableCount >= 2) {
            console.log('[KIMI] Response generation completed!');
            break;
          }
        } else {
          stableCount = 0;
          lastContentLength = currentLen;
        }
      } else {
        lastContentLength = currentLen;
        stableCount = 0;
      }
    }

    const resultData = await this.page.evaluate(() => {
      const thoughtNodes = Array.from(document.querySelectorAll('.thought-process, [class*="thought"], details'));
      const reasoning = thoughtNodes.map((n) => (n as HTMLElement).innerText).join('\n\n').trim();

      const candidateSelectors = [
        '.segment-content',
        '.chat-segment-text',
        '.markdown-body',
        '.markdown',
        '[class*="markdown"]',
        '[class*="segment"]',
        '[class*="chat-message"]',
        '[class*="message-content"]',
        '[class*="chat-content"]',
        'div[role="article"]',
      ];

      let targetNode: Element | null = null;
      let maxLen = 0;

      for (const sel of candidateSelectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) {
          const lastEl = found[found.length - 1];
          const text = (lastEl as HTMLElement).innerText || '';
          if (text.length > maxLen) {
            maxLen = text.length;
            targetNode = lastEl;
          }
        }
      }

      if (!targetNode || maxLen < 10) {
        const allBlocks = Array.from(document.querySelectorAll('div, p, section')).filter((el) => {
          const text = (el as HTMLElement).innerText || '';
          return text.length > 30 && !el.querySelector('textarea, input, button');
        });
        if (allBlocks.length > 0) {
          targetNode = allBlocks[allBlocks.length - 1];
        }
      }

      const answerText = targetNode ? (targetNode as HTMLElement).innerText.trim() : '';

      const citationLinks: Array<{ title: string; url: string }> = [];
      const linkElements = targetNode ? Array.from(targetNode.querySelectorAll('a[href]')) : Array.from(document.querySelectorAll('a[href]'));

      for (const link of linkElements) {
        const href = (link as HTMLAnchorElement).href;
        const title = (link as HTMLElement).innerText.trim() || (link as HTMLAnchorElement).title || href;
        if (href && href.startsWith('http') && !href.includes('moonshot.cn') && !href.includes('kimi.ai') && !href.includes('kimi.com')) {
          citationLinks.push({ title, url: href });
        }
      }

      return {
        reasoning,
        answer: answerText.length > 0 ? answerText : 'Kimi Web 已生成完成（需查看内置页面详情）',
        citations: citationLinks,
        url: window.location.href,
      };
    });

    console.log(`[KIMI] Collected response for "${question}":`);
    console.log(`  - Answer Length: ${resultData.answer.length} chars`);
    console.log(`  - Reasoning Length: ${resultData.reasoning.length} chars`);
    console.log(`  - Citations Count: ${resultData.citations.length} links`);

    await dbStore.storeKimiResult({
      question,
      title: question,
      reasoning_content: resultData.reasoning,
      answer: resultData.answer,
      citations: resultData.citations,
      url: resultData.url,
      source_keyword: question,
      time: Date.now(),
    });

    console.log(`[KIMI] Successfully stored Kimi AI QA result into SQLite database.`);
  }
}
