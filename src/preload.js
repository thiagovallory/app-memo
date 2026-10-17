const { contextBridge, ipcRenderer, webFrame } = require('electron');

webFrame.setVisualZoomLevelLimits(1, 1);

contextBridge.exposeInMainWorld('memo', {
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  chooseFolder: () => ipcRenderer.invoke('library:choose'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen', (_e, on) => cb(on)),
  fileUrl: (id) => `memo://app/file/${id}`,
  thumbUrl: (id) => `memo://app/thumb/${id}`,
});
