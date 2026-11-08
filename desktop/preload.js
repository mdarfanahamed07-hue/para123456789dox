'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paradoxCC', Object.freeze({
  version: () => ipcRenderer.invoke('app:version'),
  connectionInfo: () => ipcRenderer.invoke('connection:info'),
  connect: data => ipcRenderer.invoke('connection:connect', data),
  disconnect: () => ipcRenderer.invoke('connection:disconnect'),
  restoreConnection: () => ipcRenderer.invoke('connection:restore'),
  ping: () => ipcRenderer.invoke('connection:ping'),
  openAdmin: () => ipcRenderer.invoke('site:open-admin'),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  pluginAction: (action, slug) => ipcRenderer.invoke('plugins:action', action, slug),
  installPlugin: () => ipcRenderer.invoke('plugins:install'),
  listThemes: () => ipcRenderer.invoke('themes:list'),
  themeAction: (action, slug) => ipcRenderer.invoke('themes:action', action, slug),
  installTheme: () => ipcRenderer.invoke('themes:install'),
  listActivity: () => ipcRenderer.invoke('activity:list')
}));
