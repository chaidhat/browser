import { contextBridge, ipcRenderer } from 'electron';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  reply?: string;
  error?: string;
}

export interface Settings {
  openaiKey: string;
}

export interface BrowserAPI {
  chatSend: (messages: ChatMessage[]) => Promise<ChatResponse>;
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<boolean>;
  onOpenUrl: (callback: (url: string) => void) => void;
}

contextBridge.exposeInMainWorld('browser', {
  chatSend: (messages: ChatMessage[]) => ipcRenderer.invoke('chat-send', messages),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('save-settings', settings),
  onOpenUrl: (callback: (url: string) => void) => {
    ipcRenderer.on('open-url-in-new-tab', (_event, url: string) => callback(url));
  },
} satisfies BrowserAPI);
