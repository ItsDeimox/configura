'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const droppedPaths = new Set();
const call = (channel, ...args) => ipcRenderer.invoke(`configura:${channel}`, ...args);
function listen(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Expected callback');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(`configura:${channel}`, listener);
  return () => ipcRenderer.removeListener(`configura:${channel}`, listener);
}
contextBridge.exposeInMainWorld('configura', Object.freeze({
  getAppInfo: () => call('app-info'),
  getInitialFiles: () => call('initial-files'),
  openFiles: () => call('open-files'),
  openPaths: (paths) => {
    if (!Array.isArray(paths) || paths.some((p) => !droppedPaths.has(p))) return Promise.reject(new Error('Arraste arquivos do Explorador para abrir.'));
    for (const p of paths) droppedPaths.delete(p);
    return call('open-paths', paths);
  },
  openRecent: (filePath) => call('open-recent', filePath),
  saveFile: (request) => call('save-file', request),
  closeFile: (id) => call('close-file', id),
  setDirty: (dirty) => ipcRenderer.send('configura:dirty', dirty),
  window: (action) => ipcRenderer.send('configura:window', action),
  confirmClose: () => ipcRenderer.send('configura:confirm-close'),
  cancelClose: () => ipcRenderer.send('configura:cancel-close'),
  getPreferences: () => call('preferences'),
  setPreferences: (patch) => call('set-preferences', patch),
  getUpdateState: () => call('update-state'),
  checkForUpdates: () => call('check-updates'),
  downloadUpdate: () => call('download-update'),
  installUpdate: () => call('install-update'),
  onOpenFiles: (callback) => listen('open-files', callback),
  onUpdateState: (callback) => listen('update-state', callback),
  onMenuAction: (callback) => listen('menu-action', callback),
  getPathForFile: (file) => {
    const filePath = webUtils.getPathForFile(file);
    if (filePath) droppedPaths.add(filePath);
    return filePath;
  },
}));
