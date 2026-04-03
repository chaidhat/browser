import { contextBridge, ipcRenderer } from 'electron';

export interface ChatContentBlock {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
  file?: { url: string; mimeType: string };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ChatContentBlock[];
}

export interface EmailAccount {
  id: string;
  label: string;
  email: string;
  imap: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; password: string };
  smtp: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; password: string };
}

export interface Settings {
  openaiKey: string;
  anthropicKey: string;
  googleKey: string;
  braveKey: string;
  serperKey: string;
  emailAccounts: EmailAccount[];
  font: 'inter' | 'pt-serif';
  theme: 'light' | 'sunset' | 'dark' | 'system';
}

export interface SerperResult {
  title: string;
  link: string;
  snippet: string;
}

export interface SerperImageResult {
  title: string;
  imageUrl: string;
  link: string;
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, any>;
  result?: string;
  status: 'running' | 'done' | 'error';
}

export interface ChatStreamCallbacks {
  onChunk: (chunk: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onToolCall?: (info: ToolCallInfo) => void;
}

export interface DownloadStartedEvent {
  id: string;
  fileName: string;
  totalBytes: number;
  savePath: string;
}

export interface DownloadProgressEvent {
  id: string;
  receivedBytes: number;
  totalBytes: number;
}

export interface DownloadDoneEvent {
  id: string;
  state: 'completed' | 'cancelled' | 'interrupted';
  savePath: string;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  lastVisited: number;
}

export interface BrowserAPI {
  chatSendStream: (requestId: string, messages: ChatMessage[], callbacks: ChatStreamCallbacks) => () => void;
  chatAbortStream: (requestId: string) => void;
  chatGenerateTitle: (userMessage: string) => Promise<string | null>;
  chatSuggest: (messages: ChatMessage[], partialInput: string) => Promise<string | null>;
  autocompleteSuggest: (query: string) => Promise<string | null>;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<boolean>;
  setTheme: (theme: Settings['theme']) => Promise<boolean>;
  openSettings: () => Promise<boolean>;
  closeWindow: () => Promise<boolean>;
  onSettingsChanged: (callback: () => void) => void;
  loadTabs: () => Promise<unknown>;
  saveTabs: (data: unknown) => Promise<boolean>;
  loadHistory: () => Promise<HistoryEntry[]>;
  saveHistory: (data: HistoryEntry[]) => Promise<boolean>;
  onOpenUrl: (callback: (url: string) => void) => void;
  onDownloadStarted: (callback: (event: DownloadStartedEvent) => void) => void;
  onDownloadProgress: (callback: (event: DownloadProgressEvent) => void) => void;
  onDownloadDone: (callback: (event: DownloadDoneEvent) => void) => void;
  showInFolder: (filePath: string) => void;
  showContextMenu: (items: { label: string; id: string }[]) => Promise<string | null>;
  serperSearch: (query: string) => Promise<SerperResult[] | null>;
  serperImageSearch: (query: string) => Promise<SerperImageResult[] | null>;
  testImap: (account: EmailAccount) => Promise<{ success: boolean; messageCount?: number; sample?: { subject: string; from: string }[]; error?: string }>;
  clearSiteData: (origin: string) => Promise<boolean>;
  findInPage: (webContentsId: number, text: string, forward: boolean) => void;
  stopFindInPage: (webContentsId: number) => void;
  onFoundInPageResult: (callback: (activeMatch: number, totalMatches: number) => void) => void;
  onShortcutFromWebview: (callback: (key: string, alt: boolean) => void) => void;
}

contextBridge.exposeInMainWorld('browser', {
  chatSendStream: (requestId: string, messages: ChatMessage[], callbacks: ChatStreamCallbacks) => {
    const onChunk = (_event: unknown, id: string, chunk: string) => {
      if (id === requestId) callbacks.onChunk(chunk);
    };
    const onDone = (_event: unknown, id: string) => {
      if (id === requestId) {
        cleanup();
        callbacks.onDone();
      }
    };
    const onError = (_event: unknown, id: string, error: string) => {
      if (id === requestId) {
        cleanup();
        callbacks.onError(error);
      }
    };
    const onToolCall = (_event: unknown, id: string, info: ToolCallInfo) => {
      if (id === requestId) callbacks.onToolCall?.(info);
    };

    const cleanup = () => {
      ipcRenderer.removeListener('chat-stream-chunk', onChunk);
      ipcRenderer.removeListener('chat-stream-done', onDone);
      ipcRenderer.removeListener('chat-stream-error', onError);
      ipcRenderer.removeListener('chat-stream-tool-call', onToolCall);
    };

    ipcRenderer.on('chat-stream-chunk', onChunk);
    ipcRenderer.on('chat-stream-done', onDone);
    ipcRenderer.on('chat-stream-error', onError);
    ipcRenderer.on('chat-stream-tool-call', onToolCall);
    ipcRenderer.send('chat-send-stream', requestId, messages);

    return cleanup;
  },
  chatAbortStream: (requestId: string) => {
    ipcRenderer.send('chat-abort-stream', requestId);
  },
  chatGenerateTitle: (userMessage: string) => ipcRenderer.invoke('chat-generate-title', userMessage),
  chatSuggest: (messages: ChatMessage[], partialInput: string) => ipcRenderer.invoke('chat-suggest', messages, partialInput),
  autocompleteSuggest: (query: string) => ipcRenderer.invoke('autocomplete-suggest', query),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('save-settings', settings),
  setTheme: (theme: Settings['theme']) => ipcRenderer.invoke('set-theme', theme),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  onSettingsChanged: (callback: () => void) => {
    ipcRenderer.on('settings-changed', () => callback());
  },
  loadTabs: () => ipcRenderer.invoke('load-tabs'),
  saveTabs: (data: unknown) => ipcRenderer.invoke('save-tabs', data),
  loadHistory: () => ipcRenderer.invoke('load-history'),
  saveHistory: (data: HistoryEntry[]) => ipcRenderer.invoke('save-history', data),
  onOpenUrl: (callback: (url: string) => void) => {
    ipcRenderer.on('open-url-in-new-tab', (_event, url: string) => callback(url));
  },
  onDownloadStarted: (callback: (event: DownloadStartedEvent) => void) => {
    ipcRenderer.on('download-started', (_event, data: DownloadStartedEvent) => callback(data));
  },
  onDownloadProgress: (callback: (event: DownloadProgressEvent) => void) => {
    ipcRenderer.on('download-progress', (_event, data: DownloadProgressEvent) => callback(data));
  },
  onDownloadDone: (callback: (event: DownloadDoneEvent) => void) => {
    ipcRenderer.on('download-done', (_event, data: DownloadDoneEvent) => callback(data));
  },
  showInFolder: (filePath: string) => {
    ipcRenderer.send('show-in-folder', filePath);
  },
  showContextMenu: (items: { label: string; id: string }[]) => ipcRenderer.invoke('show-context-menu', items) as Promise<string | null>,
  serperSearch: (query: string) => ipcRenderer.invoke('serper-search', query),
  serperImageSearch: (query: string) => ipcRenderer.invoke('serper-image-search', query),
  testImap: (account: EmailAccount) => ipcRenderer.invoke('test-imap', account),
  clearSiteData: (origin: string) => ipcRenderer.invoke('clear-site-data', origin),
  findInPage: (webContentsId: number, text: string, forward: boolean) => {
    ipcRenderer.send('find-in-page', webContentsId, text, forward);
  },
  stopFindInPage: (webContentsId: number) => {
    ipcRenderer.send('stop-find-in-page', webContentsId);
  },
  onFoundInPageResult: (callback: (activeMatch: number, totalMatches: number) => void) => {
    ipcRenderer.on('found-in-page-result', (_event, activeMatch: number, totalMatches: number) => {
      callback(activeMatch, totalMatches);
    });
  },
  onShortcutFromWebview: (callback: (key: string, alt: boolean) => void) => {
    ipcRenderer.on('shortcut-from-webview', (_event, key: string, alt: boolean) => callback(key, alt));
  },
} satisfies BrowserAPI);
