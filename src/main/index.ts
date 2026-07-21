import { app, BrowserWindow, shell, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { startServer, stopServer } from '../server';

app.setName('UniSearch');
process.title = 'UniSearch';

// Enable CDP remote debugging on Electron's built-in Chromium
app.commandLine.appendSwitch('remote-debugging-port', '9222');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-allow-origins', '*');

let mainWindow: BrowserWindow | null = null;
const crawlerWindows = new Map<string, BrowserWindow>();
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

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export function createCrawlerWindow(platform: string): BrowserWindow {
  const existing = crawlerWindows.get(platform);
  if (existing && !existing.isDestroyed()) {
    return existing;
  }

  const crawlerWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // 默认隐藏后台无感运行
    title: `UniSearch 内置采集浏览器 · ${platform.toUpperCase()}`,
    icon: getAppIconPath(),
    webPreferences: {
      backgroundThrottling: false, // 禁用后台降频，确保隐藏状态下不降速
      partition: `persist:unisearch-crawler-${platform}`,
    },
  });
  crawlerWindows.set(platform, crawlerWindow);

  void crawlerWindow.loadURL(crawlerMarkerUrl(platform));

  // Closing a crawler window never owns task cancellation. Keep its WebContents
  // alive, hide it, and return keyboard focus to the application workspace.
  crawlerWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      crawlerWindow.hide();
      focusMainWindow();
    }
  });

  crawlerWindow.on('closed', () => {
    crawlerWindows.delete(platform);
  });

  return crawlerWindow;
}

export async function prepareCrawlerWindow(platform: string): Promise<boolean> {
  const win = createCrawlerWindow(platform);
  if (win.isDestroyed()) return false;
  await win.loadURL(crawlerMarkerUrl(platform));
  return true;
}

export function isCrawlerWindowVisible(platform?: string): boolean {
  if (platform) return crawlerWindows.get(platform)?.isVisible() ?? false;
  return Array.from(crawlerWindows.values()).some((win) => !win.isDestroyed() && win.isVisible());
}

export function showCrawlerWindow(platform: string): boolean {
  const win = createCrawlerWindow(platform);
  for (const [otherPlatform, otherWindow] of crawlerWindows) {
    if (otherPlatform !== platform && !otherWindow.isDestroyed()) otherWindow.hide();
  }
  win.show();
  win.focus();
  return true;
}

export function hideCrawlerWindow(platform: string): boolean {
  const win = crawlerWindows.get(platform);
  if (win && !win.isDestroyed()) {
    win.hide();
    focusMainWindow();
    return true;
  }
  return false;
}

export function toggleCrawlerWindow(platform: string): boolean {
  if (isCrawlerWindowVisible(platform)) {
    return hideCrawlerWindow(platform);
  } else {
    return showCrawlerWindow(platform);
  }
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
    await startServer(apiPort, { prepareCrawlerWindow, showCrawlerWindow, hideCrawlerWindow });
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
