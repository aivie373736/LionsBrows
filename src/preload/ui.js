'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['ui:state', 'ui:focus-find', 'overlay:open', 'bubble:show']);

contextBridge.exposeInMainWorld('lions', {
  cmd: (name, ...args) => ipcRenderer.invoke('ui:cmd', name, ...args),
  overlay: (name, ...args) => ipcRenderer.invoke('overlay:cmd', name, ...args),
  bubble: (name, ...args) => ipcRenderer.invoke('bubble:cmd', name, ...args),
  on: (channel, callback) => {
    if (!CHANNELS.has(channel)) return;
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  platform: process.platform,
});
