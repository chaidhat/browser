import { app, BrowserWindow, ipcMain, net } from 'electron';
import path from 'path';
import fs from 'fs';

interface Settings {
  openaiKey: string;
}

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings(): Settings {
  try {
    const data = fs.readFileSync(settingsPath, 'utf-8');
    return { openaiKey: '', ...JSON.parse(data) };
  } catch {
    return { openaiKey: '' };
  }
}

function saveSettings(settings: Settings): void {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  // Handle new windows opened by webview guests (target="_blank" links, window.open)
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => {
      mainWindow?.webContents.send('open-url-in-new-tab', url);
      return { action: 'deny' };
    });
  });
}

// Navigation IPC — forward to webview via renderer
ipcMain.on('webview-navigate', (_event, url: string) => {
  // handled in renderer directly
});

// Settings IPC
ipcMain.handle('get-settings', () => {
  return loadSettings();
});

ipcMain.handle('save-settings', (_event, settings: Settings) => {
  saveSettings(settings);
  return true;
});

// OpenAI Chat IPC
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

ipcMain.handle('chat-send', async (_event, messages: ChatMessage[]) => {
  const apiKey = loadSettings().openaiKey;
  if (!apiKey) {
    return { error: 'No OpenAI API key configured. Open Settings to add one.' };
  }

  try {
    const body = JSON.stringify({
      model: 'gpt-5.4',
      messages,
    });

    const response = await net.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      return { error: `OpenAI API error (${response.status}): ${errText}` };
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content ?? '';
    return { reply };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Request failed: ${message}` };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
