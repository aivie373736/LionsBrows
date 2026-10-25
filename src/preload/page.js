'use strict';

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'lions:') {
  contextBridge.exposeInMainWorld('lions', {
    call: (method, ...args) => ipcRenderer.invoke('lions:call', method, ...args),
    on: (callback) => ipcRenderer.on('lions:event', (_event, name, data) => callback(name, data)),
  });
}
