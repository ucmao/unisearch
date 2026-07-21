import { BrowserType, BrowserContext, Page, Playwright } from 'playwright';
import axios from 'axios';
import path from 'path';
import { BrowserLauncher } from '../../tools/browser';
import { activeConfig } from '../../tools/config';

export async function connectToElectronChromium(playwright: Playwright): Promise<BrowserContext> {
  const cdpUrl = 'http://127.0.0.1:9222';
  console.log(`[BaseCrawler] Attempting to connect directly to Electron built-in Chromium via CDP (${cdpUrl})...`);
  try {
    const versionRes = await axios.get(`${cdpUrl}/json/version`, { timeout: 2000 }).catch(() => null);
    if (versionRes && versionRes.data && versionRes.data.webSocketDebuggerUrl) {
      const wsUrl = versionRes.data.webSocketDebuggerUrl;
      console.log(`[BaseCrawler] Found WebSocket CDP URL: ${wsUrl}`);
      const browser = await playwright.chromium.connectOverCDP(wsUrl);
      const contexts = browser.contexts();
      const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
      console.log('[BaseCrawler] Successfully connected to Electron built-in Chromium engine via WebSocket!');
      return context;
    }

    const browser = await playwright.chromium.connectOverCDP(cdpUrl);
    const contexts = browser.contexts();
    const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
    console.log('[BaseCrawler] Successfully connected to Electron built-in Chromium engine!');
    return context;
  } catch (err: any) {
    console.warn(`[BaseCrawler] Direct Electron CDP unavailable (${err.message}). Falling back to launching persistent browser context.`);
    const userDataDir = path.join(
      process.cwd(),
      'browser_data',
      activeConfig.USER_DATA_DIR ? activeConfig.USER_DATA_DIR.replace('%s', activeConfig.PLATFORM || 'default') : 'default'
    );
    const launchOptions = createHeadlessLaunchOptions();
    return await playwright.chromium.launchPersistentContext(userDataDir, launchOptions);
  }
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
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
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
        '--disable-blink-features=AutomationControlled',
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
    playwright: Playwright,
    playwrightProxy: any,
    userAgent: string,
    headless = true
  ): Promise<BrowserContext> {
    // Default fallback: use standard launch if CDP not overrode
    return await this.launchBrowser(playwright.chromium, playwrightProxy, userAgent, headless);
  }

  protected async applyCookieHeader(
    browserContext: BrowserContext,
    cookieHeader: string,
    domain: string,
  ): Promise<void> {
    if (!cookieHeader.trim()) return;
    const cookies = cookieHeader.split(';').map((part) => part.trim()).filter(Boolean).flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator <= 0) return [];
      return [{ name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim(), domain, path: '/' }];
    });
    if (cookies.length) await browserContext.addCookies(cookies);
  }
}

export function notifyLoginQrCodeRequired(platform: string, qrCodeBase64: string): void {
  console.log(`[Crawler] Emitting login QR Code required event for ${platform}`);
  if (process.send) {
    process.send({
      type: 'LOGIN_QRCODE_REQUIRED',
      platform,
      qrCode: qrCodeBase64,
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

export abstract class AbstractLogin {
  public abstract begin(): Promise<void>;
  public abstract loginByQrcode(): Promise<void>;
  public abstract loginByMobile(): Promise<void>;
  public abstract loginByCookies(): Promise<void>;
}

export abstract class AbstractStore {
  public abstract storeContent(contentItem: Record<string, any>): Promise<void>;
  public abstract storeComment(commentItem: Record<string, any>): Promise<void>;
  public abstract storeCreator(creatorItem: Record<string, any>): Promise<void>;
}

export abstract class AbstractApiClient {
  public abstract request(method: string, url: string, options?: any): Promise<any>;
  public abstract updateCookies(browserContext: BrowserContext): Promise<void>;
}

