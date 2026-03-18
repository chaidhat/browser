const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('ui/index.html');

  // Create the browser view for web content
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.setBrowserView(view);
  layoutBrowserView();
  view.webContents.loadURL('https://www.google.com');

  // Update URL bar when navigation happens
  view.webContents.on('did-navigate', (event, url) => {
    mainWindow.webContents.send('url-changed', url);
  });
  view.webContents.on('did-navigate-in-page', (event, url) => {
    mainWindow.webContents.send('url-changed', url);
  });

  // Update title
  view.webContents.on('page-title-updated', (event, title) => {
    mainWindow.webContents.send('title-changed', title);
    mainWindow.setTitle(title);
  });

  // Loading state
  view.webContents.on('did-start-loading', () => {
    mainWindow.webContents.send('loading', true);
  });
  view.webContents.on('did-stop-loading', () => {
    mainWindow.webContents.send('loading', false);
  });

  // Handle window resize
  mainWindow.on('resize', layoutBrowserView);

  // Handle new window requests (open in same view)
  view.webContents.setWindowOpenHandler(({ url }) => {
    view.webContents.loadURL(url);
    return { action: 'deny' };
  });
}

function layoutBrowserView() {
  const view = mainWindow.getBrowserView();
  if (!view) return;
  const bounds = mainWindow.getContentBounds();
  const toolbarHeight = 48;
  view.setBounds({
    x: 0,
    y: toolbarHeight,
    width: bounds.width,
    height: bounds.height - toolbarHeight,
  });
  view.setAutoResize({ width: true, height: true });
}

// IPC handlers
ipcMain.on('navigate', (event, url) => {
  const view = mainWindow.getBrowserView();
  if (!view) return;

  let finalUrl = url;
  if (!/^https?:\/\//i.test(url)) {
    // If it looks like a domain, add https
    if (/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}(\/.*)?$/i.test(url)) {
      finalUrl = 'https://' + url;
    } else {
      // Treat as search query
      finalUrl = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
  }
  view.webContents.loadURL(finalUrl);
});

ipcMain.on('go-back', () => {
  const view = mainWindow.getBrowserView();
  if (view && view.webContents.canGoBack()) view.webContents.goBack();
});

ipcMain.on('go-forward', () => {
  const view = mainWindow.getBrowserView();
  if (view && view.webContents.canGoForward()) view.webContents.goForward();
});

ipcMain.on('reload', () => {
  const view = mainWindow.getBrowserView();
  if (view) view.webContents.reload();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
