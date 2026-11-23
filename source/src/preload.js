'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nb', {
  saveCleaningFile: (sourcePath, suggestedName) =>
    ipcRenderer.invoke('cleaning:save-as', { sourcePath, suggestedName }),
  openCleaningFile: (target) => ipcRenderer.invoke('cleaning:open', target)
});
