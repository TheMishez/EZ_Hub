const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  choose: (deviceId) => ipcRenderer.send('picker:choose', deviceId),
  cancel: () => ipcRenderer.send('picker:cancel'),
  onList: (cb) => ipcRenderer.on('picker:list', (_e, data) => cb(data)),
});
