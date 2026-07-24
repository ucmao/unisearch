import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DeepSeekCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[DEEPSEEK] Starting DeepSeek AI Web QA crawler...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'deepseek');

    console.log('[DEEPSEEK] Navigating to DeepSeek Web Chat (https://chat.deepseek.com/)...');
    await this.page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
      console.warn(`[DEEPSEEK] Initial page load warning: ${err.message}`);
    });

    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search' || !activeConfig.CRAWLER_TYPE) {
      await this.search();
    } else {
      await this.search();
    }

    console.log('[DEEPSEEK] DeepSeek AI Web QA crawler finished.');
  }

  private async checkLoginState(): Promise<boolean> {
    if (!this.page) return false;
    try {
      const url = this.page.url();
      if (url.includes('sign_in') || url.includes('login')) return false;

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
      console.log('[DEEPSEEK] Applying provided cookies...');
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.deepseek.com');
      await this.page!.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    console.log('[DEEPSEEK] Checking login status...');
    let isLoggedIn = await this.checkLoginState();
    if (!isLoggedIn) {
      console.log('[DEEPSEEK] User is not logged in or login dialog is present. Waiting up to 120s for manual login in crawler window...');

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
          console.log('[DEEPSEEK] Login verified successfully!');
          break;
        }
        if (Date.now() - lastLogTs > 10000) {
          const remainingSec = Math.round((maxLoginWaitMs - (Date.now() - startTime)) / 1000);
          console.log(`[DEEPSEEK] Waiting for user to complete login in the crawler window... (${remainingSec}s remaining)`);
          lastLogTs = Date.now();
        }
        await sleep(1500);
      }

      if (!isLoggedIn) {
        console.warn('[DEEPSEEK] 120s login wait timeout. Will attempt to proceed if input box is ready.');
      }
    } else {
      console.log('[DEEPSEEK] Login state verified.');
    }
  }

  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 1;

    for (let i = 0; i < Math.min(keywords.length, maxItems); i++) {
      const keyword = keywords[i];
      console.log(`[DEEPSEEK] [${i + 1}/${keywords.length}] Processing AI QA prompt: "${keyword}"...`);

      try {
        await this.askQuestion(keyword);
      } catch (err: any) {
        console.error(`[DEEPSEEK] Failed to process prompt "${keyword}": ${err.message}`);
      }
    }
  }

  private async findInputSelector(): Promise<string | null> {
    if (!this.page) return null;
    const inputSelectors = [
      '#chat-input',
      'textarea#chat-input',
      'textarea[placeholder*="DeepSeek"]',
      'textarea[placeholder*="发送"]',
      'textarea[placeholder*="问"]',
      'textarea[placeholder*="输入"]',
      'textarea',
      'div[contenteditable="true"]',
      'div[role="textbox"]',
    ];

    for (const sel of inputSelectors) {
      const visible = await this.page.isVisible(sel).catch(() => false);
      if (visible) return sel;
    }

    const hasAnyInput = await this.page.evaluate(() => {
      const el = document.querySelector('textarea, div[contenteditable="true"], #chat-input, div[role="textbox"]');
      return !!el;
    }).catch(() => false);

    if (hasAnyInput) {
      return 'textarea, div[contenteditable="true"], #chat-input, div[role="textbox"]';
    }

    return null;
  }

  private async askQuestion(question: string): Promise<void> {
    if (!this.page) return;

    console.log('[DEEPSEEK] Waiting for DeepSeek page input box to be ready (up to 60s)...');

    let inputSelectorFound: string | null = null;
    const startTime = Date.now();
    const waitTimeoutMs = 60000;

    while (Date.now() - startTime < waitTimeoutMs) {
      inputSelectorFound = await this.findInputSelector();
      if (inputSelectorFound) break;
      await sleep(1500);
    }

    if (!inputSelectorFound) {
      throw new Error('DeepSeek chat input box not found within 60s. Please ensure you are logged into https://chat.deepseek.com/ in the crawler window.');
    }

    console.log(`[DEEPSEEK] Found chat input box using selector: ${inputSelectorFound}`);

    try {
      await this.page.click(inputSelectorFound, { timeout: 3000 }).catch(() => {});
      await sleep(200);

      await this.page.keyboard.press('ControlOrMeta+A').catch(() => {});
      await this.page.keyboard.press('Backspace').catch(() => {});
      await sleep(200);

      await this.page.keyboard.insertText(question).catch(async () => {
        await this.page!.fill(inputSelectorFound!, question);
      });
    } catch (err: any) {
      console.warn(`[DEEPSEEK] Fill input warning: ${err.message}`);
    }

    await sleep(600);

    const sendButtonSelectors = [
      'button:has(svg)',
      'button:has(path)',
      'button[aria-label*="发送"]',
      'button[type="submit"]',
      '.ds-icon-button',
      'div[role="button"]:has-text("发送")',
      'button:has-text("发送")',
    ];

    let sent = false;
    for (const btnSel of sendButtonSelectors) {
      if (await this.page.isVisible(btnSel).catch(() => false)) {
        console.log(`[DEEPSEEK] Clicking send button via selector: ${btnSel}`);
        await this.page.click(btnSel).catch(() => {});
        sent = true;
        break;
      }
    }

    console.log('[DEEPSEEK] Pressing physical Keyboard Enter to ensure prompt submission...');
    await this.page.keyboard.press('Enter').catch(() => {});

    console.log('[DEEPSEEK] Prompt submitted. Waiting for DeepSeek streaming response...');

    const responseStartTime = Date.now();
    const maxWaitMs = 120000;
    let lastContentLength = 0;
    let stableCount = 0;

    while (Date.now() - responseStartTime < maxWaitMs) {
      await sleep(1500);

      const isGenerating = await this.page.isVisible('.ds-icon-stop, button:has-text("停止"), [aria-label*="Stop"]').catch(() => false);

      const responseText = await this.page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.ds-markdown, .markdown-body, .ds-message-item'));
        if (nodes.length === 0) return document.body.innerText || '';
        const lastNode = nodes[nodes.length - 1];
        return lastNode ? (lastNode as HTMLElement).innerText : '';
      }).catch(() => '');

      const currentLen = responseText.length;
      console.log(`[DEEPSEEK] Generation progress check: length = ${currentLen} chars (generating = ${isGenerating})`);

      if (!isGenerating && currentLen > 0) {
        if (currentLen === lastContentLength) {
          stableCount++;
          if (stableCount >= 2) {
            console.log('[DEEPSEEK] Response generation completed!');
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
      const thoughtNodes = Array.from(document.querySelectorAll('.ds-markdown--thought, .ds-thought-process, details'));
      const reasoning = thoughtNodes.map((n) => (n as HTMLElement).innerText).join('\n\n').trim();

      const markdownNodes = Array.from(document.querySelectorAll('.ds-markdown, .markdown-body'));
      const mainAnswerNode = markdownNodes.length > 0 ? markdownNodes[markdownNodes.length - 1] : null;
      const answer = mainAnswerNode ? (mainAnswerNode as HTMLElement).innerText : '';

      const citationLinks: Array<{ title: string; url: string }> = [];
      const linkElements = mainAnswerNode ? Array.from(mainAnswerNode.querySelectorAll('a[href]')) : Array.from(document.querySelectorAll('a[href]'));

      for (const link of linkElements) {
        const href = (link as HTMLAnchorElement).href;
        const title = (link as HTMLElement).innerText.trim() || (link as HTMLAnchorElement).title || href;
        if (href && href.startsWith('http') && !href.includes('deepseek.com')) {
          citationLinks.push({ title, url: href });
        }
      }

      return {
        reasoning,
        answer: answer || '未获取到完整回答',
        citations: citationLinks,
        url: window.location.href,
      };
    });

    console.log(`[DEEPSEEK] Collected response for "${question}":`);
    console.log(`  - Answer Length: ${resultData.answer.length} chars`);
    console.log(`  - Reasoning Length: ${resultData.reasoning.length} chars`);
    console.log(`  - Citations Count: ${resultData.citations.length} links`);

    await connectorOutput.emitDeepSeekResult({
      question,
      title: question,
      reasoning_content: resultData.reasoning,
      answer: resultData.answer,
      citations: resultData.citations,
      url: resultData.url,
      source_keyword: question,
      time: Date.now(),
    });

    console.log(`[DEEPSEEK] Successfully stored AI QA result into SQLite database.`);
  }
}
