'use strict';

// Preload for tabs. Websites get nothing; LionsBrows' own lions:// pages get
// a small API (the main process checks the caller's URL again on every call).

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'lions:') {
  contextBridge.exposeInMainWorld('lions', {
    call: (method, ...args) => ipcRenderer.invoke('lions:call', method, ...args),
    on: (callback) => ipcRenderer.on('lions:event', (_event, name, data) => callback(name, data)),
  });
}
