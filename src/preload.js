'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['history:changed', 'state:changed', 'ui:focus-search', 'ui:open-settings'];

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  list: (opts) => ipcRenderer.invoke('history:list', opts),
  copy: (id) => ipcRenderer.invoke('history:copy', id),
  remove: (id) => ipcRenderer.invoke('history:delete', id),
  pin: (id, pinned) => ipcRenderer.invoke('history:pin', id, pinned),
  clear: () => ipcRenderer.invoke('history:clear'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  regenerateCode: () => ipcRenderer.invoke('settings:regen-code'),
  addPeer: (address) => ipcRenderer.invoke('peer:add', address),
  removePeer: (address) => ipcRenderer.invoke('peer:remove', address),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  hide: () => ipcRenderer.invoke('app:hide'),
  on: (channel, callback) => {
    if (!EVENTS.includes(channel)) return () => {};
    const handler = (_e, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
