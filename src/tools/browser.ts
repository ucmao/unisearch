import os from 'os';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';
import { Playwright, Browser, BrowserContext, Page } from 'playwright';
import { activeConfig } from './config';

export class BrowserLauncher {
  public browserProcess: ChildProcess | null = null;
  public debugPort: number | null = null;

  public detectBrowserPaths(): string[] {
    const paths: string[] = [];
    const system = os.platform();

    if (system === 'win32') {
      const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData\\Local');

      const possiblePaths = [
        path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          paths.push(p);
        }
      }
    } else if (system === 'darwin') { // macOS
      const possiblePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
        '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          paths.push(p);
        }
      }
    } else { // Linux
      const possiblePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome-beta',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          paths.push(p);
        }
      }
    }

    return paths;
  }

  public async findAvailablePort(startPort = 9222): Promise<number> {
    const isPortAvailable = (port: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => {
          resolve(false);
        });
        server.once('listening', () => {
          server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
      });
    };

    let port = startPort;
    while (port < startPort + 100) {
      if (await isPortAvailable(port)) {
        return port;
      }
      port++;
    }
    throw new Error(`Cannot find available port in range ${startPort} to ${port - 1}`);
  }

  public launchBrowser(
    browserPath: string,
    debugPort: number,
    headless: boolean,
    userDataDir: string | null
  ): ChildProcess {
    const args = [
      `--remote-debugging-port=${debugPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--exclude-switches=enable-automation',
      '--disable-infobars',
    ];

    if (headless) {
      args.push('--headless=new');
    }

    if (userDataDir) {
      args.push(`--user-data-dir=${userDataDir}`);
    }

    console.log(`[BrowserLauncher] Launching browser: ${browserPath} ${args.join(' ')}`);
    
    this.browserProcess = spawn(browserPath, args, {
      detached: false,
      stdio: 'ignore',
    });

    this.debugPort = debugPort;
    return this.browserProcess;
  }

  public async waitForBrowserReady(port: number, timeoutSecs = 60): Promise<boolean> {
    const startTime = Date.now();
    const url = `http://127.0.0.1:${port}/json/version`;

    while (Date.now() - startTime < timeoutSecs * 1000) {
      try {
        const res = await axios.get(url, { timeout: 1000 });
        if (res.status === 200) {
          console.log(`[BrowserLauncher] Browser is ready on port ${port}`);
          return true;
        }
      } catch {
        // Ignored, wait and retry
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    return false;
  }

  public cleanup(): void {
    if (this.browserProcess) {
      console.log('[BrowserLauncher] Terminating browser process...');
      try {
        if (os.platform() === 'win32') {
          spawn('taskkill', ['/pid', String(this.browserProcess.pid), '/f', '/t']);
        } else {
          this.browserProcess.kill('SIGKILL');
        }
      } catch (err) {
        console.error('[BrowserLauncher] Failed to kill browser process:', err);
      }
      this.browserProcess = null;
    }
  }
}

export class CDPBrowserManager {
  public launcher = new BrowserLauncher();
  public browser: Browser | null = null;
  public browserContext: BrowserContext | null = null;
  public debugPort: number | null = null;
  private ownedPages: Page[] = [];

  private static PLATFORM_PORT_OFFSETS: Record<string, number> = {
    xhs: 0,
    dy: 1,
    ks: 2,
    bili: 3,
    wb: 4,
    tieba: 5,
    zhihu: 6,
  };

  private getPlatformPortRangeStart(): number {
    const offset = CDPBrowserManager.PLATFORM_PORT_OFFSETS[activeConfig.PLATFORM] || 0;
    return activeConfig.CDP_DEBUG_PORT + offset * 100;
  }

  public async launchAndConnect(
    playwright: Playwright,
    playwrightProxy: any = null,
    userAgent: string | null = null
  ): Promise<BrowserContext> {
    try {
      if (activeConfig.CDP_CONNECT_EXISTING) {
        return await this.connectExistingBrowser(playwright, playwrightProxy, userAgent);
      }

      const browserPath = await this.getBrowserPath();
      const portRangeStart = this.getPlatformPortRangeStart();
      this.debugPort = await this.launcher.findAvailablePort(portRangeStart);

      let userDataDir: string | null = null;
      if (activeConfig.SAVE_LOGIN_STATE) {
        userDataDir = path.join(
          process.cwd(),
          'browser_data',
          `cdp_${activeConfig.USER_DATA_DIR.replace('%s', activeConfig.PLATFORM)}`
        );
        fs.mkdirSync(userDataDir, { recursive: true });
        console.log(`[CDPBrowserManager] User data directory: ${userDataDir}`);
      }

      this.launcher.launchBrowser(
        browserPath,
        this.debugPort,
        activeConfig.CDP_HEADLESS,
        userDataDir
      );

      const ready = await this.launcher.waitForBrowserReady(this.debugPort, activeConfig.BROWSER_LAUNCH_TIMEOUT);
      if (!ready) {
        throw new Error(`Browser failed to start within ${activeConfig.BROWSER_LAUNCH_TIMEOUT} seconds`);
      }

      await this.connectViaCDP(playwright);
      await this.createBrowserContext(playwrightProxy, userAgent);

      return this.browserContext!;
    } catch (err) {
      console.error('[CDPBrowserManager] CDP browser launch failed:', err);
      await this.cleanup();
      throw err;
    }
  }

  private async connectExistingBrowser(
    playwright: Playwright,
    playwrightProxy: any = null,
    userAgent: string | null = null
  ): Promise<BrowserContext> {
    this.debugPort = activeConfig.CDP_DEBUG_PORT;
    console.log(`[CDPBrowserManager] Connecting to existing browser on port ${this.debugPort}...`);

    const timeout = activeConfig.BROWSER_LAUNCH_TIMEOUT;
    let connected = false;
    for (let i = 0; i < timeout; i++) {
      if (await this.testCDPConnection(this.debugPort)) {
        connected = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!connected) {
      throw new Error(`Cannot connect to existing browser on port ${this.debugPort} after ${timeout}s`);
    }

    await this.connectViaCDP(playwright);
    await this.createBrowserContext(playwrightProxy, userAgent);

    return this.browserContext!;
  }

  private async getBrowserPath(): Promise<string> {
    if (activeConfig.CUSTOM_BROWSER_PATH && fs.existsSync(activeConfig.CUSTOM_BROWSER_PATH)) {
      return activeConfig.CUSTOM_BROWSER_PATH;
    }

    const browserPaths = this.launcher.detectBrowserPaths();
    if (browserPaths.length === 0) {
      throw new Error('No available Chrome/Edge browser found. Specify CUSTOM_BROWSER_PATH.');
    }

    return browserPaths[0];
  }

  private async testCDPConnection(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, '127.0.0.1');
    });
  }

  private async connectViaCDP(playwright: Playwright): Promise<void> {
    console.log(`[CDPBrowserManager] Connecting Playwright to CDP endpoint: http://127.0.0.1:${this.debugPort}`);
    this.browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`);
  }

  private async createBrowserContext(playwrightProxy: any = null, userAgent: string | null = null): Promise<void> {
    if (!this.browser) throw new Error('Browser is not connected');

    const contexts = this.browser.contexts();
    if (contexts.length > 0) {
      this.browserContext = contexts[0];
      console.log('[CDPBrowserManager] Attached to existing browser context');
    } else {
      const options: any = {};
      if (playwrightProxy) options.proxy = playwrightProxy;
      if (userAgent) options.userAgent = userAgent;
      this.browserContext = await this.browser.newContext(options);
      console.log('[CDPBrowserManager] Created new browser context');
    }
  }

  public async newPage(): Promise<Page> {
    if (!this.browserContext) {
      throw new Error('Browser context not initialized');
    }
    
    // In CDP mode, try to reuse existing page if any is open
    const pages = this.browserContext.pages();
    let page: Page;
    if (pages.length > 0) {
      page = pages[0];
      console.log('[CDPBrowserManager] Reusing existing page');
    } else {
      page = await this.browserContext.newPage();
      console.log('[CDPBrowserManager] Created new page');
    }

    this.ownedPages.push(page);
    return page;
  }

  public async cleanup(force = false): Promise<void> {
    try {
      this.ownedPages = [];
      if (this.browserContext) {
        await this.browserContext.close().catch(() => {});
        this.browserContext = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    } catch (err) {
      console.error('[CDPBrowserManager] Error during cleanup context/browser:', err);
    }

    if (force || activeConfig.AUTO_CLOSE_BROWSER) {
      this.launcher.cleanup();
    }
  }
}
