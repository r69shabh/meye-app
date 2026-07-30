const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const storagePath = path.join(app.getPath('userData'), 'secure-store.json');

let mainWindow;

function loadStore() {
  try {
    if (fs.existsSync(storagePath)) {
      return JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load store', e);
  }
  return {};
}

function saveStore(data) {
  try {
    fs.writeFileSync(storagePath, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.error('Failed to save store', e);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.setAspectRatio(9 / 16);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }
  
  // Enforce new windows open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Deep linking registration
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('meyeeapp', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('meyeeapp')
}

// macOS specific deep link handler
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(urlStr) {
  try {
    const url = new URL(urlStr);
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        if (typeof SyncManager !== 'undefined') {
          const hash = "${url.hash}";
          const search = "${url.search}";
          if (hash.includes('access_token')) {
            const params = new URLSearchParams(hash.substring(1));
            const token = params.get('access_token');
            if (token) {
              Platform.Storage.setSecure('meyeGCalToken', token).then(() => {
                if (typeof SettingsView !== 'undefined') {
                  SettingsView.prefs.calSync = 'google';
                  SettingsView.save();
                  SettingsView.applyAll();
                }
                SyncManager.fetchGoogleEvents();
                alert("Google Calendar Connected!");
              });
            }
          } else if (search.includes('code=')) {
            const params = new URLSearchParams(search.substring(1));
            const code = params.get('code');
            if (code) {
              SyncManager.exchangeCodeForToken(code);
            }
          }
        }
      `);
    }
  } catch (e) {
    console.error('Deep link error:', e);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// -- IPC Handlers --

// Secure Storage
ipcMain.handle('secure-set', async (event, key, val) => {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('safeStorage not available, saving unencrypted');
    const store = loadStore();
    store[key] = val;
    saveStore(store);
    return;
  }
  const encrypted = safeStorage.encryptString(val);
  const store = loadStore();
  store[key] = encrypted.toString('base64');
  saveStore(store);
});

ipcMain.handle('secure-get', async (event, key) => {
  const store = loadStore();
  const val = store[key];
  if (!val) return null;
  
  if (!safeStorage.isEncryptionAvailable()) {
    return val;
  }
  
  try {
    const buffer = Buffer.from(val, 'base64');
    return safeStorage.decryptString(buffer);
  } catch (e) {
    console.error('Failed to decrypt', e);
    return null;
  }
});

ipcMain.handle('secure-remove', async (event, key) => {
  const store = loadStore();
  delete store[key];
  saveStore(store);
});

ipcMain.on('open-external', (event, externalUrl) => {
  shell.openExternal(externalUrl);
});

ipcMain.handle('start-oauth-flow', async (event, urlTemplate) => {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, 'http://127.0.0.1');
      if (parsedUrl.pathname === '/callback-data') {
        const params = Object.fromEntries(parsedUrl.searchParams.entries());
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><script>window.close();</script><h1>Authenticated! You can close this tab now and return to Meye.</h1></body></html>');
        params._port = server.address().port;
        server.close();
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
        resolve(params);
      } else {
        // Initial redirect hits here (Google with hash, GitHub with query)
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body>
            <script>
              if (window.location.hash) {
                window.location.href = '/callback-data?' + window.location.hash.substring(1);
              } else if (window.location.search) {
                window.location.href = '/callback-data' + window.location.search;
              } else {
                document.body.innerHTML = 'Error: No auth data received.';
              }
            </script>
          </body></html>
        `);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const finalUrl = urlTemplate.replace('%7BPORT%7D', port).replace('{PORT}', port);
      shell.openExternal(finalUrl);
    });
  });
});

ipcMain.on('set-overlay-state', (event, isActive) => {
  if (!mainWindow) return;
  const currentBounds = mainWindow.getBounds();
  const height = currentBounds.height;
  const baseWidth = Math.round(height * (9 / 16));
  
  if (isActive) {
    mainWindow.setAspectRatio(18 / 16);
    mainWindow.setBounds({ width: baseWidth * 2, height: height, x: currentBounds.x, y: currentBounds.y });
  } else {
    mainWindow.setAspectRatio(9 / 16);
    mainWindow.setBounds({ width: baseWidth, height: height, x: currentBounds.x, y: currentBounds.y });
  }
});

const { spawn } = require('child_process');
let dictationProcess = null;

ipcMain.on('dictation-start', (event) => {
  if (dictationProcess) return;
  const scriptPath = path.join(__dirname, 'src-mac', 'mac-dictation.swift');
  dictationProcess = spawn('swift', [scriptPath]);
  
  dictationProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        event.reply('dictation-result', obj);
      } catch (e) {}
    }
  });
  
  dictationProcess.on('close', () => {
    event.reply('dictation-result', { type: 'end' });
    dictationProcess = null;
  });
});

ipcMain.on('dictation-stop', () => {
  if (dictationProcess) {
    dictationProcess.kill();
    dictationProcess = null;
  }
});
