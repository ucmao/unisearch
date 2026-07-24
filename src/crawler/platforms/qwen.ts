import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage, notifyLoginRequired, notifyLoginSuccess } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';

const QWEN_URL = 'https://www.qianwen.com/';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 通义千问网页版问答采集器。选择器同时覆盖 textarea 和 contenteditable 两种输入实现。 */
export class QwenCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[QWEN] Starting 通义千问 AI Web QA crawler...');
    this.browserContext = await connectToElectronChromium(require('playwright'));
    this.page = await getElectronCrawlerPage(this.browserContext, 'qwen');
    await this.page.goto(QWEN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((error) => {
      console.warn(`[QWEN] Initial page load warning: ${error.message}`);
    });
    await this.handleLogin();
    await this.search();
    console.log('[QWEN] 通义千问 AI Web QA crawler finished.');
  }

  private async findInputSelector(): Promise<string | null> {
    if (!this.page) return null;
    const selectors = [
      'textarea[placeholder*="问"]', 'textarea[placeholder*="输入"]', 'textarea[placeholder*="Ask"]',
      'textarea', 'div[contenteditable="true"]', 'div[role="textbox"]', '[contenteditable="true"]',
    ];
    for (const selector of selectors) {
      if (await this.page.isVisible(selector).catch(() => false)) return selector;
    }
    return null;
  }

  private async isLoggedIn(): Promise<boolean> {
    if (!this.page || /login|sign-in|signin/.test(this.page.url())) return false;
    // 通义千问可在匿名态展示输入框；能输入即允许执行，提交失败会提供明确错误。
    if (await this.findInputSelector()) return true;
    const hasLogin = await this.page.isVisible('button:has-text("登录"), button:has-text("Log in"), a:has-text("登录"), [class*="login"]')
      .catch(() => false);
    return !hasLogin;
  }

  private async handleLogin(): Promise<void> {
    if (!this.page || !this.browserContext) return;
    if (activeConfig.COOKIES) {
      console.log('[QWEN] Applying provided cookies...');
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.qianwen.com');
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    if (await this.isLoggedIn()) {
      notifyLoginSuccess('qwen');
      return;
    }
    notifyLoginRequired('qwen', '请在内置通义千问窗口完成登录；登录成功后任务会自动继续。');
    await this.page.click('button:has-text("登录"), button:has-text("Log in"), a:has-text("登录"), [class*="login-btn"]')
      .catch(() => {});
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (await this.isLoggedIn()) {
        notifyLoginSuccess('qwen');
        return;
      }
      await sleep(1500);
    }
    throw new Error('通义千问尚未登录。请在内置浏览器完成登录后重新执行任务。');
  }

  public async search(): Promise<void> {
    const questions = (activeConfig.KEYWORDS || '').split(',').map((value) => value.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 1;
    let successful = 0;
    for (const [index, question] of questions.slice(0, maxItems).entries()) {
      console.log(`[QWEN] [${index + 1}/${questions.length}] Processing prompt: "${question}"...`);
      try {
        await this.askQuestion(question);
        successful++;
      } catch (error: any) {
        console.error(`[QWEN] Failed to process prompt "${question}": ${error.message}`);
      }
    }
    if (questions.length > 0 && successful === 0) {
      throw new Error('通义千问未返回可提取的回答。请检查登录状态或页面是否要求人工验证。');
    }
  }

  private async askQuestion(question: string): Promise<void> {
    if (!this.page) return;
    const deadline = Date.now() + 60000;
    let input: string | null = null;
    while (Date.now() < deadline && !(input = await this.findInputSelector())) await sleep(1500);
    if (!input) throw new Error(`未找到通义千问输入框。请在内置浏览器登录 ${QWEN_URL}`);

    await this.page.click(input).catch(() => {});
    await this.page.keyboard.press('ControlOrMeta+A').catch(() => {});
    await this.page.keyboard.press('Backspace').catch(() => {});
    await this.page.keyboard.insertText(question).catch(async () => this.page!.fill(input!, question));
    await sleep(500);
    let submitted = false;
    for (const selector of ['button[aria-label*="发送"]', 'button[aria-label*="Send"]', 'button[data-testid*="send"]', 'button[type="submit"]', 'button:has-text("发送")', '[class*="send-button"]', '[class*="send-btn"]']) {
      if (await this.page.isVisible(selector).catch(() => false)) {
        try { await this.page.click(selector); submitted = true; break; } catch {}
      }
    }
    if (!submitted) await this.page.keyboard.press('Enter').catch(() => {});
    await this.waitForResponse();
    const result = await this.collectResult();
    if (!result.answer) throw new Error('通义千问已结束生成，但页面中未找到回答正文。');
    await connectorOutput.storeQwenResult({ question, title: question, answer: result.answer, reasoning_content: result.reasoning,
      citations: result.citations, url: result.url, source_keyword: question, time: Date.now() });
  }

  private async latestResponse(): Promise<string> {
    if (!this.page) return '';
    return this.page.evaluate(() => {
      const selectors = ['.markdown-body', '.markdown', '[class*="markdown"]', '[class*="message-content"]', '[class*="chat-message"]', '[class*="answer"]', 'div[role="article"]'];
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        const text = (nodes[nodes.length - 1] as HTMLElement | undefined)?.innerText?.trim();
        if (text) return text;
      }
      return '';
    }).catch(() => '');
  }

  private async waitForResponse(): Promise<void> {
    if (!this.page) return;
    const deadline = Date.now() + 120000;
    let previous = '', stableCount = 0;
    while (Date.now() < deadline) {
      await sleep(1500);
      const generating = await this.page.isVisible('button:has-text("停止"), button:has-text("Stop"), [class*="stop-button"], [class*="stop"]')
        .catch(() => false);
      const text = await this.latestResponse();
      if (!generating && text && text === previous && ++stableCount >= 2) return;
      stableCount = text === previous ? stableCount : 0;
      previous = text;
    }
    if (!previous) throw new Error('等待 120 秒后仍未检测到通义千问回答正文。');
  }

  private async collectResult(): Promise<{ answer: string; reasoning: string; citations: Array<{ title: string; url: string }>; url: string }> {
    if (!this.page) return { answer: '', reasoning: '', citations: [], url: QWEN_URL };
    return this.page.evaluate(() => {
      const selector = '.markdown-body, .markdown, [class*="markdown"], [class*="message-content"], [class*="chat-message"], [class*="answer"], div[role="article"]';
      const target = Array.from(document.querySelectorAll(selector))
        .filter((node) => !node.closest('[class*="suggest"], [contenteditable="true"]'))
        .map((node) => ({ node, text: (node as HTMLElement).innerText?.trim() || '' }))
        .filter((item) => item.text.length >= 10).pop()?.node;
      const reasoning = Array.from(document.querySelectorAll('[class*="thought"], [class*="reasoning"], details'))
        .map((node) => (node as HTMLElement).innerText?.trim() || '').filter(Boolean).join('\n\n');
      const citations = Array.from((target || document).querySelectorAll('a[href]')).map((node) => ({
        title: (node as HTMLElement).innerText.trim() || (node as HTMLAnchorElement).href,
        url: (node as HTMLAnchorElement).href,
      })).filter((link) => /^https?:/.test(link.url) && !link.url.includes('qianwen.com'));
      return { answer: (target as HTMLElement | undefined)?.innerText?.trim() || '', reasoning, citations, url: window.location.href };
    });
  }
}
