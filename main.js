const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');

let mainWindow = null;
let pyProc = null;
let pyPort = 8080;

// Helper to find a free TCP port using native Node net module
function getFreePort(startPort = 8080) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(getFreePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(startPort, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

// Poll FastAPI health endpoint until it returns a success status
function waitForBackend(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          next();
        }
      }).on('error', () => {
        next();
      });
    };

    const next = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error('Timeout waiting for Python backend to start'));
      } else {
        setTimeout(check, 300);
      }
    };

    check();
  });
}

// Spawn the Python FastAPI backend process
function startPythonBackend(port) {
  let backendPath = '';
  let args = [];

  if (!app.isPackaged) {
    // In Development mode, run the python script using current python environment
    backendPath = process.platform === 'win32' ? 'python' : 'python3';
    args = ['-m', 'api.main', `--port=${port}`];
    console.log(`[Dev] Spawning Python: ${backendPath} ${args.join(' ')}`);
  } else {
    // In Production mode, run the compiled binary located in app resources
    const binName = process.platform === 'win32' ? 'unisearch-backend.exe' : 'unisearch-backend';
    backendPath = path.join(
      process.resourcesPath,
      'unisearch-backend',
      binName
    );
    args = [`--port=${port}`];
    console.log(`[Prod] Spawning Python: ${backendPath} ${args.join(' ')}`);
  }

  pyProc = spawn(backendPath, args, {
    cwd: app.isPackaged ? undefined : __dirname,
    env: { ...process.env, PORT: port.toString() }
  });

  pyProc.stdout.on('data', (data) => {
    console.log(`[Python Output]: ${data.toString().trim()}`);
  });

  pyProc.stderr.on('data', (data) => {
    console.error(`[Python Error]: ${data.toString().trim()}`);
  });

  pyProc.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
  });
}

// Kill the Python subprocess
function killPythonBackend() {
  if (pyProc) {
    console.log('Terminating Python backend...');
    pyProc.kill('SIGTERM');
    pyProc = null;
  }
}

// Create the Electron browser window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'UniSearch Desktop',
  });

  mainWindow.loadURL(`http://127.0.0.1:${pyPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle hooks
app.on('ready', async () => {
  try {
    pyPort = await getFreePort(8080);
    console.log(`Selected free port for Python backend: ${pyPort}`);
    
    startPythonBackend(pyPort);
    
    console.log('Waiting for Python API backend to become healthy...');
    await waitForBackend(pyPort);
    console.log('Python API backend is ready. Launching UI.');
    
    createWindow();
  } catch (err) {
    console.error('Startup failed:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  killPythonBackend();
});

// Safeguard against orphaned processes
process.on('exit', () => {
  killPythonBackend();
});
