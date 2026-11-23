const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  setMode: (mode) => ipcRenderer.send('ui:mode', mode),
  reload: (which) => ipcRenderer.send('ui:reload', which),
  ready: () => ipcRenderer.send('ui:ready'),
  onState: (cb) => ipcRenderer.on('ui:state', (_e, state) => cb(state)),
});
