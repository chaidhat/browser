import { app, BrowserWindow, ipcMain, Menu, nativeTheme, dialog, shell, session } from 'electron';
import path from 'path';
import fs from 'fs';

app.name = 'Pause';
nativeTheme.themeSource = 'system';

app.setAsDefaultProtocolClient('http');
app.setAsDefaultProtocolClient('https');

interface Settings {
  openaiKey: string;
  braveKey: string;
  serperKey: string;
}

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const tabsPath = path.join(app.getPath('userData'), 'tabs.json');

function loadSettings(): Settings {
  try {
    const data = fs.readFileSync(settingsPath, 'utf-8');
    return { openaiKey: '', braveKey: '', serperKey: '', ...JSON.parse(data) };
  } catch {
    return { openaiKey: '', braveKey: '', serperKey: '' };
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
    transparent: true,
    vibrancy: 'sidebar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  // Allow all permission requests from webviews (camera, mic, notifications, WebAuthn/passkeys, etc.)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => {
    return true;
  });

  // Track webview webContents by ID for find-in-page
  const webviewContentsMap = new Map<number, Electron.WebContents>();

  // Handle new windows opened by webview guests (target="_blank" links, window.open)
  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    const id = webContents.id;
    webviewContentsMap.set(id, webContents);
    webContents.on('destroyed', () => {
      webviewContentsMap.delete(id);
    });
    webContents.setWindowOpenHandler(({ url, disposition }) => {
      // Allow popups for OAuth/login flows (disposition is 'new-window' for window.open)
      if (disposition === 'new-window') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 500,
            height: 700,
            autoHideMenuBar: true,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
            },
          },
        };
      }
      // Open regular links (target="_blank" etc.) in a new tab
      mainWindow?.webContents.send('open-url-in-new-tab', url);
      return { action: 'deny' };
    });

    // Enable pinch-to-zoom on webview content
    webContents.setVisualZoomLevelLimits(1, 5);

    // Handle downloads from webviews
    webContents.session.on('will-download', (_dlEvent, item) => {
      const fileName = item.getFilename();
      const totalBytes = item.getTotalBytes();
      const downloadId = Date.now().toString();
      const savePath = path.join(app.getPath('downloads'), fileName);
      item.setSavePath(savePath);

      mainWindow?.webContents.send('download-started', {
        id: downloadId,
        fileName,
        totalBytes,
        savePath,
      });

      item.on('updated', (_updEvent, state) => {
        if (state === 'progressing') {
          mainWindow?.webContents.send('download-progress', {
            id: downloadId,
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes(),
          });
        }
      });

      item.once('done', (_doneEvent, state) => {
        mainWindow?.webContents.send('download-done', {
          id: downloadId,
          state, // 'completed', 'cancelled', 'interrupted'
          savePath: item.getSavePath(),
        });
      });
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

// Tabs persistence IPC
ipcMain.handle('load-tabs', () => {
  try {
    const data = fs.readFileSync(tabsPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
});

ipcMain.handle('save-tabs', (_event, data: unknown) => {
  fs.writeFileSync(tabsPath, JSON.stringify(data));
  return true;
});

// Show downloaded file in Finder
ipcMain.on('show-in-folder', (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// Find in page - route through main process for reliability
ipcMain.on('find-in-page', (event, webContentsId: number, text: string, forward: boolean) => {
  const wc = mainWindow?.webContents;
  if (!wc) return;
  // Find the webview's webContents from all attached webviews
  const allWebContents = require('electron').webContents.getAllWebContents();
  const target = allWebContents.find((c: Electron.WebContents) => c.id === webContentsId);
  if (target) {
    target.findInPage(text, { forward, findNext: true });
    // Listen for result and forward to renderer
    target.once('found-in-page', (_e: Electron.Event, result: Electron.FoundInPageResult) => {
      event.sender.send('found-in-page-result', result.activeMatchOrdinal, result.matches);
    });
  }
});

ipcMain.on('stop-find-in-page', (_event, webContentsId: number) => {
  const allWebContents = require('electron').webContents.getAllWebContents();
  const target = allWebContents.find((c: Electron.WebContents) => c.id === webContentsId);
  if (target) {
    target.stopFindInPage('clearSelection');
  }
});

// Serper Search IPC
ipcMain.handle('serper-search', async (_event, query: string) => {
  const settings = loadSettings();
  if (!settings.serperKey) return null;
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': settings.serperKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data.organic || []).slice(0, 5).map((r: any) => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet,
    }));
    return results;
  } catch {
    return null;
  }
});

// OpenAI Chat IPC (using Vercel AI SDK)
import { streamText, generateText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai';
import { z } from 'zod';

interface ChatContentBlock {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ChatContentBlock[];
}

function toSdkMessages(messages: ChatMessage[]) {
  return messages.map(m => {
    if (Array.isArray(m.content)) {
      const parts = m.content.map(block => {
        if (block.type === 'image_url' && block.image_url) {
          const url = block.image_url.url;
          // data: URIs need base64 extracted — SDK rejects data: scheme as URL
          const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/s);
          if (dataMatch) {
            return { type: 'image' as const, image: dataMatch[2], mimeType: dataMatch[1] };
          }
          // If it's still a data: URI that didn't match, try extracting after the comma
          if (url.startsWith('data:')) {
            const commaIdx = url.indexOf(',');
            if (commaIdx !== -1) {
              const mimeMatch = url.match(/^data:([^;,]+)/);
              return { type: 'image' as const, image: url.substring(commaIdx + 1), mimeType: mimeMatch?.[1] || 'image/png' };
            }
          }
          return { type: 'image' as const, image: new URL(url) };
        }
        return { type: 'text' as const, text: block.text || '' };
      });
      return { role: m.role as 'user' | 'assistant' | 'system', content: parts };
    }
    return { role: m.role as 'user' | 'assistant' | 'system', content: m.content };
  });
}

function buildTools(settings: Settings) {
  const tools: Record<string, any> = {};

  if (settings.braveKey) {
    tools.webSearch = tool({
      description: 'Search the web for current information using Brave Search. Use this when you need up-to-date information, facts, or anything you are unsure about.',
      inputSchema: z.object({
        query: z.string().describe('The search query'),
      }),
      execute: async ({ query }) => {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
        const res = await fetch(url, {
          headers: { 'X-Subscription-Token': settings.braveKey, 'Accept': 'application/json' },
        });
        if (!res.ok) {
          return { error: `Brave Search failed: ${res.status} ${res.statusText}` };
        }
        const data = await res.json();
        const results = (data.web?.results || []).slice(0, 5).map((r: any) => ({
          title: r.title,
          url: r.url,
          description: r.description,
        }));
        return { results };
      },
    });
  }

  return tools;
}

ipcMain.on('chat-send-stream', async (event, requestId: string, messages: ChatMessage[]) => {
  const settings = loadSettings();
  if (!settings.openaiKey) {
    event.sender.send('chat-stream-error', requestId, 'No OpenAI API key configured. Open Settings to add one.');
    return;
  }

  try {
    const openai = createOpenAI({ apiKey: settings.openaiKey });
    const tools = buildTools(settings);
    const result = streamText({
      model: openai.responses('gpt-5.4'),
      messages: toSdkMessages(messages) as any,
      tools,
      stopWhen: stepCountIs(5),
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
        } satisfies OpenAILanguageModelResponsesOptions,
      },
      onError({ error }) {
        const message = error instanceof Error ? error.message : String(error);
        event.sender.send('chat-stream-error', requestId, `Stream error: ${message}`);
      },
    });

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        event.sender.send('chat-stream-chunk', requestId, part.text);
      }
    }

    event.sender.send('chat-stream-done', requestId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    event.sender.send('chat-stream-error', requestId, `Request failed: ${message}`);
  }
});

// Generate chat title using a lightweight model
ipcMain.handle('chat-generate-title', async (_event, userMessage: string) => {
  const apiKey = loadSettings().openaiKey;
  if (!apiKey) return null;

  try {
    const openai = createOpenAI({ apiKey });
    const result = await generateText({
      model: openai.chat('gpt-5.4-nano'),
      system: 'Generate a very short title (max 5 words) for a chat that starts with the following message. Reply with only the title, no quotes or punctuation.',
      prompt: userMessage,
      maxOutputTokens: 20,
    });
    return result.text?.trim() || null;
  } catch (err) {
    console.error('Title generation error:', err);
    return null;
  }
});

app.whenReady().then(() => {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Pause',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Handle URLs opened when app is set as default browser
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('open-url-in-new-tab', url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
