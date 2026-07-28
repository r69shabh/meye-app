const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

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
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }
  
  // Enforce new windows open in default browser (except for OAuth popup which we intercept)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://accounts.google.com/o/oauth2/')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 600,
          modal: true,
          parent: mainWindow
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
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

// OAuth
ipcMain.handle('auth-google', async (event, clientId, scope) => {
  return new Promise((resolve, reject) => {
    const dummyRedirectUri = 'com.meye.app://oauth2callback';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${dummyRedirectUri}&response_type=token&scope=${encodeURIComponent(scope)}`;
    
    let authWindow = new BrowserWindow({
      width: 500,
      height: 600,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    
    authWindow.loadURL(authUrl);
    authWindow.show();
    
    function handleCallback(url) {
      if (url.startsWith(dummyRedirectUri)) {
        const hash = url.split('#')[1];
        if (hash) {
          const params = new URLSearchParams(hash);
          const accessToken = params.get('access_token');
          resolve({ access_token: accessToken });
        } else {
          reject(new Error('No hash fragment found'));
        }
        authWindow.destroy();
      }
    }
    
    authWindow.webContents.on('will-redirect', (e, url) => {
      if (url.startsWith(dummyRedirectUri)) {
        e.preventDefault();
        handleCallback(url);
      }
    });
    
    authWindow.on('closed', () => {
      authWindow = null;
      reject(new Error('Window closed by user'));
    });
  });
});
