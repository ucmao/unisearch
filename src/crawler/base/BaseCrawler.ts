import { BrowserType, BrowserContext, Page } from 'playwright';
import axios from 'axios';
import path from 'path';
import { BrowserLauncher, PlaywrightModule } from '../../tools/browser';
import { activeConfig } from '../../tools/config';
import { buildCrawlerUserAgent, CRAWLER_LOCALE, CRAWLER_TIMEZONE, CRAWLER_USER_AGENT } from '../../tools/browserIdentity';
import { connectorEventEmitter } from '../../core/contracts/connector-event-emitter';
import { getBrowserDataDir } from '../../tools/runtimePaths';

interface CrawlerPageConfiguration {
  maskWebdriver: boolean;
  preventWindowClose?: boolean;
}

function crawlerPageConfiguration(platform: string): CrawlerPageConfiguration {
  const maskWebdriver = true;
  const preventWindowClose = platform === 'boss' || platform === 'quark';
  return { maskWebdriver, preventWindowClose };
}

async function configureCrawlerPage(
  browserContext: BrowserContext,
  page: Page,
  configuration: CrawlerPageConfiguration,
): Promise<Page> {
  if (configuration.preventWindowClose && typeof (page as any).addInitScript === 'function') {
    await page.addInitScript(() => {
      try {
        // Some challenge shells call window.close() when they believe they were
        // opened as a disposable popup. This page is the persistent crawler
        // surface, so closing it would also remove the user's login UI.
        Object.defineProperty(window, 'close', {
          configurable: true,
          value: () => undefined,
        });
      } catch {}
    }).catch(() => {});
  }
  if (configuration.maskWebdriver && typeof (page as any).addInitScript === 'function') {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(Navigator.prototype, 'webdriver', {
          configurable: true,
          get: () => undefined,
        });
      } catch {}
      try {
        Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', {
          configurable: true,
          get: () => undefined,
        });
      } catch {}
    }).catch(() => {});
  }
  try {
    if (typeof (browserContext as any).newCDPSession !== 'function' || typeof (page as any).addInitScript !== 'function') {
      return page;
    }
    const session = await browserContext.newCDPSession(page);
    const browserVersion = await session.send('Browser.getVersion').catch(() => null);
    const chromeVersion = String(browserVersion?.product || '').match(/Chrome\/([\d.]+)/)?.[1];
    const userAgent = buildCrawlerUserAgent(chromeVersion || undefined);
    const majorVersion = (chromeVersion || process.versions.chrome || '148').split('.')[0];
    const platformName = process.platform === 'win32' ? 'Windows' : process.platform === 'linux' ? 'Linux' : 'macOS';
    await session.send('Network.setUserAgentOverride', {
      userAgent,
      acceptLanguage: 'zh-CN,zh;q=0.9',
      platform: platformName,
      userAgentMetadata: {
        brands: [
          { brand: 'Not_A Brand', version: '99' },
          { brand: 'Chromium', version: majorVersion },
          { brand: 'Google Chrome', version: majorVersion },
        ],
        fullVersionList: [
          { brand: 'Not_A Brand', version: '99.0.0.0' },
          { brand: 'Chromium', version: chromeVersion || `${majorVersion}.0.0.0` },
          { brand: 'Google Chrome', version: chromeVersion || `${majorVersion}.0.0.0` },
        ],
        fullVersion: chromeVersion || `${majorVersion}.0.0.0`,
        platform: platformName,
        platformVersion: process.platform === 'darwin' ? '10.15.7' : process.platform === 'win32' ? '10.0.0' : '6.0.0',
        architecture: process.arch === 'arm64' ? 'arm' : 'x86',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false,
      },
    });
    await session.send('Emulation.setTimezoneOverride', { timezoneId: CRAWLER_TIMEZONE });
    await session.send('Emulation.setLocaleOverride', { locale: CRAWLER_LOCALE });
    // 采集器只抓取结构化数据，拒绝所有由页面发起的非预期文件下载
    await session.send('Page.setDownloadBehavior', { behavior: 'deny' } as any).catch(() => {});
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'language', { configurable: true, get: () => 'zh-CN' });
      Object.defineProperty(Navigator.prototype, 'languages', { configurable: true, get: () => ['zh-CN', 'zh'] });
    });
    page.on('download', (download) => {
      download.cancel().catch(() => {});
    });
  } catch (error: any) {
    console.warn(`[BaseCrawler] Failed to align browser locale/timezone/downloadBehavior: ${error.message}`);
  }
  return page;
}

export async function connectToElectronChromium(playwright: PlaywrightModule): Promise<BrowserContext> {
  const cdpPort = Number(process.env.UNISEARCH_CDP_PORT || 9222);
  const cdpUrl = `http://127.0.0.1:${cdpPort}`;
  console.log(`[BaseCrawler] Connecting directly to Electron built-in Chromium via CDP (${cdpUrl})...`);

  // Retry to get the WebSocket debugger URL from Electron
  let wsUrl = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const versionRes = await axios.get(`${cdpUrl}/json/version`, { timeout: 2000 });
      if (versionRes.data && versionRes.data.webSocketDebuggerUrl) {
        wsUrl = versionRes.data.webSocketDebuggerUrl;
        break;
      }
    } catch {}

    try {
      const listRes = await axios.get(`${cdpUrl}/json`, { timeout: 2000 });
      if (Array.isArray(listRes.data) && listRes.data.length > 0) {
        const target = listRes.data.find((t: any) => t.webSocketDebuggerUrl);
        if (target && target.webSocketDebuggerUrl) {
          wsUrl = target.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {}

    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const urlsToTry = wsUrl ? [wsUrl] : [`ws://127.0.0.1:${cdpPort}/devtools/browser`, cdpUrl];
  for (const targetUrl of urlsToTry) {
    try {
      console.log(`[BaseCrawler] Connecting Playwright to Electron CDP target: ${targetUrl}`);
      const browser = await playwright.chromium.connectOverCDP(targetUrl);
      const contexts = browser.contexts();
      const marker = `#unisearch-crawler-${encodeURIComponent(activeConfig.PLATFORM)}`;
      const context = contexts.find((candidate) => candidate.pages().some((page) => page.url().includes(marker)))
        || contexts[0]
        || await browser.newContext();
      console.log('[BaseCrawler] Successfully connected to Electron built-in Chromium engine!');
      return context;
    } catch (err: any) {
      console.log(`[BaseCrawler] CDP target ${targetUrl} failed: ${err.message}`);
    }
  }

  if (process.env.UNISEARCH_PACKAGED === '1') {
    throw new Error(`UniSearch 内置 Chromium 未能在端口 ${cdpPort} 启动。请完全退出并重启应用；正式安装包不依赖外部 Chrome 或 Edge。`);
  }

  console.log(`[BaseCrawler] Electron CDP port ${cdpPort} unavailable. Fallback to development browser context.`);
  const userDataDir = path.join(
    getBrowserDataDir(),
    activeConfig.USER_DATA_DIR ? activeConfig.USER_DATA_DIR.replace('%s', activeConfig.PLATFORM || 'default') : 'default'
  );
  const launchOptions = createHeadlessLaunchOptions();
  return await playwright.chromium.launchPersistentContext(userDataDir, launchOptions);
}

const PLATFORM_URL_PATTERNS: Record<string, (string | RegExp)[]> = {
  xhs: [/xiaohongshu\.com/i, /rednote\.com/i, /xhslink\.com/i],
  douyin: [/douyin\.com/i],
  kuaishou: [/kuaishou\.com/i],
  bili: [/bilibili\.com/i, /b23\.tv/i],
  weibo: [/weibo\.com/i, /weibo\.cn/i],
  tieba: [/tieba\.baidu\.com/i],
  zhihu: [/zhihu\.com/i],
  boss: [/zhipin\.com/i],
  zhaopin: [/zhaopin\.com/i],
  job51: [/51job\.com/i],
  liepin: [/liepin\.com/i],
  heimao: [/tousu\.sina\.com\.cn/i],
  deepseek: [/deepseek\.com/i],
  kimi: [/moonshot\.cn/i],
  doubao: [/doubao\.com/i],
  qwen: [/aliyun\.com/i, /qianwen/i],
  yuanbao: [/yuanbao\.tencent\.com/i],
  toutiao: [/toutiao\.com/i],
  baidu: [/baidu\.com/i],
  bing: [/bing\.com/i],
  so360: [/so\.com/i],
  sogou: [/sogou\.com/i],
  quark: [/sm\.cn/i],
  chinaso: [/chinaso\.com/i],
  arxiv: [/arxiv\.org/i],
  github_repositories: [/github\.com/i],
  aihot: [/virxact\.com/i],
};

function isPlatformUrl(platform: string, url: string): boolean {
  const patterns = PLATFORM_URL_PATTERNS[platform];
  if (!patterns) return false;
  return patterns.some((p) => typeof p === 'string' ? url.includes(p) : p.test(url));
}

export async function getElectronCrawlerPage(browserContext: BrowserContext, platform: string, attempts = 20): Promise<Page> {
  const marker = `#unisearch-crawler-${encodeURIComponent(platform)}`;
  const pageConfiguration = crawlerPageConfiguration(platform);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const pages = browserContext.pages();
    const page = pages.find((candidate) => candidate.url().includes(marker))
      || pages.find((candidate) => isPlatformUrl(platform, candidate.url()));
    if (page) {
      return configureCrawlerPage(browserContext, page, pageConfiguration);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const fallbackPages = browserContext.pages();
  if (fallbackPages.length === 1 && fallbackPages[0].url() === 'about:blank') {
    // Standalone persistent-context fallback, not an Electron CDP target.
    return configureCrawlerPage(browserContext, fallbackPages[0], pageConfiguration);
  }
  const available = fallbackPages.map((page) => page.url()).join(', ');
  throw new Error(`未找到平台 ${platform} 的专用采集页面。当前 CDP 页面: ${available || '无'}`);
}

/**
 * Electron may replace a BrowserView's CDP target during a cross-origin
 * navigation. Playwright then marks the old Page as closed even though the
 * replacement target is already present in the same persistent context.
 */
export async function recoverElectronCrawlerPage(
  browserContext: BrowserContext,
  platform: string,
  matches: (page: Page) => boolean,
  attempts = 20,
  retryDelayMs = 100,
): Promise<Page | null> {
  const marker = `#unisearch-crawler-${encodeURIComponent(platform)}`;
  const pageConfiguration = crawlerPageConfiguration(platform);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const pages = browserContext.pages();
    const replacement = pages.find((candidate) => !candidate.isClosed() && (
      candidate.url().includes(marker) || matches(candidate)
    ));
    if (replacement) return configureCrawlerPage(browserContext, replacement, pageConfiguration);
    if (attempt + 1 < attempts && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return null;
}

export function getSystemExecutablePath(): string | undefined {

  try {
    const launcher = new BrowserLauncher();
    const paths = launcher.detectBrowserPaths();
    if (paths && paths.length > 0) {
      return paths[0];
    }
  } catch {}
  return undefined;
}

export function createHeadlessLaunchOptions(): any {
  const options: any = {
    headless: true, // 强制所有平台 100% 不可见/无感模式
    userAgent: CRAWLER_USER_AGENT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--headless=new',
    ],
  };
  const execPath = getSystemExecutablePath();
  if (execPath) {
    options.executablePath = execPath;
  }
  return options;
}

export abstract class AbstractCrawler {
  public abstract start(): Promise<void>;
  public abstract search(): Promise<void>;

  protected async executeHybrid<T>(
    httpTask: () => Promise<T[]>,
    browserTask: () => Promise<T[]>,
    fallbackCheck: (results: T[]) => boolean = (res) => res.length === 0
  ): Promise<T[]> {
    try {
      const httpResults = await httpTask();
      if (!fallbackCheck(httpResults)) {
        return httpResults;
      }
      console.warn(`[HybridEngine] HTTP 采集模式未能获取有效数据 (共 ${httpResults.length} 条)，自动切换至 Playwright 浏览器模式兜底...`);
    } catch (err: any) {
      console.warn(`[HybridEngine] HTTP 采集遭遇异常 (${err.message})，自动切换至 Playwright 浏览器模式兜底...`);
    }

    return await browserTask();
  }

  protected async humanDelay(page: Page, seconds = activeConfig.CRAWLER_MAX_SLEEP_SEC): Promise<void> {
    const jitter = 0.8 + Math.random() * 0.5;
    await page.waitForTimeout(Math.max(250, Math.round(seconds * 1000 * jitter)));
  }
  
  public async launchBrowser(
    chromium: BrowserType,
    playwrightProxy: any,
    userAgent: string,
    headless = true
  ): Promise<BrowserContext> {
    const options: any = {
      headless,
      userAgent,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    };
    const execPath = getSystemExecutablePath();
    if (execPath) {
      options.executablePath = execPath;
    }
    if (playwrightProxy) {
      options.proxy = playwrightProxy;
    }
    return await chromium.launchPersistentContext('', options);
  }


  public async launchBrowserWithCDP(
    playwright: PlaywrightModule,
    playwrightProxy: any,
    userAgent: string,
    headless = true
  ): Promise<BrowserContext> {
    // Default fallback: use standard launch if CDP not overrode
    return await this.launchBrowser(playwright.chromium, playwrightProxy, userAgent, headless);
  }

}

export function notifyLoginQrCodeRequired(platform: string, qrCodeBase64: string): void {
  console.log(`[Crawler] Emitting login QR Code required event for ${platform}`);
  connectorEventEmitter.send({ type: 'auth_required', reason: '需要扫描二维码登录' });
  if (process.send) {
    process.send({
      type: 'LOGIN_QRCODE_REQUIRED',
      platform,
      qrCode: qrCodeBase64,
    });
  }
}

export function notifyLoginRequired(platform: string, reason: string): void {
  console.log(`[Crawler] Login may be required for ${platform}: ${reason}`);
  connectorEventEmitter.send({ type: 'auth_required', reason });
  if (process.send) {
    process.send({
      type: 'LOGIN_REQUIRED',
      platform,
      reason,
    });
  }
}

export function notifyLoginSuccess(platform: string): void {
  console.log(`[Crawler] Emitting login success event for ${platform}`);
  if (process.send) {
    process.send({
      type: 'LOGIN_SUCCESS',
      platform,
    });
  }
}

export function notifyManualVerificationRequired(platform: string, reason: string): void {
  console.log(`[Crawler] Manual verification required for ${platform}: ${reason}`);
  connectorEventEmitter.send({ type: 'verification_required', reason });
  if (process.send) {
    process.send({
      type: 'MANUAL_VERIFICATION_REQUIRED',
      platform,
      reason,
    });
  }
}

export function notifyManualVerificationSuccess(platform: string): void {
  if (process.send) process.send({ type: 'MANUAL_VERIFICATION_SUCCESS', platform });
}

export function notifyCrawlerPageRecoveryRequired(platform: string, reason: string): void {
  if (process.send) process.send({ type: 'CRAWLER_PAGE_RECOVERY_REQUIRED', platform, reason });
}
