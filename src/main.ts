import { app, BrowserWindow, ipcMain, Menu, nativeTheme, dialog, shell, session } from 'electron';
import path from 'path';
import fs from 'fs';

app.name = 'Pause';
nativeTheme.themeSource = 'system';

if (app.isPackaged) {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
}

interface EmailAccount {
  id: string;
  label: string;
  email: string;
  imap: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; password: string };
  smtp: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; password: string };
}

interface Settings {
  openaiKey: string;
  anthropicKey: string;
  googleKey: string;
  braveKey: string;
  serperKey: string;
  emailAccounts: EmailAccount[];
}

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const tabsPath = path.join(app.getPath('userData'), 'tabs.json');
const historyPath = path.join(app.getPath('userData'), 'history.json');

function loadSettings(): Settings {
  try {
    const data = fs.readFileSync(settingsPath, 'utf-8');
    return { openaiKey: '', anthropicKey: '', googleKey: '', braveKey: '', serperKey: '', emailAccounts: [], ...JSON.parse(data) };
  } catch {
    return { openaiKey: '', anthropicKey: '', googleKey: '', braveKey: '', serperKey: '', emailAccounts: [] };
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

  // Intercept Cmd+T and Cmd+F from the main window itself (e.g., when focus is in a text input)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.meta && (input.key === 't' || input.key === 'f') && input.type === 'keyDown') {
      event.preventDefault();
      mainWindow?.webContents.send('shortcut-from-webview', input.key);
    }
  });

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

    // Intercept Cmd+T and Cmd+F from webview so the app always handles them
    webContents.on('before-input-event', (event, input) => {
      if (input.meta && (input.key === 't' || input.key === 'f') && input.type === 'keyDown') {
        event.preventDefault();
        mainWindow?.webContents.send('shortcut-from-webview', input.key);
      }
    });

  });

  // Handle downloads — register once on the default session to avoid listener leaks
  session.defaultSession.on('will-download', (_dlEvent, item) => {
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

ipcMain.handle('clear-site-data', async (_event, origin: string) => {
  const ses = session.defaultSession;
  await ses.clearStorageData({ origin, storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'] });
  await ses.clearCache();
  return true;
});

// Test IMAP connection
ipcMain.handle('test-imap', async (_event, account: EmailAccount) => {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.security === 'tls',
    auth: {
      user: account.imap.username,
      pass: account.imap.password,
    },
    logger: false,
    tls: account.imap.security === 'starttls' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const messageCount = client.mailbox?.exists || 0;
      const sample: { subject: string; from: string }[] = [];
      if (messageCount > 0) {
        const startSeq = Math.max(1, messageCount - 4);
        for await (const msg of client.fetch(`${startSeq}:*`, { envelope: true })) {
          sample.push({
            subject: msg.envelope.subject || '(no subject)',
            from: msg.envelope.from?.[0]?.address || 'unknown',
          });
        }
      }
      return { success: true, messageCount, sample };
    } finally {
      lock.release();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
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

// History persistence IPC
ipcMain.handle('load-history', () => {
  try {
    const data = fs.readFileSync(historyPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
});

ipcMain.handle('save-history', (_event, data: unknown) => {
  fs.writeFileSync(historyPath, JSON.stringify(data));
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

// Serper Image Search IPC
ipcMain.handle('serper-image-search', async (_event, query: string) => {
  const settings = loadSettings();
  if (!settings.serperKey) return null;
  try {
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': settings.serperKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.images || []).slice(0, 8).map((r: any) => ({
      title: r.title,
      imageUrl: r.imageUrl,
      link: r.link,
    }));
  } catch {
    return null;
  }
});

// OpenAI Chat IPC (using Vercel AI SDK)
import { streamText, generateText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

interface ChatContentBlock {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
  file?: { url: string; mimeType: string };
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ChatContentBlock[];
}

function toSdkMessages(messages: ChatMessage[]) {
  return messages.map(m => {
    if (Array.isArray(m.content)) {
      const parts = m.content.map(block => {
        if (block.type === 'file' && block.file) {
          const url = block.file.url;
          const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/s);
          if (dataMatch) {
            return { type: 'file' as const, data: dataMatch[2], mediaType: dataMatch[1] };
          }
          if (url.startsWith('data:')) {
            const commaIdx = url.indexOf(',');
            if (commaIdx !== -1) {
              return { type: 'file' as const, data: url.substring(commaIdx + 1), mediaType: block.file.mimeType };
            }
          }
          return { type: 'file' as const, data: new URL(url), mediaType: block.file.mimeType };
        }
        if (block.type === 'image_url' && block.image_url) {
          const url = block.image_url.url;
          // data: URIs need base64 extracted — SDK rejects data: scheme as URL
          const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/s);
          if (dataMatch) {
            return { type: 'image' as const, image: dataMatch[2], mediaType: dataMatch[1] };
          }
          // If it's still a data: URI that didn't match, try extracting after the comma
          if (url.startsWith('data:')) {
            const commaIdx = url.indexOf(',');
            if (commaIdx !== -1) {
              const mimeMatch = url.match(/^data:([^;,]+)/);
              return { type: 'image' as const, image: url.substring(commaIdx + 1), mediaType: mimeMatch?.[1] || 'image/png' };
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

function getModelForId(settings: Settings, modelId: string, hasFiles = false) {
  switch (modelId) {
    case 'claude-opus-4-6': {
      if (!settings.anthropicKey) return { error: 'No Anthropic API key configured. Open Settings to add one.' };
      const anthropic = createAnthropic({ apiKey: settings.anthropicKey });
      return { model: anthropic('claude-opus-4-6') };
    }
    case 'gemini-3.1-pro': {
      if (!settings.googleKey) return { error: 'No Google API key configured. Open Settings to add one.' };
      const google = createGoogleGenerativeAI({
        apiKey: settings.googleKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1alpha',
      });
      return { model: google('gemini-3.1-pro-preview') };
    }
    case 'gpt-5.4':
    default: {
      if (!settings.openaiKey) return { error: 'No OpenAI API key configured. Open Settings to add one.' };
      const openai = createOpenAI({ apiKey: settings.openaiKey });
      // Responses API doesn't support file uploads — fall back to Chat Completions
      if (hasFiles) {
        return { model: openai.chat('gpt-5.4'), isOpenAI: true, isChatCompletions: true };
      }
      return { model: openai.responses('gpt-5.4'), isOpenAI: true };
    }
  }
}

const activeAbortControllers = new Map<string, AbortController>();

ipcMain.on('chat-abort-stream', (_event, requestId: string) => {
  const controller = activeAbortControllers.get(requestId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(requestId);
  }
});

ipcMain.on('chat-send-stream', async (event, requestId: string, messages: ChatMessage[], modelId?: string) => {
  const settings = loadSettings();
  const hasFiles = messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'file'));
  const resolved = getModelForId(settings, modelId || 'gpt-5.4', hasFiles);
  if ('error' in resolved) {
    event.sender.send('chat-stream-error', requestId, resolved.error);
    return;
  }

  const abortController = new AbortController();
  activeAbortControllers.set(requestId, abortController);

  try {
    const tools = buildTools(settings);
    const isChatCompletions = 'isChatCompletions' in resolved && resolved.isChatCompletions;
    const result = streamText({
      model: resolved.model,
      messages: toSdkMessages(messages) as any,
      ...(!isChatCompletions ? { tools, stopWhen: stepCountIs(5) } : {}),
      abortSignal: abortController.signal,
      ...(resolved.isOpenAI && !isChatCompletions ? {
        providerOptions: {
          openai: {
            reasoningEffort: 'high',
          } satisfies OpenAILanguageModelResponsesOptions,
        },
      } : {}),
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

    activeAbortControllers.delete(requestId);
    event.sender.send('chat-stream-done', requestId);
  } catch (err: unknown) {
    activeAbortControllers.delete(requestId);
    if (abortController.signal.aborted) {
      event.sender.send('chat-stream-done', requestId);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    event.sender.send('chat-stream-error', requestId, `Request failed: ${message}`);
  }
});

// Generate inline suggestion using a lightweight model
ipcMain.handle('chat-suggest', async (_event, messages: ChatMessage[], partialInput: string) => {
  const settings = loadSettings();

  // Pick a lightweight model: OpenAI nano > Anthropic haiku > Google spark
  let suggestModel;
  if (settings.openaiKey) {
    const openai = createOpenAI({ apiKey: settings.openaiKey });
    suggestModel = openai.chat('gpt-5.4-nano');
  } else if (settings.anthropicKey) {
    const anthropic = createAnthropic({ apiKey: settings.anthropicKey });
    suggestModel = anthropic('claude-haiku-4-5-20251001');
  } else if (settings.googleKey) {
    const google = createGoogleGenerativeAI({ apiKey: settings.googleKey });
    suggestModel = google('gemini-2.0-flash-lite');
  } else {
    return null;
  }

  try {
    const contextMessages = messages.slice(-10).map(m => {
      const content = Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : m.content;
      return `${m.role}: ${content}`;
    }).join('\n');

    const isEmpty = !partialInput;

    if (isEmpty) {
      const system = `You are an autocomplete engine inside a chat input. Suggest a short, natural question or message the user might want to type next based on the conversation context. Output ONLY the suggested text. Keep it short (under 15 words). If there's no conversation yet, suggest an interesting question.`;
      const prompt = contextMessages
        ? `Conversation so far:\n${contextMessages}\n\nSuggest what the user might type next:`
        : 'Suggest an interesting question the user might ask:';
      const result = await generateText({
        model: suggestModel,
        system,
        prompt,
        maxOutputTokens: 60,
      });
      return result.text?.trim() || null;
    }

    // For partial input: ask the model to complete the full message, then strip the prefix
    const system = `You are an autocomplete engine. The user is typing a message. Complete their message naturally. Output ONLY the full completed message (including what they already typed). Keep it short (under 20 words total). If you can't predict anything useful, repeat back exactly what they typed.`;
    const prompt = contextMessages
      ? `Conversation so far:\n${contextMessages}\n\nComplete this message: "${partialInput}"`
      : `Complete this message: "${partialInput}"`;

    const result = await generateText({
      model: suggestModel,
      system,
      prompt,
      maxOutputTokens: 60,
    });
    let full = result.text?.trim() || null;
    if (!full) return null;
    // Strip quotes if the model wrapped it
    if (full.startsWith('"') && full.endsWith('"')) full = full.slice(1, -1);
    // Find where the user's input appears and extract the continuation
    const lowerFull = full.toLowerCase();
    const lowerInput = partialInput.toLowerCase();
    const idx = lowerFull.indexOf(lowerInput);
    if (idx !== -1) {
      const continuation = full.substring(idx + partialInput.length);
      return continuation || null;
    }
    // Fallback: if model didn't include the prefix, add a space
    if (!full.startsWith(' ')) full = ' ' + full;
    return full;
  } catch {
    return null;
  }
});

// Google Autocomplete suggestions (no API key needed)
ipcMain.handle('autocomplete-suggest', async (_event, query: string) => {
  if (!query) return null;
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const suggestions: string[] = data[1];
    if (!suggestions || suggestions.length === 0) return null;
    // Find the first suggestion that starts with what the user typed
    const lowerQuery = query.toLowerCase();
    for (const s of suggestions) {
      if (s.toLowerCase().startsWith(lowerQuery) && s.length > query.length) {
        return s.substring(query.length);
      }
    }
    return null;
  } catch {
    return null;
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
