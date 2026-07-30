const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setSecure: (key, val) => ipcRenderer.invoke('secure-set', key, val),
  getSecure: (key) => ipcRenderer.invoke('secure-get', key),
  removeSecure: (key) => ipcRenderer.invoke('secure-remove', key),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  setOverlayState: (isActive) => ipcRenderer.send('set-overlay-state', isActive),
  openAuthWindow: (url) => ipcRenderer.send('open-auth-window', url),
  startOAuthFlow: (urlTemplate) => ipcRenderer.invoke('start-oauth-flow', urlTemplate),
  dictationStart: () => ipcRenderer.send('dictation-start'),
  dictationStop: () => ipcRenderer.send('dictation-stop'),
  onDictationResult: (callback) => {
    ipcRenderer.removeAllListeners('dictation-result');
    ipcRenderer.on('dictation-result', (event, data) => callback(data));
  }
});
