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
type CrawlerTabStatus = 'running' | 'completed' | 'failed' | 'stopped';
const crawlerTabStates = new Map<string, CrawlerTabStatus>();
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
  douyin: '抖音', xhs: '小红书', kuaishou: '快手', bili: '哔哩哔哩',
  weibo: '微博', tieba: '百度贴吧', zhihu: '知乎',
  baidu: '百度', bing: '必应', so360: '360搜索', sogou: '搜狗',
  zhaopin: '智联招聘', heimao: '黑猫投诉',
  deepseek: 'DeepSeek', doubao: '豆包', kimi: 'Kimi', nami: '纳米AI',
  qwen: '通义千问', wenxin: '文心一言', yuanbao: '腾讯元宝',
};

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export interface CrawlerRunMetrics {
  itemCount?: number;
  durationSeconds?: number;
  error?: string | null;
}

const crawlerTabMetrics = new Map<string, CrawlerRunMetrics>();

function closeCrawlerTab(platform: string): void {
  const view = crawlerViews.get(platform);
  if (view) {
    crawlerViews.delete(platform);
    if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
  }
  crawlerTabStates.delete(platform);
  crawlerTabMetrics.delete(platform);

  if (activeCrawlerPlatform === platform) {
    const remaining = Array.from(crawlerTabStates.keys());
    const next = remaining.find((p) => crawlerViews.has(p)) || remaining[0];
    if (next) {
      activateCrawlerView(next);
    } else {
      activeCrawlerPlatform = null;
      if (crawlerHubWindow && !crawlerHubWindow.isDestroyed()) {
        crawlerHubWindow.setBrowserView(null);
        crawlerHubWindow.hide();
        focusMainWindow();
      }
    }
  } else {
    refreshCrawlerHubTabs();
  }
}

function crawlerHubHtml(): string {
  const activeState = activeCrawlerPlatform ? crawlerTabStates.get(activeCrawlerPlatform) : null;
  const isRunningActive = activeCrawlerPlatform ? crawlerViews.has(activeCrawlerPlatform) : false;

  const tabs = Array.from(crawlerTabStates.entries()).map(([platform, status]) => {
    const active = platform === activeCrawlerPlatform ? ' active' : '';
    const label = CRAWLER_PLATFORM_NAMES[platform] || platform.toUpperCase();
    const content = `<span class="dot ${status}"></span><span>${label}</span><span class="close-btn" onclick="event.preventDefault(); event.stopPropagation(); location.href='unisearch-action://close-tab/${encodeURIComponent(platform)}'">×</span>`;
    return `<a class="tab${active}" href="unisearch-tab://${encodeURIComponent(platform)}">${content}</a>`;
  }).join('');

  let bodyContent = '';
  if (activeCrawlerPlatform && !isRunningActive && activeState) {
    const label = CRAWLER_PLATFORM_NAMES[activeCrawlerPlatform] || activeCrawlerPlatform.toUpperCase();
    const metrics = crawlerTabMetrics.get(activeCrawlerPlatform);
    let statusTitle = '';
    let statusDesc = '';
    let iconSvg = '';
    const badgeClass = activeState;

    if (activeState === 'completed') {
      const count = metrics?.itemCount ?? 0;
      const duration = metrics?.durationSeconds !== undefined ? `，耗时 ${metrics.durationSeconds} 秒` : '';
      statusTitle = `${label} 采集成功`;
      statusDesc = `<strong class="highlight-text">共获取 ${count} 条数据${duration}。</strong><br>底层网页与自动化进程已安全注销释放内存，你可在 UniSearch 主界面中随时查看看板或继续 AI 分析。`;
      iconSvg = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#4bb98a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    } else if (activeState === 'failed') {
      const errReason = metrics?.error ? `错误提示：${metrics.error}` : '错误提示：页面响应超时或触发风控验证拦截';
      statusTitle = `${label} 采集中断`;
      statusDesc = `<strong class="highlight-error">${errReason}。</strong><br>关联网页与关联进程已自动关闭，你可以返回主界面日志中排查具体原因。`;
      iconSvg = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d66b7b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    } else {
      statusTitle = `${label} 任务已停止`;
      statusDesc = '收到用户中断指令，平台采集已被手动停止。<br>网页与关联进程资源已完整卸载归还系统。';
      iconSvg = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9aa7b4" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>`;
    }

    bodyContent = `
      <div class="summary-container">
        <div class="summary-card">
          <div class="icon-box ${badgeClass}">${iconSvg}</div>
          <div class="status-badge ${badgeClass}">${activeState === 'completed' ? '采集完成' : activeState === 'failed' ? '采集失败' : '已停止'}</div>
          <h2 class="title">${statusTitle}</h2>
          <p class="description">${statusDesc}</p>
          <div class="btn-group">
            <a class="btn primary" href="unisearch-action://focus-main">返回主界面看板</a>
            <a class="btn secondary" href="unisearch-action://close-tab/${encodeURIComponent(activeCrawlerPlatform)}">关闭此标签页</a>
          </div>
        </div>
      </div>
    `;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#f0f4f8;color:#142033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .bar{height:${CRAWLER_TAB_HEIGHT}px;display:flex;align-items:flex-end;gap:4px;padding:7px 10px 0;border-bottom:1px solid #cbd8e2;background:linear-gradient(#f8fbfd,#e8f0f5);-webkit-app-region:drag}
    .brand{align-self:center;padding:0 10px 4px 2px;font-size:12px;font-weight:650;color:#506273;white-space:nowrap}
    .tabs{display:flex;min-width:0;height:40px;gap:4px;overflow-x:auto;-webkit-app-region:no-drag}
    .tab{display:flex;align-items:center;gap:7px;min-width:96px;height:36px;padding:0 8px 0 12px;border:1px solid transparent;border-radius:10px 10px 0 0;color:#627487;text-decoration:none;font-size:13px;font-weight:550;white-space:nowrap;transition:all 0.15s ease}
    .tab:hover{background:#f7fbfd;color:#203246}.tab.active{border-color:#cbd8e2;border-bottom-color:#fff;background:#fff;color:#142033}
    .close-btn{margin-left:auto;padding:0 4px;font-size:13px;line-height:1;color:#9aa7b4;border-radius:4px;opacity:0.6;transition:all 0.15s ease}
    .close-btn:hover{color:#d66b7b;background:rgba(214,107,123,0.15);opacity:1}
    .dot{width:7px;height:7px;border-radius:50%;background:#59bdd6;box-shadow:0 0 0 3px rgba(89,189,214,.12);flex-shrink:0}
    .dot.completed{background:#4bb98a;box-shadow:0 0 0 3px rgba(75,185,138,.12)}.dot.failed{background:#d66b7b;box-shadow:0 0 0 3px rgba(214,107,123,.12)}.dot.stopped{background:#9aa7b4;box-shadow:0 0 0 3px rgba(154,167,180,.12)}
    
    .summary-container{display:flex;align-items:center;justify-content:center;height:calc(100vh - ${CRAWLER_TAB_HEIGHT}px);padding:20px;background:linear-gradient(135deg, #eef4f8 0%, #e2ecf3 100%)}
    .summary-card{margin:auto;max-width:440px;width:100%;background:#ffffff;border:1px solid #d0dee8;border-radius:16px;padding:32px 28px;text-align:center;box-shadow:0 12px 32px rgba(20,32,51,0.08);animation:fadeIn 0.25s ease-out}
    @keyframes fadeIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}
    .icon-box{width:64px;height:64px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;border-radius:50%}
    .icon-box.completed{background:#eaf8f2}.icon-box.failed{background:#fdf0f2}.icon-box.stopped{background:#f0f3f6}
    .status-badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;margin-bottom:12px}
    .status-badge.completed{color:#2e8b60;background:#e2f4ec}.status-badge.failed{color:#c04455;background:#fce6e9}.status-badge.stopped{color:#647482;background:#e6ecf1}
    .title{margin:0 0 10px;font-size:18px;font-weight:650;color:#142033}
    .description{margin:0 0 24px;font-size:13px;line-height:1.6;color:#506273}
    .highlight-text{color:#2e8b60;font-weight:600}
    .highlight-error{color:#c04455;font-weight:600}
    .btn-group{display:flex;gap:10px;justify-content:center}
    .btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;transition:all 0.15s ease}
    .btn.primary{background:#206bc4;color:#fff;box-shadow:0 2px 6px rgba(32,107,196,0.25)}.btn.primary:hover{background:#1a59a5}
    .btn.secondary{background:#f1f5f9;color:#475569;border:1px solid #cbd5e1}.btn.secondary:hover{background:#e2e8f0;color:#1e293b}
  </style></head><body>
    <div class="bar"><div class="brand">UniSearch采集浏览器</div><nav class="tabs">${tabs}</nav></div>
    ${bodyContent}
  </body></html>`;
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
  if (!crawlerTabStates.has(platform)) return false;

  activeCrawlerPlatform = platform;
  const view = crawlerViews.get(platform);
  if (view && !view.webContents.isDestroyed()) {
    crawlerHubWindow.setBrowserView(view);
    layoutActiveCrawlerView();
  } else {
    crawlerHubWindow.setBrowserView(null);
  }
  crawlerHubWindow.setTitle(`UniSearch 内置采集浏览器 · ${CRAWLER_PLATFORM_NAMES[platform] || platform.toUpperCase()}`);
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
    if (url.startsWith('unisearch-tab://')) {
      event.preventDefault();
      const target = decodeURIComponent(new URL(url).hostname);
      activateCrawlerView(target);
    } else if (url.startsWith('unisearch-action://')) {
      event.preventDefault();
      const actionUrl = new URL(url);
      const action = actionUrl.hostname;
      if (action === 'focus-main') {
        focusMainWindow();
      } else if (action === 'close-tab') {
        const targetPlatform = decodeURIComponent(actionUrl.pathname.replace(/^\//, ''));
        closeCrawlerTab(targetPlatform);
      }
    }
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
  if (existing && !existing.webContents.isDestroyed()) {
    crawlerTabStates.set(platform, 'running');
    return existing;
  }
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
  crawlerTabStates.set(platform, 'running');
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

export function releaseCrawlerWindow(platform: string, status = 'completed', metrics?: CrawlerRunMetrics): boolean {
  const view = crawlerViews.get(platform);
  const finalStatus: CrawlerTabStatus = status === 'failed' || status === 'stopped' ? status : 'completed';
  crawlerTabStates.set(platform, finalStatus);
  if (metrics) {
    crawlerTabMetrics.set(platform, metrics);
  }

  if (!view) {
    refreshCrawlerHubTabs();
    return false;
  }

  const wasActive = activeCrawlerPlatform === platform;
  crawlerViews.delete(platform);
  if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });

  if (wasActive) {
    if (crawlerHubWindow && !crawlerHubWindow.isDestroyed()) {
      crawlerHubWindow.setBrowserView(null);
    }
    const nextRunning = Array.from(crawlerViews.keys())[0];
    if (nextRunning) {
      activateCrawlerView(nextRunning);
    }
  }
  refreshCrawlerHubTabs();

  if (crawlerViews.size === 0 && crawlerHubWindow && !crawlerHubWindow.isDestroyed()) {
    crawlerHubWindow.hide();
    focusMainWindow();
  }
  return true;
}

export function isCrawlerWindowVisible(platform?: string): boolean {
  const visible = Boolean(crawlerHubWindow && !crawlerHubWindow.isDestroyed() && crawlerHubWindow.isVisible());
  if (!platform) return visible;
  return visible && activeCrawlerPlatform === platform && crawlerViews.has(platform);
}

export function hasActiveCrawlerViews(): boolean {
  return crawlerViews.size > 0;
}

function resolveCrawlerPlatform(platform?: string): string | null {
  if (platform && crawlerTabStates.has(platform)) return platform;
  if (activeCrawlerPlatform && crawlerTabStates.has(activeCrawlerPlatform)) return activeCrawlerPlatform;
  return crawlerTabStates.keys().next().value ?? null;
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
      releaseCrawlerWindow,
      isCrawlerWindowVisible,
      hasActiveCrawlerViews,
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
