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
}

contextBridge.exposeInMainWorld('browser', {
  chatSend: (messages: ChatMessage[]) => ipcRenderer.invoke('chat-send', messages),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('save-settings', settings),
} satisfies BrowserAPI);
