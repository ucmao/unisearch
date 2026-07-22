import { app, BrowserView, BrowserWindow, shell, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { startServer, stopServer } from '../server';
import { CRAWLER_ACCEPT_LANGUAGE, CRAWLER_LOCALE, CRAWLER_USER_AGENT } from '../tools/browserIdentity';

app.setName('UniSearch');
process.title = 'UniSearch';

// Enable CDP remote debugging on Electron's built-in Chromium
const cdpDebugPort = Number(process.env.UNISEARCH_CDP_PORT || 9222);
app.commandLine.appendSwitch('remote-debugging-port', String(cdpDebugPort));
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-allow-origins', '*');
// Never expose Electron/UniSearch tokens from any current or future WebContents.
app.commandLine.appendSwitch('user-agent', CRAWLER_USER_AGENT);
app.commandLine.appendSwitch('lang', CRAWLER_LOCALE);
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// Avoid WebRTC bypassing a configured HTTP proxy and exposing a different local/public IP.
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

let mainWindow: BrowserWindow | null = null;
let crawlerHubWindow: BrowserWindow | null = null;
const crawlerViews = new Map<string, BrowserView>();
let activeCrawlerPlatform: string | null = null;
let isQuitting = false;

let apiPort = 8080;

function getAppIconPath(): string | undefined {
  const iconFilename = process.platform === 'darwin' ? 'icon.png' : 'icon-windows.png';
  const iconPath = path.join(app.getAppPath(), 'build', iconFilename);
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function crawlerMarkerUrl(platform: string): string {
  return `about:blank#unisearch-crawler-${encodeURIComponent(platform)}`;
}

const CRAWLER_TAB_HEIGHT = 48;
const CRAWLER_PLATFORM_NAMES: Record<string, string> = {
  dy: '抖音', xhs: '小红书', ks: '快手', bili: '哔哩哔哩',
  wb: '微博', tieba: '百度贴吧', zhihu: '知乎',
};

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function crawlerHubHtml(): string {
  const tabs = Array.from(crawlerViews.keys()).map((platform) => {
    const active = platform === activeCrawlerPlatform ? ' active' : '';
    const label = CRAWLER_PLATFORM_NAMES[platform] || platform.toUpperCase();
    return `<a class="tab${active}" href="unisearch-tab://${encodeURIComponent(platform)}"><span class="dot"></span>${label}</a>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#eef4f8;color:#142033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .bar{height:${CRAWLER_TAB_HEIGHT}px;display:flex;align-items:flex-end;gap:4px;padding:7px 10px 0;border-bottom:1px solid #cbd8e2;background:linear-gradient(#f8fbfd,#e8f0f5);-webkit-app-region:drag}
    .brand{align-self:center;padding:0 10px 4px 2px;font-size:12px;font-weight:650;color:#506273;white-space:nowrap}
    .tabs{display:flex;min-width:0;height:40px;gap:4px;overflow-x:auto;-webkit-app-region:no-drag}
    .tab{display:flex;align-items:center;gap:7px;min-width:118px;height:36px;padding:0 16px;border:1px solid transparent;border-radius:10px 10px 0 0;color:#627487;text-decoration:none;font-size:13px;font-weight:550;white-space:nowrap}
    .tab:hover{background:#f7fbfd;color:#203246}.tab.active{border-color:#cbd8e2;border-bottom-color:#fff;background:#fff;color:#142033}
    .dot{width:7px;height:7px;border-radius:50%;background:#59bdd6;box-shadow:0 0 0 3px rgba(89,189,214,.12)}
    .hint{margin-left:auto;align-self:center;padding:0 5px 4px 10px;color:#8393a3;font-size:11px;white-space:nowrap}
  </style></head><body><div class="bar"><div class="brand">UniSearch 采集浏览器</div><nav class="tabs">${tabs}</nav><div class="hint">各平台登录会话独立保存</div></div></body></html>`;
}

function refreshCrawlerHubTabs(): void {
  if (!crawlerHubWindow || crawlerHubWindow.isDestroyed()) return;
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(crawlerHubHtml())}`;
  void crawlerHubWindow.loadURL(dataUrl);
}

function layoutActiveCrawlerView(): void {
  if (!crawlerHubWindow || crawlerHubWindow.isDestroyed() || !activeCrawlerPlatform) return;
  const view = crawlerViews.get(activeCrawlerPlatform);
  if (!view || view.webContents.isDestroyed()) return;
  const [width, height] = crawlerHubWindow.getContentSize();
  view.setBounds({ x: 0, y: CRAWLER_TAB_HEIGHT, width, height: Math.max(1, height - CRAWLER_TAB_HEIGHT) });
  view.setAutoResize({ width: true, height: true });
}

function activateCrawlerView(platform: string): boolean {
  if (!crawlerHubWindow || crawlerHubWindow.isDestroyed()) return false;
  const view = crawlerViews.get(platform);
  if (!view || view.webContents.isDestroyed()) return false;
  activeCrawlerPlatform = platform;
  crawlerHubWindow.setBrowserView(view);
  crawlerHubWindow.setTitle(`UniSearch 内置采集浏览器 · ${CRAWLER_PLATFORM_NAMES[platform] || platform.toUpperCase()}`);
  layoutActiveCrawlerView();
  refreshCrawlerHubTabs();
  return true;
}

function createCrawlerHubWindow(): BrowserWindow {
  if (crawlerHubWindow && !crawlerHubWindow.isDestroyed()) return crawlerHubWindow;
  crawlerHubWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: 'UniSearch 内置采集浏览器',
    icon: getAppIconPath(),
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  crawlerHubWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('unisearch-tab://')) return;
    event.preventDefault();
    activateCrawlerView(decodeURIComponent(new URL(url).hostname));
  });
  crawlerHubWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  crawlerHubWindow.on('resize', layoutActiveCrawlerView);
  crawlerHubWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      crawlerHubWindow?.hide();
      focusMainWindow();
    }
  });
  crawlerHubWindow.on('closed', () => {
    crawlerHubWindow = null;
  });
  refreshCrawlerHubTabs();
  return crawlerHubWindow;
}

export function createCrawlerView(platform: string): BrowserView {
  const existing = crawlerViews.get(platform);
  if (existing && !existing.webContents.isDestroyed()) return existing;
  createCrawlerHubWindow();
  const view = new BrowserView({
    webPreferences: {
      backgroundThrottling: false,
      partition: `persist:unisearch-crawler-${platform}`,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  view.webContents.session.setUserAgent(CRAWLER_USER_AGENT, CRAWLER_ACCEPT_LANGUAGE);
  view.webContents.setUserAgent(CRAWLER_USER_AGENT);
  crawlerViews.set(platform, view);
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  refreshCrawlerHubTabs();
  return view;
}

export async function prepareCrawlerWindow(platform: string): Promise<boolean> {
  const view = createCrawlerView(platform);
  if (view.webContents.isDestroyed()) return false;
  await view.webContents.loadURL(crawlerMarkerUrl(platform));
  if (!activeCrawlerPlatform || !crawlerViews.has(activeCrawlerPlatform)) activateCrawlerView(platform);
  else refreshCrawlerHubTabs();
  return true;
}

export function isCrawlerWindowVisible(platform?: string): boolean {
  const visible = Boolean(crawlerHubWindow && !crawlerHubWindow.isDestroyed() && crawlerHubWindow.isVisible());
  if (!platform) return visible;
  return visible && activeCrawlerPlatform === platform && crawlerViews.has(platform);
}

function resolveCrawlerPlatform(platform?: string): string | null {
  if (platform) return crawlerViews.has(platform) ? platform : null;
  if (activeCrawlerPlatform && crawlerViews.has(activeCrawlerPlatform)) return activeCrawlerPlatform;
  return crawlerViews.keys().next().value ?? null;
}

export function showCrawlerWindow(platform?: string): boolean {
  const resolvedPlatform = resolveCrawlerPlatform(platform);
  if (!resolvedPlatform) return false;
  const hub = createCrawlerHubWindow();
  if (!activateCrawlerView(resolvedPlatform)) return false;
  if (hub.isMinimized()) hub.restore();
  hub.show();
  hub.focus();
  return true;
}

export function hideCrawlerWindow(platform?: string): boolean {
  if (!crawlerHubWindow || crawlerHubWindow.isDestroyed()) return false;
  if (platform && activeCrawlerPlatform !== platform) return true;
  crawlerHubWindow.hide();
  focusMainWindow();
  return true;
}

export function toggleCrawlerWindow(platform?: string): boolean {
  const resolvedPlatform = resolveCrawlerPlatform(platform);
  if (!resolvedPlatform) return false;
  if (isCrawlerWindowVisible() && (!platform || activeCrawlerPlatform === resolvedPlatform)) {
    hideCrawlerWindow(resolvedPlatform);
    return false;
  }
  return showCrawlerWindow(resolvedPlatform);
}

// IPC Handlers
ipcMain.handle('crawler-window-status', (_event, platform?: string) => isCrawlerWindowVisible(platform));
ipcMain.handle('crawler-window-show', (_event, platform: string) => showCrawlerWindow(platform));
ipcMain.handle('crawler-window-hide', (_event, platform: string) => hideCrawlerWindow(platform));
ipcMain.handle('crawler-window-toggle', (_event, platform: string) => toggleCrawlerWindow(platform));

// Helper to find a free port
function getFreePort(startPort = 8080): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(getFreePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(startPort, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      const port = address.port;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function createWindow(port: number): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: getAppIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'UniSearch Desktop',
  });

  // 拦截新窗口请求（如 target="_blank" 的原帖链接），使用系统默认外部浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 拦截主页面内跳转，非本地 API/UI 链接在系统默认外部浏览器中打开
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith(`http://127.0.0.1:${port}`) || url.startsWith(`http://localhost:${port}`);
    if (!isLocal && (url.startsWith('http://') || url.startsWith('https://'))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.webContents.session.on('will-download', (_event, item) => {
    if (!item.getFilename().startsWith('UniSearch_')) return;
    const downloadsDir = app.getPath('downloads');
    const parsed = path.parse(item.getFilename());
    let savePath = path.join(downloadsDir, item.getFilename());
    let suffix = 2;
    while (fs.existsSync(savePath)) {
      savePath = path.join(downloadsDir, `${parsed.name}_${suffix}${parsed.ext}`);
      suffix++;
    }
    item.setSavePath(savePath);
    item.once('done', (_downloadEvent, state) => {
      if (state === 'completed') shell.showItemInFolder(savePath);
    });
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('ready', async () => {
  try {
    const iconPath = getAppIconPath();
    if (process.platform === 'darwin' && iconPath) {
      app.dock.setIcon(iconPath);
    }

    apiPort = await getFreePort(8080);
    console.log(`[Electron] Starting Fastify API on free port: ${apiPort}`);
    
    // Start local Fastify server
    await startServer(apiPort, {
      prepareCrawlerWindow,
      isCrawlerWindowVisible,
      showCrawlerWindow,
      hideCrawlerWindow,
      toggleCrawlerWindow,
    });
    console.log('[Electron] Fastify server started successfully. Launching UI.');

    createWindow(apiPort);
  } catch (err) {
    console.error('[Electron] Startup failed:', err);
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(apiPort);
  else focusMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async () => {
  console.log('[Electron] Shutting down Fastify server...');
  await stopServer();
});
