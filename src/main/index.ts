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
let crawlerWindow: BrowserWindow | null = null;
let isQuitting = false;

let apiPort = 8080;

function getAppIconPath(): string | undefined {
  const iconFilename = process.platform === 'darwin' ? 'icon.png' : 'icon-windows.png';
  const iconPath = path.join(app.getAppPath(), 'build', iconFilename);
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

export function createCrawlerWindow(): BrowserWindow {
  if (crawlerWindow && !crawlerWindow.isDestroyed()) {
    return crawlerWindow;
  }

  crawlerWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // 默认隐藏后台无感运行
    title: 'UniSearch 内置采集浏览器',
    icon: getAppIconPath(),
    webPreferences: {
      backgroundThrottling: false, // 禁用后台降频，确保隐藏状态下不降速
    },
  });

  crawlerWindow.loadURL('about:blank');

  // 拦截右上角关闭按钮 X，改为隐藏窗口
  crawlerWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      crawlerWindow?.hide();
    }
  });

  crawlerWindow.on('closed', () => {
    crawlerWindow = null;
  });

  return crawlerWindow;
}

export function isCrawlerWindowVisible(): boolean {
  return crawlerWindow ? crawlerWindow.isVisible() : false;
}

export function showCrawlerWindow(): boolean {
  const win = createCrawlerWindow();
  win.show();
  win.focus();
  return true;
}

export function hideCrawlerWindow(): boolean {
  if (crawlerWindow && !crawlerWindow.isDestroyed() && crawlerWindow.isVisible()) {
    crawlerWindow.hide();
  }
  return false;
}

export function toggleCrawlerWindow(): boolean {
  if (isCrawlerWindowVisible()) {
    return hideCrawlerWindow();
  } else {
    return showCrawlerWindow();
  }
}

// IPC Handlers
ipcMain.handle('crawler-window-status', () => isCrawlerWindowVisible());
ipcMain.handle('crawler-window-show', () => showCrawlerWindow());
ipcMain.handle('crawler-window-hide', () => hideCrawlerWindow());
ipcMain.handle('crawler-window-toggle', () => toggleCrawlerWindow());

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

    // 初始化静默后台窗口
    createCrawlerWindow();

    apiPort = await getFreePort(8080);
    console.log(`[Electron] Starting Fastify API on free port: ${apiPort}`);
    
    // Start local Fastify server
    await startServer(apiPort);
    console.log('[Electron] Fastify server started successfully. Launching UI.');

    createWindow(apiPort);
  } catch (err) {
    console.error('[Electron] Startup failed:', err);
    app.quit();
  }
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

