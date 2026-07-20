import { app, BrowserWindow, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { startServer, stopServer } from '../server';

app.setName('UniSearch');
process.title = 'UniSearch';

// Enable CDP remote debugging on Electron's built-in Chromium
app.commandLine.appendSwitch('remote-debugging-port', '9222');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');

let mainWindow: BrowserWindow | null = null;

let apiPort = 8080;

function getAppIconPath(): string | undefined {
  const iconFilename = process.platform === 'darwin' ? 'icon.png' : 'icon-windows.png';
  const iconPath = path.join(app.getAppPath(), 'build', iconFilename);
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

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

app.on('ready', async () => {
  try {
    const iconPath = getAppIconPath();
    if (process.platform === 'darwin' && iconPath) {
      app.dock.setIcon(iconPath);
    }

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
