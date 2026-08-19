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
import { MANUAL_LOGIN_TIMEOUT_MS } from '../base/interactiveTimeouts';

export type PlatformId = 'yuanbao' | 'nami' | 'wenxin';

export interface AiWebQaPlatform {
  id: PlatformId;
  name: string;
  url: string;
  ownDomains: string[];
  inputSelectors: string[];
  newChatSelectors?: string[];
  messageContainerSelectors: string[];
  answerSelectors: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const COMMON_INPUT_SELECTORS = [
  'textarea[placeholder*="输入"]',
  'textarea[placeholder*="提问"]',
  'textarea[placeholder*="问"]',
  'textarea',
  'div[contenteditable="true"]',
  'div[role="textbox"]',
  '[contenteditable="true"]',
];

export const COMMON_MESSAGE_CONTAINER_SELECTORS = [
  '[class*="agent-chat__conv--ai"]',
  '[class*="agent-chat__item--ai"]',
  '[class*="agent-dialogue__item--ai"]',
  '[class*="chat-item--ai"]',
  '[class*="message-item--ai"]',
  '[class*="answer-item"]',
  '[class*="chat-message--ai"]',
  '[data-role="assistant"]',
  '[data-message-role="assistant"]',
];

export const COMMON_ANSWER_SELECTORS = [
  '[class*="agent-chat__conv-content"]',
  '[class*="agent-chat__conv-text"]',
  '[class*="hyc-component-text"]',
  '[class*="hyc-content-text"]',
  '[class*="yt-markdown"]',
  '[class*="answer-content"]',
  '[class*="result-content"]',
  '.markdown-body',
  '.markdown',
  '[class*="markdown"]',
  '[class*="message-content"]',
  '[class*="chat-message"]',
  '[class*="answer"]',
  '[data-message-id]',
  'div[role="article"]',
];

export const NON_ANSWER_EXCLUDE_SELECTORS = [
  '[class*="inspiration"]',
  '[class*="prompt-card"]',
  '[class*="prompt-box"]',
  '[class*="prompt-item"]',
  '[class*="prompt-list"]',
  '[class*="sample-card"]',
  '[class*="sample"]',
  '[class*="example"]',
  '[class*="recommend"]',
  '[class*="suggest"]',
  '[class*="followup"]',
  '[class*="related-question"]',
  '[class*="guide-item"]',
  '[class*="plugin"]',
  '[class*="gallery"]',
  '[class*="sidebar"]',
  '[class*="history"]',
  '[class*="toolbar"]',
  '[class*="action"]',
  '[class*="feedback"]',
  '[class*="reference"]',
  '[class*="citation"]',
  '[class*="source-list"]',
  '[class*="refer-"]',
  '[class*="ref_"]',
  '[class*="refs"]',
  '[class*="search-result"]',
  '[class*="baike-card"]',
  '[class*="cosmic-dqa"]',
  '[class*="guess"]',
  '[class*="candidate"]',
  '[class*="relate"]',
  '[class*="query"]',
  '[class*="operation"]',
  '[class*="video-card"]',
  '[class*="media-card"]',
  '[class*="video-list"]',
  '[class*="video-item"]',
  '[class*="media-box"]',
  '[class*="short-video"]',
  '[class*="play-card"]',
  '[class*="agent-chat__conv--user"]',
  '[class*="agent-chat__item--user"]',
  '[class*="agent-dialogue__item--user"]',
  '[class*="chat-item--user"]',
  '[class*="user-message"]',
  '[data-role="user"]',
  'aside',
  'nav',
  'header',
  'footer',
  '[contenteditable="true"]',
  'form',
  'textarea',
  'input',
];

/**
 * Normalizes AI QA answer text by stripping out leading search reference headers/lists,
 * trailing follow-up prompt chips / action buttons, and cleaning up formatting anomalies.
 */
export function cleanAiAnswerText(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();

  // 1. Remove leading reference headers and 1..N reference item listings
  // E.g., "共参考30篇资料\n 1. 【2026优化版】...\n 2. ..."
  cleaned = cleaned.replace(
    /^(?:共参考\s*\d+\s*篇(?:资料|文档|网页|文章|来源)?|参考资料|参考来源|引用来源|资料来源)[\s\S]*?(?=\n\s*(?:[#一二三四五六七八九十]+[、\.\s]|\*\*|[A-Z\u4e00-\u9fa5]{2,}[：:]|结合|根据|对于|针对|为了|作为|在|您好|很高兴|我是|人工智能|课程|以下))/u,
    '',
  ).trim();

  // 2. Remove trailing suggestion prompts, follow-up questions, and quick action buttons
  // E.g., "🆗 行，继续吧...", "👌 好的，继续吧...", "\n 猜你想问..."
  cleaned = cleaned.replace(
    /(?:\s*[🆗👌👍💡👉]|\n\s*(?:猜你想问|相关推荐|推荐问题|相关问题|继续提问|延伸阅读|快捷回复)[：:]?)[\s\S]*$/u,
    '',
  ).trim();

  // 3. Remove orphaned timestamp lines left behind from raw media card text (e.g., "\n01:12\n")
  cleaned = cleaned.replace(/\n\s*\d{2}:\d{2}\s*(?=\n|$)/g, '');

  // 4. Normalize single-line item numbers like "1.\n【标题】" to "1. 【标题】"
  cleaned = cleaned.replace(/^(\d+)\.\s*\n+(\S)/gm, '$1. $2');

  return cleaned.trim();
}

export function isLikelyPromptTemplateOrPlaceholder(text: string, question?: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length < 15) return true;
  if (question && trimmed.replace(/\s+/g, '') === question.replace(/\s+/g, '')) return true;
  // Detect Midjourney / SD style prompt cards mistakenly grabbed as answers
  const isImagePrompt = /--(?:ar|v|style|stylize|iw|cw)\s+\d+/i.test(trimmed)
    || (trimmed.length < 200 && /(?:cyberpunk|neon lights|8k|masterpiece|highly detailed|photorealistic|cinematic lighting)/i.test(trimmed) && !trimmed.includes('：') && !trimmed.includes(':'));
  return isImagePrompt;
}

export const PLATFORMS: Record<PlatformId, AiWebQaPlatform> = {
  yuanbao: {
    id: 'yuanbao',
    name: '腾讯元宝',
    url: 'https://yuanbao.tencent.com/',
    ownDomains: ['yuanbao.tencent.com', 'tencent.com'],
    inputSelectors: [
      'textarea[placeholder*="问元宝"]',
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="有问"]',
      '[class*="input-editor"][contenteditable="true"]',
      '[class*="chat-input"]',
      '[class*="agent-chat__input"] [contenteditable="true"]',
      ...COMMON_INPUT_SELECTORS,
    ],
    newChatSelectors: [
      '[data-desc="new-chat"]',
      '.yb-common-nav__trigger[data-desc="new-chat"]',
      '[class*="icon-yb-ic_newchat"]',
      '.icon-yb-ic_newchat_20',
      'button:has-text("新建对话")',
      'button:has-text("新对话")',
      'a:has-text("新建对话")',
      'a:has-text("新对话")',
      '[class*="new-chat"]',
      '[class*="add-chat"]',
      '[class*="create-chat"]',
      '[aria-label*="新建对话"]',
      '[aria-label*="新对话"]',
      '[data-testid*="new-chat"]',
    ],
    messageContainerSelectors: [
      '[class*="agent-chat__conv--ai"]',
      '[class*="agent-chat__item--ai"]',
      '[class*="agent-dialogue__item--ai"]',
      '[class*="chat-item--ai"]',
      '[class*="message-item--ai"]',
      '[data-role="assistant"]',
    ],
    answerSelectors: [
      '[class*="agent-chat__conv-content"]',
      '[class*="agent-chat__conv-text"]',
      '[class*="hyc-component-text"]',
      '[class*="hyc-content-text"]',
      '[class*="yt-markdown"]',
      '[class*="markdown-body"]',
      '[class*="markdown"]',
      '.markdown-body',
      '.markdown',
      ...COMMON_ANSWER_SELECTORS,
    ],
  },
  nami: {
    id: 'nami',
    name: '纳米AI',
    url: 'https://www.n.cn/',
    ownDomains: ['n.cn'],
    inputSelectors: [
      'textarea[placeholder*="纳米"]',
      'textarea[placeholder*="搜索"]',
      '[class*="editor"][contenteditable="true"]',
      ...COMMON_INPUT_SELECTORS,
    ],
    newChatSelectors: [
      '[data-desc="new-chat"]',
      'button:has-text("新对话")',
      'button:has-text("新建对话")',
      '[class*="new-chat"]',
      '[aria-label*="新对话"]',
    ],
    messageContainerSelectors: [
      '[class*="answer-item"]',
      '[class*="chat-item--ai"]',
      '[class*="result-content"]',
      '[data-role="assistant"]',
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
    ownDomains: ['wenxin.baidu.com', 'chat.baidu.com'],
    inputSelectors: [
      'textarea[placeholder*="文心"]',
      'textarea[placeholder*="有问题"]',
      '[class*="chat-input"][contenteditable="true"]',
      ...COMMON_INPUT_SELECTORS,
    ],
    newChatSelectors: [
      '[data-desc="new-chat"]',
      'button:has-text("新建对话")',
      'button:has-text("新对话")',
      '[class*="new-chat"]',
      '[aria-label*="新建对话"]',
    ],
    messageContainerSelectors: [
      '[class*="chat-message--ai"]',
      '[class*="chat-item--ai"]',
      '[class*="chat-message"]',
      '[data-role="assistant"]',
    ],
    answerSelectors: [
      '[class*="chat-message"] [class*="markdown"]',
      '[class*="answer-content"]',
      ...COMMON_ANSWER_SELECTORS,
    ],
  },
};

export class ConfigurableAiWebQaCrawler extends AbstractCrawler {
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
    if (await this.isReady()) {
      notifyLoginSuccess(this.platform.id);
      return;
    }

    notifyLoginRequired(this.platform.id, `请在内置${this.platform.name}窗口完成登录；成功后任务会自动继续。`);
    await this.page.click(
      'button:has-text("登录"), a:has-text("登录"), button:has-text("Log in"), [class*="login-btn"], [class*="login-button"]',
    ).catch(() => {});
    const deadline = Date.now() + MANUAL_LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.isReady()) {
        notifyLoginSuccess(this.platform.id);
        return;
      }
      await sleep(1500);
    }
    throw new Error(`${this.platform.name}尚未登录。请完成登录后重新执行任务。`);
  }

  private async startNewConversation(): Promise<void> {
    if (!this.page) return;
    const tag = this.platform.id.toUpperCase();
    try {
      if (this.platform.newChatSelectors) {
        for (const selector of this.platform.newChatSelectors) {
          if (await this.page.isVisible(selector).catch(() => false)) {
            console.log(`[${tag}] Starting fresh conversation via selector: ${selector}`);
            await this.page.click(selector).catch(() => {});
            await sleep(2000);
            return;
          }
        }
      }
      console.log(`[${tag}] Resetting conversation by navigating to ${this.platform.url}`);
      await this.page.goto(this.platform.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await sleep(2000);
    } catch (err: any) {
      console.warn(`[${tag}] Failed to reset conversation: ${err.message}`);
    }
  }

  public async search(): Promise<void> {
    const questions = (activeConfig.KEYWORDS || '').split(',').map((value) => value.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 1;
    let successful = 0;
    for (const [index, question] of questions.slice(0, maxItems).entries()) {
      console.log(`[${this.platform.id.toUpperCase()}] [${index + 1}/${questions.length}] Processing prompt: "${question}"...`);
      try {
        if (index > 0) {
          await this.startNewConversation();
        }
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

    const initialText = await this.latestResponse(question);

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
      '[class*="send_btn"]',
      '[class*="sendBtn"]',
      '[class*="send-icon"]',
      '[class*="sendIcon"]',
      '[class*="agent-chat__input"] button',
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

    await sleep(800);
    const stillPresent = await this.page.evaluate((prompt) => {
      const el = document.querySelector('textarea, div[contenteditable="true"], div[role="textbox"]') as HTMLElement | null;
      return (el?.innerText || (el as HTMLTextAreaElement | null)?.value || '').includes(prompt);
    }, question).catch(() => false);

    if (stillPresent) {
      await this.page.keyboard.press('Enter').catch(() => {});
      await sleep(1000);
    }

    await this.waitForResponse(question, initialText);
    const result = await this.collectResult(question);
    const cleanedAnswer = cleanAiAnswerText(result.answer);
    if (!cleanedAnswer || isLikelyPromptTemplateOrPlaceholder(cleanedAnswer, question)) {
      throw new Error(`${this.platform.name}已结束生成，但页面中未找到有效回答正文。`);
    }
    await connectorOutput.emitAiWebQaResult(this.platform.id, {
      question,
      title: question,
      answer: cleanedAnswer,
      reasoning_content: result.reasoning,
      citations: result.citations,
      url: result.url,
      source_keyword: question,
      time: Date.now(),
    });
  }

  private async latestResponse(question?: string): Promise<string> {
    if (!this.page) return '';
    return this.page.evaluate(({ containerSelectors, answerSelectors, excludeSelectors, prompt }) => {
      const excludeSelectorStr = excludeSelectors.join(', ');
      const isExcluded = (node: Element) => {
        return Boolean(
          node.closest(excludeSelectorStr)
          || node.closest('[class*="user"], [data-role="user"], [class*="agent-chat__conv--user"], [class*="chat-item--user"], [class*="user-message"]')
        );
      };

      const cleanNodeText = (element: Element): string => {
        const clone = element.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('button, [role="button"], [class*="chip"], [class*="action"], [class*="tool"], [class*="prompt"], [class*="suggest"], [class*="recommend"], [class*="feedback"], [class*="related"], [class*="followup"], [class*="reference"], [class*="citation"], [class*="source-list"], [class*="refer-"], [class*="ref_"], [class*="refs"], [class*="search-result"], [class*="guess"], [class*="candidate"], [class*="operation"]').forEach((el) => el.remove());
        return clone.innerText?.trim() || '';
      };

      const normalizedPrompt = (prompt || '').replace(/\s+/g, '');

      // 1. Prioritize genuine AI message containers
      for (const cSelector of containerSelectors) {
        const containers = Array.from(document.querySelectorAll(cSelector)).filter((c) => !isExcluded(c));
        if (containers.length > 0) {
          const lastContainer = containers[containers.length - 1] as HTMLElement;
          const candidates: Array<{ text: string; len: number }> = [];

          for (const aSelector of answerSelectors) {
            const innerNodes = Array.from(lastContainer.querySelectorAll(aSelector)).filter((n) => !isExcluded(n));
            for (const node of innerNodes) {
              const text = cleanNodeText(node);
              if (text.length >= 10 && text.replace(/\s+/g, '') !== normalizedPrompt) {
                candidates.push({ text, len: text.length });
              }
            }
          }

          if (candidates.length > 0) {
            candidates.sort((a, b) => b.len - a.len);
            return candidates[0].text;
          }

          const containerText = cleanNodeText(lastContainer);
          if (containerText.length >= 10 && containerText.replace(/\s+/g, '') !== normalizedPrompt) {
            return containerText;
          }
        }
      }

      // 2. Global fallback only if strictly not inside user containers
      const globalCandidates: Array<{ text: string; len: number }> = [];
      for (const selector of answerSelectors) {
        const nodes = Array.from(document.querySelectorAll(selector)).filter((node) => !isExcluded(node));
        for (const node of nodes) {
          const text = cleanNodeText(node);
          if (text.length >= 30 && text.replace(/\s+/g, '') !== normalizedPrompt) {
            globalCandidates.push({ text, len: text.length });
          }
        }
      }
      if (globalCandidates.length > 0) {
        globalCandidates.sort((a, b) => b.len - a.len);
        return globalCandidates[0].text;
      }

      return '';
    }, {
      containerSelectors: this.platform.messageContainerSelectors,
      answerSelectors: this.platform.answerSelectors,
      excludeSelectors: NON_ANSWER_EXCLUDE_SELECTORS,
      prompt: question || '',
    }).catch(() => '');
  }

  private async waitForResponse(question: string, initialText = ''): Promise<void> {
    if (!this.page) return;
    const deadline = Date.now() + 120000;
    let previous = initialText;
    let stableCount = 0;
    let hasChangedFromInitial = false;
    const normalizedPrompt = question.replace(/\s+/g, '');

    while (Date.now() < deadline) {
      await sleep(1500);
      const generating = await this.page.isVisible(
        'button:has-text("停止"), button:has-text("Stop"), [class*="stop-button"], [class*="generating"], [class*="typing"], [class*="loading"]',
      ).catch(() => false);
      const text = await this.latestResponse(question);

      if (text && text !== initialText && text.replace(/\s+/g, '') !== normalizedPrompt) {
        hasChangedFromInitial = true;
      }

      if (!generating && hasChangedFromInitial && text && text === previous && ++stableCount >= 2) return;
      stableCount = text === previous ? stableCount : 0;
      previous = text;
    }
    if (!previous || previous === initialText || previous.replace(/\s+/g, '') === normalizedPrompt) {
      throw new Error(`等待 120 秒后仍未检测到${this.platform.name}回答正文。`);
    }
  }

  private async collectResult(question?: string): Promise<{
    answer: string;
    reasoning: string;
    citations: Array<{ title: string; url: string }>;
    url: string;
  }> {
    if (!this.page) return { answer: '', reasoning: '', citations: [], url: this.platform.url };
    return this.page.evaluate(({ containerSelectors, answerSelectors, excludeSelectors, ownDomains, prompt }) => {
      const excludeSelectorStr = excludeSelectors.join(', ');
      const isExcluded = (node: Element) => {
        return Boolean(
          node.closest(excludeSelectorStr)
          || node.closest('[class*="user"], [data-role="user"], [class*="agent-chat__conv--user"], [class*="chat-item--user"], [class*="user-message"]')
        );
      };

      const cleanNodeText = (element: Element): string => {
        const clone = element.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('button, [role="button"], [class*="chip"], [class*="action"], [class*="tool"], [class*="prompt"], [class*="suggest"], [class*="recommend"], [class*="feedback"], [class*="related"], [class*="followup"], [class*="reference"], [class*="citation"], [class*="source-list"], [class*="refer-"], [class*="ref_"], [class*="refs"], [class*="search-result"], [class*="guess"], [class*="candidate"], [class*="operation"]').forEach((el) => el.remove());
        return clone.innerText?.trim() || '';
      };

      const normalizedPrompt = (prompt || '').replace(/\s+/g, '');
      let target: Element | undefined;
      let selectedText = '';

      // 1. Prioritize genuine AI message containers
      for (const cSelector of containerSelectors) {
        const containers = Array.from(document.querySelectorAll(cSelector)).filter((c) => !isExcluded(c));
        if (containers.length > 0) {
          const lastContainer = containers[containers.length - 1] as HTMLElement;
          const candidates: Array<{ node: HTMLElement; text: string; len: number }> = [];

          for (const aSelector of answerSelectors) {
            const innerNodes = Array.from(lastContainer.querySelectorAll(aSelector)).filter((n) => !isExcluded(n)) as HTMLElement[];
            for (const node of innerNodes) {
              const text = cleanNodeText(node);
              if (text.length >= 10 && text.replace(/\s+/g, '') !== normalizedPrompt) {
                candidates.push({ node, text, len: text.length });
              }
            }
          }

          if (candidates.length > 0) {
            candidates.sort((a, b) => b.len - a.len);
            target = candidates[0].node;
            selectedText = candidates[0].text;
            break;
          }

          const containerText = cleanNodeText(lastContainer);
          if (containerText.length >= 10 && containerText.replace(/\s+/g, '') !== normalizedPrompt) {
            target = lastContainer;
            selectedText = containerText;
            break;
          }
        }
      }

      // 2. Global fallback if container was not matched
      if (!selectedText) {
        const globalCandidates: Array<{ node: HTMLElement; text: string; len: number }> = [];
        for (const selector of answerSelectors) {
          const nodes = Array.from(document.querySelectorAll(selector)).filter((node) => !isExcluded(node)) as HTMLElement[];
          for (const node of nodes) {
            const text = cleanNodeText(node);
            if (text.length >= 30 && text.replace(/\s+/g, '') !== normalizedPrompt) {
              globalCandidates.push({ node, text, len: text.length });
            }
          }
        }
        if (globalCandidates.length > 0) {
          globalCandidates.sort((a, b) => b.len - a.len);
          target = globalCandidates[0].node;
          selectedText = globalCandidates[0].text;
        }
      }

      const reasoning = Array.from(document.querySelectorAll('[class*="thought"], [class*="reasoning"], details'))
        .filter((node) => !isExcluded(node))
        .map((node) => (node as HTMLElement).innerText?.trim() || '').filter(Boolean).join('\n\n');

      const citations = Array.from((target || document).querySelectorAll('a[href]')).map((node) => ({
        title: (node as HTMLElement).innerText.trim() || (node as HTMLAnchorElement).href,
        url: (node as HTMLAnchorElement).href,
      })).filter((link) => {
        if (!/^https?:/.test(link.url)) return false;
        if (link.url.includes('baidu.com/link?')) return true;
        try {
          return !ownDomains.some((domain) => new URL(link.url).hostname.endsWith(domain));
        } catch {
          return false;
        }
      });

      return {
        answer: selectedText,
        reasoning,
        citations,
        url: window.location.href,
      };
    }, {
      containerSelectors: this.platform.messageContainerSelectors,
      answerSelectors: this.platform.answerSelectors,
      excludeSelectors: NON_ANSWER_EXCLUDE_SELECTORS,
      ownDomains: this.platform.ownDomains,
      prompt: question || '',
    });
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
