const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browser', {
  navigate: (url) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload'),
  onUrlChanged: (callback) => ipcRenderer.on('url-changed', (_, url) => callback(url)),
  onTitleChanged: (callback) => ipcRenderer.on('title-changed', (_, title) => callback(title)),
  onLoading: (callback) => ipcRenderer.on('loading', (_, loading) => callback(loading)),
});
