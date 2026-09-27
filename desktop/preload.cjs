const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  onOpenFile(callback) {
    const listener = (_event, file) => callback(file);
    ipcRenderer.on('open-music-file', listener);
    ipcRenderer.send('music-renderer-ready');
    return () => ipcRenderer.removeListener('open-music-file', listener);
  },
});
