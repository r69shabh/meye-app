const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setSecure: (key, val) => ipcRenderer.invoke('secure-set', key, val),
  getSecure: (key) => ipcRenderer.invoke('secure-get', key),
  removeSecure: (key) => ipcRenderer.invoke('secure-remove', key),
  authorizeGoogleCalendar: (clientId, scope) => ipcRenderer.invoke('auth-google', clientId, scope)
});
