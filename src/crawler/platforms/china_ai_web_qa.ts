import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyLoginRequired,
  notifyLoginSuccess,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';

type PlatformId = 'yuanbao' | 'nami' | 'wenxin';

interface AiWebQaPlatform {
  id: PlatformId;
  name: string;
  url: string;
  cookieDomain: string;
  ownDomains: string[];
  inputSelectors: string[];
  answerSelectors: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const COMMON_INPUT_SELECTORS = [
  'textarea[placeholder*="输入"]',
  'textarea[placeholder*="提问"]',
  'textarea[placeholder*="问"]',
  'textarea',
  'div[contenteditable="true"]',
  'div[role="textbox"]',
  '[contenteditable="true"]',
];

const COMMON_ANSWER_SELECTORS = [
  '.markdown-body',
  '.markdown',
  '[class*="markdown"]',
  '[class*="message-content"]',
  '[class*="chat-message"]',
  '[class*="answer-content"]',
  '[class*="answer"]',
  '[data-message-id]',
  'div[role="article"]',
];

const PLATFORMS: Record<PlatformId, AiWebQaPlatform> = {
  yuanbao: {
    id: 'yuanbao',
    name: '腾讯元宝',
    url: 'https://yuanbao.tencent.com/',
    cookieDomain: '.tencent.com',
    ownDomains: ['yuanbao.tencent.com', 'tencent.com'],
    inputSelectors: [
      'textarea[placeholder*="问元宝"]',
      'textarea[placeholder*="输入问题"]',
      '[class*="input-editor"][contenteditable="true"]',
      ...COMMON_INPUT_SELECTORS,
    ],
    answerSelectors: [
      '[class*="agent-chat__conv--ai"] [class*="markdown"]',
      '[class*="hyc-content-text"]',
      ...COMMON_ANSWER_SELECTORS,
    ],
  },
  nami: {
    id: 'nami',
    name: '纳米AI',
    url: 'https://www.n.cn/',
    cookieDomain: '.n.cn',
    ownDomains: ['n.cn'],
    inputSelectors: [
      'textarea[placeholder*="纳米"]',
      'textarea[placeholder*="搜索"]',
      '[class*="editor"][contenteditable="true"]',
      ...COMMON_INPUT_SELECTORS,
    ],
    answerSelectors: [
      '[class*="answer-item"] [class*="markdown"]',
      '[class*="result-content"]',
      ...COMMON_ANSWER_SELECTORS,
    ],
  },
  wenxin: {
    id: 'wenxin',
    name: '文心一言',
    url: 'https://wenxin.baidu.com/',
    cookieDomain: '.baidu.com',
    ownDomains: ['wenxin.baidu.com', 'baidu.com'],
    inputSelectors: [
      'textarea[placeholder*="文心"]',
      'textarea[placeholder*="有问题"]',
      '[class*="chat-input"][contenteditable="true"]',
      ...COMMON_INPUT_SELECTORS,
    ],
    answerSelectors: [
      '[class*="chat-message"] [class*="markdown"]',
      '[class*="answer-content"]',
      ...COMMON_ANSWER_SELECTORS,
    ],
  },
};

class ConfigurableAiWebQaCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public constructor(private readonly platform: AiWebQaPlatform) {
    super();
  }

  public async start(): Promise<void> {
    const tag = this.platform.id.toUpperCase();
    console.log(`[${tag}] Starting ${this.platform.name} AI Web QA crawler...`);
    this.browserContext = await connectToElectronChromium(require('playwright'));
    this.page = await getElectronCrawlerPage(this.browserContext, this.platform.id);
    await this.page.goto(this.platform.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((error) => {
      console.warn(`[${tag}] Initial page load warning: ${error.message}`);
    });
    await this.handleLogin();
    await this.search();
    console.log(`[${tag}] ${this.platform.name} AI Web QA crawler finished.`);
  }

  private async findInputSelector(): Promise<string | null> {
    if (!this.page) return null;
    for (const selector of this.platform.inputSelectors) {
      if (await this.page.isVisible(selector).catch(() => false)) return selector;
    }
    return null;
  }

  private async isReady(): Promise<boolean> {
    if (!this.page || /login|passport|signin|sign-in/.test(this.page.url())) return false;
    if (await this.findInputSelector()) return true;
    const loginVisible = await this.page.isVisible(
      'button:has-text("登录"), a:has-text("登录"), button:has-text("Log in"), [class*="login-btn"], [class*="login-button"]',
    ).catch(() => false);
    return !loginVisible;
  }

  private async handleLogin(): Promise<void> {
    if (!this.page || !this.browserContext) return;
    if (activeConfig.COOKIES) {
      await this.applyCookieHeader(this.browserContext, activeConfig.COOKIES, this.platform.cookieDomain);
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    if (await this.isReady()) {
      notifyLoginSuccess(this.platform.id);
      return;
    }

    notifyLoginRequired(this.platform.id, `请在内置${this.platform.name}窗口完成登录；成功后任务会自动继续。`);
    await this.page.click(
      'button:has-text("登录"), a:has-text("登录"), button:has-text("Log in"), [class*="login-btn"], [class*="login-button"]',
    ).catch(() => {});
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (await this.isReady()) {
        notifyLoginSuccess(this.platform.id);
        return;
      }
      await sleep(1500);
    }
    throw new Error(`${this.platform.name}尚未登录。请完成登录后重新执行任务。`);
  }

  public async search(): Promise<void> {
    const questions = (activeConfig.KEYWORDS || '').split(',').map((value) => value.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 1;
    let successful = 0;
    for (const [index, question] of questions.slice(0, maxItems).entries()) {
      console.log(`[${this.platform.id.toUpperCase()}] [${index + 1}/${questions.length}] Processing prompt: "${question}"...`);
      try {
        await this.askQuestion(question);
        successful++;
      } catch (error: any) {
        console.error(`[${this.platform.id.toUpperCase()}] Failed to process prompt "${question}": ${error.message}`);
      }
    }
    if (questions.length && !successful) {
      throw new Error(`${this.platform.name}未返回可提取的回答。请检查登录状态或页面是否要求人工验证。`);
    }
  }

  private async askQuestion(question: string): Promise<void> {
    if (!this.page) return;
    const deadline = Date.now() + 60000;
    let input: string | null = null;
    while (Date.now() < deadline && !(input = await this.findInputSelector())) await sleep(1500);
    if (!input) throw new Error(`未找到${this.platform.name}输入框。`);

    await this.page.click(input).catch(() => {});
    await this.page.keyboard.press('ControlOrMeta+A').catch(() => {});
    await this.page.keyboard.press('Backspace').catch(() => {});
    await this.page.keyboard.insertText(question).catch(async () => this.page!.fill(input!, question));
    await sleep(500);

    let submitted = false;
    const sendSelectors = [
      'button[aria-label*="发送"]',
      'button[aria-label*="Send"]',
      'button[data-testid*="send"]',
      'button[type="submit"]',
      'button:has-text("发送")',
      '[class*="send-button"]',
      '[class*="send-btn"]',
    ];
    for (const selector of sendSelectors) {
      if (!await this.page.isVisible(selector).catch(() => false)) continue;
      try {
        await this.page.click(selector);
        submitted = true;
        break;
      } catch {}
    }
    if (!submitted) await this.page.keyboard.press('Enter').catch(() => {});

    await this.waitForResponse();
    const result = await this.collectResult();
    if (!result.answer) throw new Error(`${this.platform.name}已结束生成，但页面中未找到回答正文。`);
    await connectorOutput.storeAiWebQaResult(this.platform.id, {
      question,
      title: question,
      answer: result.answer,
      reasoning_content: result.reasoning,
      citations: result.citations,
      url: result.url,
      source_keyword: question,
      time: Date.now(),
    });
  }

  private async latestResponse(): Promise<string> {
    if (!this.page) return '';
    return this.page.evaluate((selectors) => {
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector))
          .filter((node) => !node.closest('[class*="suggest"], [contenteditable="true"]'));
        const text = (nodes[nodes.length - 1] as HTMLElement | undefined)?.innerText?.trim();
        if (text) return text;
      }
      return '';
    }, this.platform.answerSelectors).catch(() => '');
  }

  private async waitForResponse(): Promise<void> {
    if (!this.page) return;
    const deadline = Date.now() + 120000;
    let previous = '';
    let stableCount = 0;
    while (Date.now() < deadline) {
      await sleep(1500);
      const generating = await this.page.isVisible(
        'button:has-text("停止"), button:has-text("Stop"), [class*="stop-button"], [class*="generating"]',
      ).catch(() => false);
      const text = await this.latestResponse();
      if (!generating && text && text === previous && ++stableCount >= 2) return;
      stableCount = text === previous ? stableCount : 0;
      previous = text;
    }
    if (!previous) throw new Error(`等待 120 秒后仍未检测到${this.platform.name}回答正文。`);
  }

  private async collectResult(): Promise<{
    answer: string;
    reasoning: string;
    citations: Array<{ title: string; url: string }>;
    url: string;
  }> {
    if (!this.page) return { answer: '', reasoning: '', citations: [], url: this.platform.url };
    return this.page.evaluate(({ selectors, ownDomains }) => {
      let target: Element | undefined;
      for (const selector of selectors) {
        const candidates = Array.from(document.querySelectorAll(selector))
          .filter((node) => !node.closest('[class*="suggest"], [contenteditable="true"]'))
          .map((node) => ({ node, text: (node as HTMLElement).innerText?.trim() || '' }))
          .filter((item) => item.text.length >= 10);
        if (candidates.length) {
          target = candidates[candidates.length - 1].node;
          break;
        }
      }
      const reasoning = Array.from(document.querySelectorAll('[class*="thought"], [class*="reasoning"], details'))
        .map((node) => (node as HTMLElement).innerText?.trim() || '').filter(Boolean).join('\n\n');
      const citations = Array.from((target || document).querySelectorAll('a[href]')).map((node) => ({
        title: (node as HTMLElement).innerText.trim() || (node as HTMLAnchorElement).href,
        url: (node as HTMLAnchorElement).href,
      })).filter((link) => {
        if (!/^https?:/.test(link.url)) return false;
        try {
          return !ownDomains.some((domain) => new URL(link.url).hostname.endsWith(domain));
        } catch {
          return false;
        }
      });
      return {
        answer: (target as HTMLElement | undefined)?.innerText?.trim() || '',
        reasoning,
        citations,
        url: window.location.href,
      };
    }, { selectors: this.platform.answerSelectors, ownDomains: this.platform.ownDomains });
  }
}

export class YuanbaoCrawler extends ConfigurableAiWebQaCrawler {
  public constructor() { super(PLATFORMS.yuanbao); }
}

export class NamiCrawler extends ConfigurableAiWebQaCrawler {
  public constructor() { super(PLATFORMS.nami); }
}

export class WenxinCrawler extends ConfigurableAiWebQaCrawler {
  public constructor() { super(PLATFORMS.wenxin); }
}
