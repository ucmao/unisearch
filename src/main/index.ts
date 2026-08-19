import { app, BrowserView, BrowserWindow, dialog, shell, ipcMain, nativeTheme, screen } from 'electron';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { randomInt } from 'crypto';
import { startServer, stopServer } from '../server';
import { CRAWLER_ACCEPT_LANGUAGE, CRAWLER_LOCALE, CRAWLER_USER_AGENT } from '../tools/browserIdentity';
import { platformLabel, listConnectorManifests, getConnectorManifest } from '../connectors/registry';
import { clearCrawlerCredentialSessions, getCrawlerCredentialStatus } from '../tools/authCredentials';
import { fitWindowBoundsToDisplays, loadWindowState, saveWindowState } from './windowState';
import type { SavedWindowState } from './windowState';

app.setName('UniSearch');
process.title = 'UniSearch';

const isPackagedSmokeTest = process.env.UNISEARCH_SMOKE_TEST === '1';
const smokeUserDataDir = process.env.UNISEARCH_SMOKE_USER_DATA_DIR?.trim();
if (isPackagedSmokeTest && smokeUserDataDir) {
  fs.mkdirSync(smokeUserDataDir, { recursive: true });
  app.setPath('userData', smokeUserDataDir);
}

// Broken pipes to child processes (a crawler worker killed by stop/skip, a
// closed IPC channel) are expected teardown noise, not a reason to kill the
// app with Electron's "A JavaScript error occurred in the main process" dialog.
const IGNORED_UNCAUGHT_CODES = new Set(['EPIPE', 'ERR_IPC_CHANNEL_CLOSED', 'ERR_STREAM_DESTROYED']);

function isIgnorableProcessError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && IGNORED_UNCAUGHT_CODES.has(code);
}

// Registering this listener suppresses Electron's built-in crash dialog, so
// genuine errors are reported and terminated here instead.
process.on('uncaughtException', (error) => {
  if (isIgnorableProcessError(error)) {
    console.warn(`[Electron] Ignored child-process pipe error: ${error.message}`);
    return;
  }
  console.error('[Electron] Uncaught exception:', error);
  dialog.showErrorBox('UniSearch 发生错误', error?.stack || String(error));
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  if (isIgnorableProcessError(reason)) {
    console.warn('[Electron] Ignored child-process pipe rejection');
    return;
  }
  console.error('[Electron] Unhandled rejection:', reason);
});

// Enable CDP remote debugging on Electron's built-in Chromium
const configuredCdpPort = Number(process.env.UNISEARCH_CDP_PORT);
const cdpDebugPort = Number.isInteger(configuredCdpPort) && configuredCdpPort >= 1024 && configuredCdpPort <= 65535
  ? configuredCdpPort
  : randomInt(40000, 50000);
process.env.UNISEARCH_CDP_PORT = String(cdpDebugPort);
app.commandLine.appendSwitch('remote-debugging-port', String(cdpDebugPort));
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-allow-origins', '*');
// Never expose Electron/UniSearch tokens from any current or future WebContents.
app.commandLine.appendSwitch('user-agent', CRAWLER_USER_AGENT);
app.commandLine.appendSwitch('lang', CRAWLER_LOCALE);
// Keep crawler pages from exposing local network addresses through direct WebRTC UDP.
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

let mainWindow: BrowserWindow | null = null;
let crawlerHubWindow: BrowserWindow | null = null;
let crawlerHubRestoreMaximized = false;
const crawlerViews = new Map<string, BrowserView>();
type CrawlerTabStatus = 'running' | 'completed' | 'partial' | 'failed' | 'stopped';
const crawlerTabStates = new Map<string, CrawlerTabStatus>();
let activeCrawlerPlatform: string | null = null;
let isQuitting = false;
const windowStateTimers = new Map<string, NodeJS.Timeout>();
const guardedCrawlerPartitions = new Set<string>();

let apiPort = 8080;

function windowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function restoredWindowState(key: string, width: number, height: number): SavedWindowState | undefined {
  const saved = loadWindowState(windowStatePath(), key);
  if (!saved) return undefined;
  return {
    ...saved,
    bounds: fitWindowBoundsToDisplays(saved.bounds, screen.getAllDisplays(), { width, height }),
  };
}

function persistWindowState(key: string, window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const bounds = window.isMaximized() || window.isMinimized() || window.isFullScreen()
    ? window.getNormalBounds()
    : window.getBounds();
  try {
    saveWindowState(windowStatePath(), key, { bounds, maximized: window.isMaximized() });
  } catch (error) {
    console.warn(`[Electron] Failed to save ${key} window state:`, error);
  }
}

function trackWindowState(key: string, window: BrowserWindow): void {
  const scheduleSave = () => {
    const existing = windowStateTimers.get(key);
    if (existing) clearTimeout(existing);
    windowStateTimers.set(key, setTimeout(() => {
      windowStateTimers.delete(key);
      persistWindowState(key, window);
    }, 300));
  };
  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('closed', () => {
    const timer = windowStateTimers.get(key);
    if (timer) clearTimeout(timer);
    windowStateTimers.delete(key);
  });
}

function getAppIconPath(): string | undefined {
  const iconFilename = process.platform === 'darwin' ? 'icon.png' : 'icon-windows.png';
  const iconPath = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'build', iconFilename);
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function crawlerMarkerHtml(platform: string): string {
  const isDark = nativeTheme.shouldUseDarkColors;
  const label = platformLabel(platform);
  const manifest = getConnectorManifest(platform);
  const isHttp = manifest?.runtime?.engine === 'http';
  const statusText = isHttp ? '数据接口高速同步中' : '正在连接采集节点...';
  const subText = isHttp ? '后台静默解析传输中 · 无需渲染网页' : '即将载入目标页面';

  return `<!doctype html><html class="${isDark ? 'dark' : ''}"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#f0f4f8;color:#142033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center}
    .card-running{display:flex;flex-direction:column;align-items:center;gap:12px;animation:fadeIn 0.2s ease-out}
    .pulse-wrapper{position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center}
    .pulse-ring{position:absolute;width:100%;height:100%;border-radius:50%;background:#38bdf8;opacity:0.25;animation:pulse 2s cubic-bezier(0.24,0,0.38,1) infinite}
    .pulse-dot{width:10px;height:10px;border-radius:50%;background:#0284c7;box-shadow:0 0 8px rgba(2,132,199,0.5)}
    .title-running{font-size:13px;font-weight:600;color:#334155;letter-spacing:0.2px}
    .subtitle-running{font-size:12px;color:#94a3b8;margin-top:2px}
    @keyframes pulse{0%{transform:scale(0.6);opacity:0.8}70%{transform:scale(1.4);opacity:0}100%{transform:scale(1.4);opacity:0}}
    @keyframes fadeIn{from{opacity:0;transform:scale(0.98)}to{opacity:1;transform:scale(1)}}
    html.dark, body.dark{background:#1e1f22 !important;color:#bcbec4 !important}
    html.dark .pulse-ring{background:#38bdf8;opacity:0.2}
    html.dark .pulse-dot{background:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,0.6)}
    html.dark .title-running{color:#bcbec4}
    html.dark .subtitle-running{color:#6c707e}
    @media(prefers-color-scheme:dark){
      html,body{background:#1e1f22 !important;color:#bcbec4 !important}
      .pulse-ring{background:#38bdf8;opacity:0.2}
      .pulse-dot{background:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,0.6)}
      .title-running{color:#bcbec4}
      .subtitle-running{color:#6c707e}
    }
  </style></head><body class="${isDark ? 'dark' : ''}">
    <div class="card-running">
      <div class="pulse-wrapper">
        <div class="pulse-ring"></div>
        <div class="pulse-dot"></div>
      </div>
      <div style="text-align:center">
        <div class="title-running">${label} · ${statusText}</div>
        <div class="subtitle-running">${subText}</div>
      </div>
    </div>
  </body></html>`;
}

function crawlerMarkerUrl(platform: string): string {
  const html = crawlerMarkerHtml(platform);
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}#unisearch-crawler-${encodeURIComponent(platform)}`;
}

const CRAWLER_TAB_HEIGHT = 48;
const CRAWLER_TRAFFIC_LIGHT_GUTTER = process.platform === 'darwin' ? 78 : 10;

function crawlerHubBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f0f4f8';
}

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
  const wasActive = activeCrawlerPlatform === platform;

  if (crawlerHubWindow && !crawlerHubWindow.isDestroyed()) {
    if (crawlerHubWindow.getBrowserView() === view || wasActive) {
      crawlerHubWindow.setBrowserView(null);
    }
  }

  if (view) {
    crawlerViews.delete(platform);
    if (!view.webContents.isDestroyed()) {
      try {
        view.webContents.close({ waitForBeforeUnload: false });
      } catch {}
    }
  }
  crawlerTabStates.delete(platform);
  crawlerTabMetrics.delete(platform);

  if (wasActive) {
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
  const isRunningActive = activeState === 'running'
    && Boolean(activeCrawlerPlatform && crawlerViews.has(activeCrawlerPlatform));
  const isDark = nativeTheme.shouldUseDarkColors;

  const tabs = Array.from(crawlerTabStates.entries()).map(([platform, status]) => {
    const active = platform === activeCrawlerPlatform ? ' active' : '';
    const label = platformLabel(platform);
    const content = `<span class="dot ${status}"></span><span>${label}</span><span class="close-btn" onclick="event.preventDefault(); event.stopPropagation(); location.href='unisearch-action://close-tab/${encodeURIComponent(platform)}'">×</span>`;
    return `<a class="tab${active}" href="unisearch-tab://${encodeURIComponent(platform)}">${content}</a>`;
  }).join('');

  let bodyContent = '';
  if (activeCrawlerPlatform && !isRunningActive && activeState) {
    const label = platformLabel(activeCrawlerPlatform);
    if (activeState === 'running') {
      const manifest = getConnectorManifest(activeCrawlerPlatform);
      const isHttp = manifest?.runtime?.engine === 'http';
      const statusText = isHttp ? '数据接口高速同步中' : '正在连接采集节点...';
      const subText = isHttp ? '后台静默解析传输中 · 无需渲染网页界面' : '即将载入目标页面';

      bodyContent = `
        <div class="summary-container">
          <div class="card-running">
            <div class="pulse-wrapper">
              <div class="pulse-ring"></div>
              <div class="pulse-dot"></div>
            </div>
            <div style="text-align:center">
              <div class="title-running">${label} · ${statusText}</div>
              <div class="subtitle-running">${subText}</div>
            </div>
            <div class="btn-group" style="margin-top:8px">
              <a class="btn secondary" href="unisearch-action://focus-main">返回主界面看板</a>
            </div>
          </div>
        </div>
      `;
    } else {
      const metrics = crawlerTabMetrics.get(activeCrawlerPlatform);
      let statusTitle: string;
      let statusDesc: string;
      let iconSvg: string;
      const badgeClass = activeState;

      if (activeState === 'completed') {
        const count = metrics?.itemCount ?? 0;
        const duration = metrics?.durationSeconds !== undefined ? `，耗时 ${metrics.durationSeconds} 秒` : '';
        statusTitle = `${label} 采集成功`;
        statusDesc = `<strong class="highlight-text">共获取 ${count} 条数据${duration}。</strong>`;
        iconSvg = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#4bb98a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
      } else if (activeState === 'partial') {
        const count = metrics?.itemCount ?? 0;
        statusTitle = `${label} 仅获得部分结果`;
        statusDesc = `<strong class="highlight-partial">共获取 ${count} 条数据。${metrics?.error || '未达到用户设置的数量上限。'}</strong>`;
        iconSvg = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d99735" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      } else if (activeState === 'failed') {
        const rawReason = metrics?.error ? `错误提示：${metrics.error}` : '错误提示：页面响应超时或触发风控验证拦截';
        const errReason = /[。.]\s*$/.test(rawReason) ? rawReason : `${rawReason}。`;
        statusTitle = `${label} 采集中断`;
        statusDesc = `<strong class="highlight-error">${errReason}</strong>`;
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
            <div class="status-badge ${badgeClass}">${activeState === 'completed' ? '采集完成' : activeState === 'partial' ? '部分完成' : activeState === 'failed' ? '采集失败' : '已停止'}</div>
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
  }

  return `<!doctype html><html class="${isDark ? 'dark' : ''}"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#f0f4f8;color:#142033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .bar{height:${CRAWLER_TAB_HEIGHT}px;display:flex;align-items:flex-end;gap:4px;padding:7px 10px 0 ${CRAWLER_TRAFFIC_LIGHT_GUTTER}px;border-bottom:1px solid #cbd8e2;background:linear-gradient(#f8fbfd,#e8f0f5);-webkit-app-region:drag}
    .brand{align-self:center;padding:0 10px 4px 2px;font-size:12px;font-weight:650;color:#506273;white-space:nowrap}
    .tabs{display:flex;min-width:0;height:40px;gap:4px;overflow-x:auto;-webkit-app-region:no-drag}
    .tab{display:flex;align-items:center;gap:7px;min-width:96px;height:36px;padding:0 8px 0 12px;border:1px solid transparent;border-radius:10px 10px 0 0;color:#627487;text-decoration:none;font-size:13px;font-weight:550;white-space:nowrap;transition:all 0.15s ease}
    .tab:hover{background:#f7fbfd;color:#203246}.tab.active{border-color:#cbd8e2;border-bottom-color:#fff;background:#fff;color:#142033}
    .close-btn{margin-left:auto;padding:0 4px;font-size:13px;line-height:1;color:#9aa7b4;border-radius:4px;opacity:0.6;transition:all 0.15s ease}
    .close-btn:hover{color:#d66b7b;background:rgba(214,107,123,0.15);opacity:1}
    .dot{width:7px;height:7px;border-radius:50%;background:#59bdd6;box-shadow:0 0 0 3px rgba(89,189,214,.12);flex-shrink:0}
    .dot.completed{background:#4bb98a;box-shadow:0 0 0 3px rgba(75,185,138,.12)}.dot.partial{background:#d99735;box-shadow:0 0 0 3px rgba(217,151,53,.12)}.dot.failed{background:#d66b7b;box-shadow:0 0 0 3px rgba(214,107,123,.12)}.dot.stopped{background:#9aa7b4;box-shadow:0 0 0 3px rgba(154,167,180,.12)}
    
    .summary-container{display:flex;align-items:center;justify-content:center;height:calc(100vh - ${CRAWLER_TAB_HEIGHT}px);padding:20px;background:linear-gradient(135deg, #eef4f8 0%, #e2ecf3 100%)}
    .card-running{display:flex;flex-direction:column;align-items:center;gap:12px;animation:fadeIn 0.2s ease-out}
    .pulse-wrapper{position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center}
    .pulse-ring{position:absolute;width:100%;height:100%;border-radius:50%;background:#38bdf8;opacity:0.25;animation:pulse 2s cubic-bezier(0.24,0,0.38,1) infinite}
    .pulse-dot{width:10px;height:10px;border-radius:50%;background:#0284c7;box-shadow:0 0 8px rgba(2,132,199,0.5)}
    .title-running{font-size:13px;font-weight:600;color:#334155;letter-spacing:0.2px}
    .subtitle-running{font-size:12px;color:#94a3b8;margin-top:2px}
    @keyframes pulse{0%{transform:scale(0.6);opacity:0.8}70%{transform:scale(1.4);opacity:0}100%{transform:scale(1.4);opacity:0}}
    .summary-card{margin:auto;max-width:440px;width:100%;background:#ffffff;border:1px solid #d0dee8;border-radius:16px;padding:32px 28px;text-align:center;box-shadow:0 12px 32px rgba(20,32,51,0.08);animation:fadeIn 0.25s ease-out}
    @keyframes fadeIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}
    .icon-box{width:64px;height:64px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;border-radius:50%}
    .icon-box.completed{background:#eaf8f2}.icon-box.partial{background:#fff6e6}.icon-box.failed{background:#fdf0f2}.icon-box.stopped{background:#f0f3f6}
    .status-badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;margin-bottom:12px}
    .status-badge.completed{color:#2e8b60;background:#e2f4ec}.status-badge.partial{color:#9a6415;background:#ffedcc}.status-badge.failed{color:#c04455;background:#fce6e9}.status-badge.stopped{color:#647482;background:#e6ecf1}
    .title{margin:0 0 10px;font-size:18px;font-weight:650;color:#142033}
    .description{margin:0 0 24px;font-size:13px;line-height:1.6;color:#506273}
    .highlight-text{color:#2e8b60;font-weight:600}
    .highlight-partial{color:#9a6415;font-weight:600}
    .highlight-error{color:#c04455;font-weight:600}
    .btn-group{display:flex;gap:10px;justify-content:center}
    .btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;transition:all 0.15s ease}
    .btn.primary{background:#206bc4;color:#fff;box-shadow:0 2px 6px rgba(32,107,196,0.25)}.btn.primary:hover{background:#1a59a5}
    .btn.secondary{background:#f1f5f9;color:#475569;border:1px solid #cbd5e1}.btn.secondary:hover{background:#e2e8f0;color:#1e293b}

    /* Dark Mode (PyCharm Dark Theme) */
    html.dark, body.dark {
      background: #1e1f22 !important;
      color: #bcbec4 !important;
    }
    html.dark .bar, body.dark .bar { border-bottom-color: #393b40 !important; background: #2b2d30 !important; }
    html.dark .brand, body.dark .brand { color: #868a91 !important; }
    html.dark .tab, body.dark .tab { color: #868a91 !important; }
    html.dark .tab:hover, body.dark .tab:hover { background: #35373c !important; color: #bcbec4 !important; }
    html.dark .tab.active, body.dark .tab.active { border-color: #393b40 !important; border-bottom-color: #1e1f22 !important; background: #1e1f22 !important; color: #bcbec4 !important; }
    html.dark .close-btn, body.dark .close-btn { color: #868a91 !important; }
    html.dark .close-btn:hover, body.dark .close-btn:hover { color: #f25c6e !important; background: rgba(242,92,110,0.2) !important; }
    html.dark .summary-container, body.dark .summary-container { background: #1e1f22 !important; }
    html.dark .pulse-ring, body.dark .pulse-ring { background: #38bdf8; opacity: 0.2; }
    html.dark .pulse-dot, body.dark .pulse-dot { background: #38bdf8; box-shadow: 0 0 10px rgba(56,189,248,0.6); }
    html.dark .title-running, body.dark .title-running { color: #bcbec4; }
    html.dark .subtitle-running, body.dark .subtitle-running { color: #6c707e; }
    html.dark .summary-card, body.dark .summary-card { background: #2b2d30 !important; border-color: #393b40 !important; box-shadow: 0 12px 32px rgba(0,0,0,0.4) !important; }
    html.dark .title, body.dark .title { color: #bcbec4 !important; }
    html.dark .description, body.dark .description { color: #868a91 !important; }
    html.dark .btn.secondary, body.dark .btn.secondary { background: #35373c !important; color: #bcbec4 !important; border-color: #393b40 !important; }
    html.dark .btn.secondary:hover, body.dark .btn.secondary:hover { background: #3c3f44 !important; color: #ffffff !important; }
    html.dark .icon-box.completed, body.dark .icon-box.completed { background: rgba(75,185,138,0.15) !important; }
    html.dark .icon-box.failed, body.dark .icon-box.failed { background: rgba(214,107,123,0.15) !important; }
    html.dark .icon-box.stopped, body.dark .icon-box.stopped { background: rgba(134,138,145,0.15) !important; }

    @media (prefers-color-scheme: dark) {
      html, body { background: #1e1f22 !important; color: #bcbec4 !important; }
      .bar { border-bottom-color: #393b40 !important; background: #2b2d30 !important; }
      .brand { color: #868a91 !important; }
      .tab { color: #868a91 !important; }
      .tab:hover { background: #35373c !important; color: #bcbec4 !important; }
      .tab.active { border-color: #393b40 !important; border-bottom-color: #1e1f22 !important; background: #1e1f22 !important; color: #bcbec4 !important; }
      .close-btn { color: #868a91 !important; }
      .close-btn:hover { color: #f25c6e !important; background: rgba(242,92,110,0.2) !important; }
      .summary-container { background: #1e1f22 !important; }
      .pulse-ring { background: #38bdf8; opacity: 0.2; }
      .pulse-dot { background: #38bdf8; box-shadow: 0 0 10px rgba(56,189,248,0.6); }
      .title-running { color: #bcbec4; }
      .subtitle-running { color: #6c707e; }
      .summary-card { background: #2b2d30 !important; border-color: #393b40 !important; box-shadow: 0 12px 32px rgba(0,0,0,0.4) !important; }
      .title { color: #bcbec4 !important; }
      .description { color: #868a91 !important; }
      .btn.secondary { background: #35373c !important; color: #bcbec4 !important; border-color: #393b40 !important; }
      .btn.secondary:hover { background: #3c3f44 !important; color: #ffffff !important; }
      .icon-box.completed { background: rgba(75,185,138,0.15) !important; }
      .icon-box.failed { background: rgba(214,107,123,0.15) !important; }
      .icon-box.stopped { background: rgba(134,138,145,0.15) !important; }
    }
  </style></head><body class="${isDark ? 'dark' : ''}">
    <div class="bar"><div class="brand">UniSearch采集浏览器</div><nav class="tabs">${tabs}</nav></div>
    ${bodyContent}
  </body></html>`;
}

let refreshTabsTimer: NodeJS.Timeout | null = null;
function refreshCrawlerHubTabs(): void {
  if (!crawlerHubWindow || crawlerHubWindow.isDestroyed()) return;
  if (refreshTabsTimer) clearTimeout(refreshTabsTimer);
  refreshTabsTimer = setTimeout(() => {
    refreshTabsTimer = null;
    if (!crawlerHubWindow || crawlerHubWindow.isDestroyed()) return;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(crawlerHubHtml())}`;
    void crawlerHubWindow.loadURL(dataUrl).catch(() => {});
  }, 50);
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
  crawlerHubWindow.setTitle(`UniSearch 内置采集浏览器 · ${platformLabel(platform)}`);
  refreshCrawlerHubTabs();
  return true;
}

function createCrawlerHubWindow(): BrowserWindow {
  if (crawlerHubWindow && !crawlerHubWindow.isDestroyed()) return crawlerHubWindow;
  const restoredState = restoredWindowState('crawler', 1280, 800);
  crawlerHubRestoreMaximized = Boolean(restoredState?.maximized);
  crawlerHubWindow = new BrowserWindow({
    ...(restoredState?.bounds ?? { width: 1280, height: 800 }),
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: 'UniSearch 内置采集浏览器',
    icon: getAppIconPath(),
    backgroundColor: crawlerHubBackgroundColor(),
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 14, y: 14 },
    } : {
      autoHideMenuBar: true,
    }),
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform !== 'darwin') {
    crawlerHubWindow.removeMenu();
  }
  trackWindowState('crawler', crawlerHubWindow);
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
    crawlerHubRestoreMaximized = false;
  });
  refreshCrawlerHubTabs();
  return crawlerHubWindow;
}

nativeTheme.on('updated', () => {
  if (crawlerHubWindow && !crawlerHubWindow.isDestroyed()) {
    crawlerHubWindow.setBackgroundColor(crawlerHubBackgroundColor());
  }
  refreshCrawlerHubTabs();
});

export function createCrawlerView(platform: string): BrowserView {
  const existing = crawlerViews.get(platform);
  if (existing && !existing.webContents.isDestroyed()) {
    crawlerTabStates.set(platform, 'running');
    return existing;
  }
  createCrawlerHubWindow();
  const partition = `persist:unisearch-crawler-${platform}`;
  const view = new BrowserView({
    webPreferences: {
      backgroundThrottling: false,
      partition,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  view.webContents.session.setUserAgent(CRAWLER_USER_AGENT, CRAWLER_ACCEPT_LANGUAGE);
  view.webContents.setUserAgent(CRAWLER_USER_AGENT);

  // 严禁采集器页面触发任何系统级文件下载（例如抖音/小红书等推广客户端安装包）
  if (!guardedCrawlerPartitions.has(partition)) {
    guardedCrawlerPartitions.add(partition);
    view.webContents.session.on('will-download', (event, item) => {
      event.preventDefault();
      item.cancel();
      console.log(`[Crawler] 已静默拦截平台 "${platform}" 发起的非预期文件下载: ${item.getFilename()} (${item.getURL()})`);
    });
  }

  crawlerViews.set(platform, view);
  crawlerTabStates.set(platform, 'running');
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  refreshCrawlerHubTabs();
  return view;
}

export async function prepareCrawlerWindow(platform: string, preserveCurrentPage = false): Promise<boolean> {
  const existing = crawlerViews.get(platform);
  const alreadyPrepared = Boolean(existing && !existing.webContents.isDestroyed());
  const view = createCrawlerView(platform);
  if (view.webContents.isDestroyed()) return false;
  // Verification/login notifications can arrive after the worker has already
  // navigated this view. Preparing it again must only surface the existing
  // page; replacing a challenge with about:blank destroys the user's flow and
  // can make the worker interpret the marker page as a successful navigation.
  if (!preserveCurrentPage || !alreadyPrepared) await view.webContents.loadURL(crawlerMarkerUrl(platform));
  if (!activeCrawlerPlatform || activeCrawlerPlatform === platform || !crawlerViews.has(activeCrawlerPlatform)) {
    activateCrawlerView(platform);
  }
  else refreshCrawlerHubTabs();
  return true;
}

export function releaseCrawlerWindow(platform: string, _status = 'completed', _metrics?: CrawlerRunMetrics): boolean {
  const view = crawlerViews.get(platform);
  crawlerTabStates.delete(platform);
  crawlerTabMetrics.delete(platform);

  if (!view) {
    refreshCrawlerHubTabs();
    return false;
  }

  const wasActive = activeCrawlerPlatform === platform;
  crawlerViews.delete(platform);

  // CRITICAL: Always detach from crawlerHubWindow FIRST before closing webContents
  if (crawlerHubWindow && !crawlerHubWindow.isDestroyed()) {
    if (crawlerHubWindow.getBrowserView() === view || wasActive) {
      crawlerHubWindow.setBrowserView(null);
    }
  }

  if (!view.webContents.isDestroyed()) {
    try {
      view.webContents.close({ waitForBeforeUnload: false });
    } catch {}
  }

  if (wasActive) {
    const nextRunning = Array.from(crawlerViews.keys())[0];
    if (nextRunning) {
      activateCrawlerView(nextRunning);
    } else {
      activeCrawlerPlatform = null;
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

export function canOpenCrawlerWindow(): boolean {
  return crawlerViews.size > 0;
}

export function getActiveCrawlerPlatforms(): string[] {
  return Array.from(crawlerViews.keys());
}

function resolveCrawlerPlatform(platform?: string): string | null {
  if (platform && crawlerViews.has(platform)) return platform;
  if (platform && crawlerTabStates.has(platform)) return platform;
  if (activeCrawlerPlatform && crawlerViews.has(activeCrawlerPlatform)) return activeCrawlerPlatform;
  return crawlerViews.keys().next().value ?? crawlerTabStates.keys().next().value ?? null;
}

export function showCrawlerWindow(platform?: string): boolean {
  const resolvedPlatform = resolveCrawlerPlatform(platform);
  if (!resolvedPlatform) return false;
  const hub = createCrawlerHubWindow();
  const existing = crawlerViews.get(resolvedPlatform);
  if (!existing || existing.webContents.isDestroyed()) {
    const view = createCrawlerView(resolvedPlatform);
    if (!view.webContents.isDestroyed()) {
      void view.webContents.loadURL(crawlerMarkerUrl(resolvedPlatform)).catch(() => {});
    }
  }
  if (!activateCrawlerView(resolvedPlatform)) return false;
  if (hub.isMinimized()) hub.restore();
  hub.show();
  // Calling maximize() while a hidden BrowserWindow is being prepared can
  // reveal it on macOS. Restore the saved maximized state only after an
  // explicit user action has made the crawler window visible.
  if (crawlerHubRestoreMaximized && !hub.isMaximized()) hub.maximize();
  crawlerHubRestoreMaximized = false;
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

export const PLATFORM_ENTRY_URLS: Record<string, string> = {
  xhs: 'https://www.xiaohongshu.com/explore',
  douyin: 'https://www.douyin.com',
  kuaishou: 'https://www.kuaishou.com',
  bili: 'https://www.bilibili.com',
  weibo: 'https://weibo.com',
  tieba: 'https://tieba.baidu.com',
  zhihu: 'https://www.zhihu.com',
  boss: 'https://www.zhipin.com',
  zhaopin: 'https://passport.zhaopin.com/login',
  job51: 'https://login.51job.com',
  liepin: 'https://www.liepin.com',
  heimao: 'https://tousu.sina.com.cn',
  deepseek: 'https://chat.deepseek.com',
  kimi: 'https://kimi.moonshot.cn',
  doubao: 'https://www.doubao.com/chat',
  qwen: 'https://tongyi.aliyun.com/qianwen',
  yuanbao: 'https://yuanbao.tencent.com/chat',
  nami: 'https://www.namiapps.com',
  wenxin: 'https://yiyan.baidu.com',
  toutiao: 'https://www.toutiao.com',
  baidu: 'https://www.baidu.com',
  bing: 'https://www.bing.com',
  so360: 'https://www.so.com',
  sogou: 'https://www.sogou.com',
  quark: 'https://m.sm.cn',
  chinaso: 'https://www.chinaso.com',
  arxiv: 'https://arxiv.org',
  github_repositories: 'https://github.com',
  aihot: 'https://aihot.virxact.com',
};

export async function openPlatformAuthWindow(platform: string, targetUrl?: string): Promise<boolean> {
  const hub = createCrawlerHubWindow();
  const urlToLoad = targetUrl?.trim() || PLATFORM_ENTRY_URLS[platform] || `https://${platform}.com`;

  let view = crawlerViews.get(platform);
  if (!view || view.webContents.isDestroyed()) {
    view = createCrawlerView(platform);
  }

  crawlerTabStates.set(platform, 'running');

  try {
    const currentUrl = view.webContents.getURL();
    if (!currentUrl || currentUrl === 'about:blank' || currentUrl.startsWith('data:text/html')) {
      void view.webContents.loadURL(urlToLoad).catch((err) => {
        console.warn(`[Electron] Failed to load URL ${urlToLoad} for ${platform}:`, err);
      });
    }
  } catch (err) {
    console.warn(`[Electron] Error preparing view for ${platform}:`, err);
  }

  if (!activateCrawlerView(platform)) return false;
  if (hub.isMinimized()) hub.restore();
  hub.show();
  if (crawlerHubRestoreMaximized && !hub.isMaximized()) hub.maximize();
  crawlerHubRestoreMaximized = false;
  hub.focus();
  return true;
}

// IPC Handlers
ipcMain.handle('crawler-window-status', (_event, platform?: string) => isCrawlerWindowVisible(platform));
ipcMain.handle('crawler-window-show', (_event, platform: string) => showCrawlerWindow(platform));
ipcMain.handle('crawler-window-hide', (_event, platform: string) => hideCrawlerWindow(platform));
ipcMain.handle('crawler-window-toggle', (_event, platform: string) => toggleCrawlerWindow(platform));
ipcMain.handle('crawler-platform-open-auth', (_event, platform: string, url?: string) => openPlatformAuthWindow(platform, url));

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
  const restoredState = restoredWindowState('main', 1200, 800);
  mainWindow = new BrowserWindow({
    ...(restoredState?.bounds ?? { width: 1200, height: 800 }),
    icon: getAppIconPath(),
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 14, y: 14 },
    } : {
      autoHideMenuBar: true,
    }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'UniSearch Desktop',
  });
  if (process.platform !== 'darwin') {
    mainWindow.removeMenu();
  }
  trackWindowState('main', mainWindow);
  if (restoredState?.maximized) mainWindow.maximize();

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
    let rawFilename = item.getFilename();
    try {
      rawFilename = decodeURIComponent(rawFilename);
    } catch {}
    // 移除非法文件名字符
    const cleanFilename = rawFilename.replace(/[\\/:*?"<>|]/g, '_') || '下载文件';
    const downloadsDir = app.getPath('downloads');
    const defaultPath = path.join(downloadsDir, cleanFilename);

    item.setSaveDialogOptions({
      title: '选择保存位置',
      defaultPath,
      properties: ['showOverwriteConfirmation'],
    });

    item.once('done', (_downloadEvent, state) => {
      if (state === 'completed') {
        const savedPath = item.getSavePath();
        if (savedPath && fs.existsSync(savedPath)) {
          shell.showItemInFolder(savedPath);
        }
      } else if (state === 'cancelled') {
        console.log('[Download] 用户取消了保存');
      } else {
        console.error(`[Download] 下载失败: ${state}`);
      }
    });
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      if (process.platform === 'darwin') {
        // macOS: 遵循系统原生习惯，关闭红灯时仅隐藏窗口，保留 Dock 常驻，Cmd+Q 时彻底退出
        event.preventDefault();
        mainWindow?.hide();
      } else {
        // Windows / Linux: 点击关闭按钮直接彻底退出程序
        app.quit();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) persistWindowState('main', mainWindow);
  if (crawlerHubWindow && !crawlerHubWindow.isDestroyed()) persistWindowState('crawler', crawlerHubWindow);
});

export async function clearCrawlerSessionData(platform?: string): Promise<void> {
  const { session } = require('electron');
  const platformIds = platform
    ? [platform]
    : listConnectorManifests().map((connector) => connector.id);

  await clearCrawlerCredentialSessions(
    platformIds,
    (partitionName) => session.fromPartition(partitionName),
    closeCrawlerTab,
  );
}

export async function getCrawlerSessionDataStatus(platform?: string) {
  const { session } = require('electron');
  const platformIds = platform
    ? [platform]
    : listConnectorManifests().map((connector) => connector.id);

  return getCrawlerCredentialStatus(
    platformIds,
    (partitionName) => session.fromPartition(partitionName),
  );
}

app.on('ready', async () => {
  try {
    process.env.UNISEARCH_RESOURCES_DIR = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const iconPath = getAppIconPath();
    if (process.platform === 'darwin' && iconPath) {
      app.dock?.setIcon(iconPath);
    }

    apiPort = await getFreePort(8080);
    console.log(`[Electron] Starting Fastify API on free port: ${apiPort}`);

    // Start local Fastify server
    await startServer(apiPort, {
      prepareCrawlerWindow,
      releaseCrawlerWindow,
      isCrawlerWindowVisible,
      hasActiveCrawlerViews,
      canOpenCrawlerWindow,
      getActiveCrawlerPlatforms,
      showCrawlerWindow,
      hideCrawlerWindow,
      toggleCrawlerWindow,
      clearCrawlerSessionData,
      openPlatformWindow: openPlatformAuthWindow,
      getCrawlerCredentialStatus: getCrawlerSessionDataStatus,
    });
    console.log('[Electron] Fastify server started successfully. Launching UI.');

    if (isPackagedSmokeTest) {
      const healthResponse = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
      const environmentResponse = await fetch(`http://127.0.0.1:${apiPort}/api/env/check`);
      const health = await healthResponse.json() as { status?: string };
      const environment = await environmentResponse.json() as { success?: boolean; output?: string };
      if (!healthResponse.ok || health.status !== 'ok' || !environmentResponse.ok || !environment.success) {
        throw new Error(`安装后冒烟检查失败: health=${JSON.stringify(health)} env=${JSON.stringify(environment)}`);
      }
      console.log(`[UniSearch Smoke] PASS ${environment.output || ''}`.trim());
      await stopServer();
      app.quit();
      return;
    }

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
