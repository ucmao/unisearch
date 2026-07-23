import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage, notifyLoginRequired, notifyLoginSuccess } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { dbStore } from '../store';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DOUBAO_URL = 'https://www.doubao.com/chat/';

/** 网页版豆包问答采集器。选择器保留多种候选，以兼容页面的小幅改版。 */
export class DoubaoCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[DOUBAO] Starting Doubao AI Web QA crawler...');
    this.browserContext = await connectToElectronChromium(require('playwright'));
    this.page = await getElectronCrawlerPage(this.browserContext, 'doubao');
    await this.page.goto(DOUBAO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((error) => {
      console.warn(`[DOUBAO] Initial page load warning: ${error.message}`);
    });
    await this.handleLogin();
    await this.search();
    console.log('[DOUBAO] Doubao AI Web QA crawler finished.');
  }

  private async findInputSelector(): Promise<string | null> {
    if (!this.page) return null;
    const selectors = [
      'textarea[placeholder*="豆包"]', 'textarea[placeholder*="输入"]', 'textarea[placeholder*="发送"]',
      'textarea', 'div[contenteditable="true"]', 'div[role="textbox"]', '[contenteditable="true"]',
    ];
    for (const selector of selectors) {
      if (await this.page.isVisible(selector).catch(() => false)) return selector;
    }
    return null;
  }

  private async isLoggedIn(): Promise<boolean> {
    if (!this.page) return false;
    if (/login|passport/.test(this.page.url())) return false;
    // 豆包允许先渲染可用的会话输入框，再异步刷新顶栏账号态；此时顶栏旧的“登录”
    // 不能作为阻断条件，否则会白等两分钟。真正无法提交时由提交后的页面状态报错。
    if (await this.findInputSelector()) return true;
    const hasLoginButton = await this.page.isVisible('button:has-text("登录"), a:has-text("登录"), [class*="login-btn"], [class*="login-button"]')
      .catch(() => false);
    return !hasLoginButton;
  }

  private async handleLogin(): Promise<void> {
    if (!this.page || !this.browserContext) return;
    if (activeConfig.COOKIES) {
      console.log('[DOUBAO] Applying provided cookies...');
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, '.doubao.com');
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    if (await this.isLoggedIn()) {
      notifyLoginSuccess('doubao');
      return;
    }

    notifyLoginRequired('doubao', '请在内置豆包窗口右上角完成登录；登录成功后任务会自动继续。');
    console.log('[DOUBAO] Waiting up to 120s for manual login in crawler window...');
    await this.page.click('button:has-text("登录"), a:has-text("登录"), [class*="login-btn"], [class*="login-button"]')
      .catch(() => {});
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (await this.isLoggedIn()) {
        console.log('[DOUBAO] Login verified successfully!');
        notifyLoginSuccess('doubao');
        return;
      }
      await sleep(1500);
    }
    throw new Error('豆包尚未登录。请在内置浏览器右上角完成登录后重新执行任务。');
  }

  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((value) => value.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 1;
    let successful = 0;
    for (const [index, question] of keywords.slice(0, maxItems).entries()) {
      console.log(`[DOUBAO] [${index + 1}/${keywords.length}] Processing AI QA prompt: "${question}"...`);
      try {
        await this.askQuestion(question);
        successful++;
      } catch (error: any) {
        console.error(`[DOUBAO] Failed to process prompt "${question}": ${error.message}`);
      }
    }
    if (keywords.length > 0 && successful === 0) {
      throw new Error('豆包未返回可提取的回答，未写入占位数据。请检查登录状态或页面是否要求人工验证。');
    }
  }

  private async askQuestion(question: string): Promise<void> {
    if (!this.page) return;
    const deadline = Date.now() + 60000;
    let input: string | null = null;
    while (Date.now() < deadline && !(input = await this.findInputSelector())) await sleep(1500);
    if (!input) throw new Error(`Doubao chat input box not found. Please log in to ${DOUBAO_URL} in the crawler window.`);

    await this.page.click(input).catch(() => {});
    await this.page.keyboard.press('ControlOrMeta+A').catch(() => {});
    await this.page.keyboard.press('Backspace').catch(() => {});
    await this.page.keyboard.insertText(question).catch(async () => this.page!.fill(input!, question));
    await sleep(500);

    const sendSelectors = [
      // 豆包当前发送按钮没有文本和 aria-label，但带有稳定的设计令牌类名。
      'button[class*="g-send-msg-btn-bg"]',
      'button[aria-label*="发送"]', 'button[data-testid*="send"]', 'button[type="submit"]',
      'button:has-text("发送")', '[class*="send-button"]', '[class*="send-btn"]',
    ];
    let submitted = false;
    for (const selector of sendSelectors) {
      if (await this.page.isVisible(selector).catch(() => false)) {
        try {
          await this.page.click(selector);
          submitted = true;
          break;
        } catch {}
      }
    }
    if (!submitted) await this.page.keyboard.press('Enter').catch(() => {});
    await sleep(800);
    const stillPresent = await this.page.evaluate((prompt) => {
      const input = document.querySelector('textarea, div[contenteditable="true"], div[role="textbox"], [contenteditable="true"]') as HTMLElement | null;
      return (input?.innerText || (input as HTMLTextAreaElement | null)?.value || '').includes(prompt);
    }, question).catch(() => false);
    if (stillPresent) {
      throw new Error('豆包没有接受本次提问。请确认已登录，或检查页面是否出现验证码后重试。');
    }
    await this.waitForResponse();
    const result = await this.collectResult();
    if (!result.answer) throw new Error('豆包已结束生成，但页面中未找到可导出的回答正文。');
    await dbStore.storeDoubaoResult({ question, title: question, answer: result.answer, reasoning_content: result.reasoning,
      citations: result.citations, url: result.url, source_keyword: question, time: Date.now() });
  }

  private async getLatestResponseText(): Promise<string> {
    if (!this.page) return '';
    return this.page.evaluate(() => {
      // 2026-07 豆包网页端：机器人正文位于可复制消息块下的 data-message-id。
      // 推荐追问不在该节点内，使用它可避免把建议问题当成回答。
      const actualResponses = Array.from(document.querySelectorAll('[data-copy-telemetry="right_click_copy"] [data-message-id]'));
      const actualText = (actualResponses[actualResponses.length - 1] as HTMLElement | undefined)?.innerText?.trim();
      if (actualText) return actualText;
      const selectors = [
        '.markdown-body', '.markdown', '[class*="markdown"]', '[class*="message-content"]',
        '[class*="chat-message"]', '[class*="answer"]', '[class*="message"]', 'div[role="article"]',
      ];
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        const text = (nodes[nodes.length - 1] as HTMLElement | undefined)?.innerText?.trim();
        if (text) return text;
      }
      // 豆包经常调整 class 名；取最后一个不含输入控件的可见长文本叶节点作为兼容兜底。
      const candidates = Array.from(document.querySelectorAll('article, section, div, p, li')).filter((node) => {
        const element = node as HTMLElement;
        const text = element.innerText?.trim() || '';
        if (text.length < 40 || !element.checkVisibility?.()) return false;
        if (element.closest('header, nav, aside, footer, [contenteditable="true"], form, [class*="suggest"]')) return false;
        if (element.querySelector('textarea, input, [contenteditable="true"]')) return false;
        return !Array.from(element.children).some((child) => ((child as HTMLElement).innerText?.trim().length || 0) >= text.length * 0.92);
      });
      return (candidates[candidates.length - 1] as HTMLElement | undefined)?.innerText?.trim() || '';
    }).catch(() => '');
  }

  private async waitForResponse(): Promise<void> {
    if (!this.page) return;
    const deadline = Date.now() + 120000;
    let previous = '', stableCount = 0;
    while (Date.now() < deadline) {
      await sleep(1500);
      const generating = await this.page.isVisible('button:has-text("停止"), [class*="stop-button"], [class*="stop"]')
        .catch(() => false);
      const text = await this.getLatestResponseText();
      if (!generating && text && text === previous && ++stableCount >= 2) return;
      stableCount = text === previous ? stableCount : 0;
      previous = text;
    }
    if (!previous) throw new Error('等待 120 秒后仍未检测到豆包回答正文。');
  }

  private async collectResult(): Promise<{ answer: string; reasoning: string; citations: Array<{ title: string; url: string }>; url: string }> {
    if (!this.page) return { answer: '', reasoning: '', citations: [], url: DOUBAO_URL };
    return this.page.evaluate(() => {
      const actualResponses = Array.from(document.querySelectorAll('[data-copy-telemetry="right_click_copy"] [data-message-id]'));
      const actualTarget = actualResponses[actualResponses.length - 1] as HTMLElement | undefined;
      const selectors = '.markdown-body, .markdown, [class*="markdown"], [class*="message-content"], [class*="chat-message"], [class*="answer"], [class*="message"], div[role="article"]';
      const selected = Array.from(document.querySelectorAll(selectors))
        .filter((node) => !node.closest('[class*="suggest"]'))
        .map((node) => ({ node, text: (node as HTMLElement).innerText?.trim() || '' }))
        .filter((item) => item.text.length >= 20).pop();
      const fallback = Array.from(document.querySelectorAll('article, section, div, p, li')).filter((node) => {
        const element = node as HTMLElement;
        const text = element.innerText?.trim() || '';
        if (text.length < 40 || !element.checkVisibility?.()) return false;
        if (element.closest('header, nav, aside, footer, [contenteditable="true"], form, [class*="suggest"]')) return false;
        if (element.querySelector('textarea, input, [contenteditable="true"]')) return false;
        return !Array.from(element.children).some((child) => ((child as HTMLElement).innerText?.trim().length || 0) >= text.length * 0.92);
      });
      const target = actualTarget || selected?.node || fallback[fallback.length - 1];
      const answer = (target as HTMLElement | undefined)?.innerText?.trim() || '';
      const reasoning = Array.from(document.querySelectorAll('[class*="thought"], [class*="reasoning"], details'))
        .map((node) => (node as HTMLElement).innerText?.trim() || '').filter(Boolean).join('\n\n');
      const citations = Array.from((target || document).querySelectorAll('a[href]')).map((node) => ({
        title: (node as HTMLElement).innerText.trim() || (node as HTMLAnchorElement).href,
        url: (node as HTMLAnchorElement).href,
      })).filter((link) => /^https?:/.test(link.url) && !link.url.includes('doubao.com'));
      return { answer, reasoning, citations, url: window.location.href };
    });
  }
}
