import { contextBridge, ipcRenderer } from 'electron';

export interface ChatContentBlock {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ChatContentBlock[];
}

export interface Settings {
  openaiKey: string;
  braveKey: string;
  serperKey: string;
}

export interface SerperResult {
  title: string;
  link: string;
  snippet: string;
}

export interface ChatStreamCallbacks {
  onChunk: (chunk: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
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

export interface BrowserAPI {
  chatSendStream: (requestId: string, messages: ChatMessage[], callbacks: ChatStreamCallbacks) => () => void;
  chatGenerateTitle: (userMessage: string) => Promise<string | null>;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<boolean>;
  loadTabs: () => Promise<unknown>;
  saveTabs: (data: unknown) => Promise<boolean>;
  onOpenUrl: (callback: (url: string) => void) => void;
  onDownloadStarted: (callback: (event: DownloadStartedEvent) => void) => void;
  onDownloadProgress: (callback: (event: DownloadProgressEvent) => void) => void;
  onDownloadDone: (callback: (event: DownloadDoneEvent) => void) => void;
  showInFolder: (filePath: string) => void;
  serperSearch: (query: string) => Promise<SerperResult[] | null>;
  findInPage: (webContentsId: number, text: string, forward: boolean) => void;
  stopFindInPage: (webContentsId: number) => void;
  onFoundInPageResult: (callback: (activeMatch: number, totalMatches: number) => void) => void;
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

    const cleanup = () => {
      ipcRenderer.removeListener('chat-stream-chunk', onChunk);
      ipcRenderer.removeListener('chat-stream-done', onDone);
      ipcRenderer.removeListener('chat-stream-error', onError);
    };

    ipcRenderer.on('chat-stream-chunk', onChunk);
    ipcRenderer.on('chat-stream-done', onDone);
    ipcRenderer.on('chat-stream-error', onError);
    ipcRenderer.send('chat-send-stream', requestId, messages);

    return cleanup;
  },
  chatGenerateTitle: (userMessage: string) => ipcRenderer.invoke('chat-generate-title', userMessage),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('save-settings', settings),
  loadTabs: () => ipcRenderer.invoke('load-tabs'),
  saveTabs: (data: unknown) => ipcRenderer.invoke('save-tabs', data),
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
  serperSearch: (query: string) => ipcRenderer.invoke('serper-search', query),
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
} satisfies BrowserAPI);
