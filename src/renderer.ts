import type { BrowserAPI, ChatMessage } from './preload';

declare global {
  interface Window {
    browser: BrowserAPI;
  }
}

// --- Elements ---
const urlBar = document.getElementById('url-bar') as HTMLInputElement;
const backBtn = document.getElementById('back-btn') as HTMLButtonElement;
const forwardBtn = document.getElementById('forward-btn') as HTMLButtonElement;
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
const chatToggleBtn = document.getElementById('chat-toggle-btn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;

const webview = document.getElementById('webview') as Electron.WebviewTag;
const chatSidebar = document.getElementById('chat-sidebar') as HTMLDivElement;
const chatMessages = document.getElementById('chat-messages') as HTMLDivElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatSendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;

const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const settingsOverlay = document.getElementById('settings-overlay') as HTMLDivElement;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement;
const cancelSettingsBtn = document.getElementById('cancel-settings-btn') as HTMLButtonElement;

// --- Navigation (direct webview control) ---
function navigate(input: string): void {
  let url = input;
  if (!/^https?:\/\//i.test(url)) {
    if (/^[a-z0-9]+([-.])[a-z0-9]+.*\.[a-z]{2,}(\/.*)?$/i.test(url)) {
      url = 'https://' + url;
    } else {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
  }
  webview.loadURL(url);
}

urlBar.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    const value = urlBar.value.trim();
    if (value) {
      navigate(value);
      urlBar.blur();
    }
  }
});

urlBar.addEventListener('focus', () => urlBar.select());
backBtn.addEventListener('click', () => webview.goBack());
forwardBtn.addEventListener('click', () => webview.goForward());
reloadBtn.addEventListener('click', () => webview.reload());

webview.addEventListener('did-navigate', (e: any) => { urlBar.value = e.url; });
webview.addEventListener('did-navigate-in-page', (e: any) => { urlBar.value = e.url; });
webview.addEventListener('page-title-updated', (e: any) => { document.title = e.title; });
webview.addEventListener('did-start-loading', () => { urlBar.classList.add('loading'); });
webview.addEventListener('did-stop-loading', () => { urlBar.classList.remove('loading'); });

// Handle new-window events (e.g. target="_blank" links)
webview.addEventListener('new-window', (e: any) => {
  e.preventDefault();
  webview.loadURL(e.url);
});

// --- Chat sidebar toggle ---
let sidebarOpen = false;

chatToggleBtn.addEventListener('click', () => {
  sidebarOpen = !sidebarOpen;
  chatSidebar.classList.toggle('open', sidebarOpen);
  chatToggleBtn.classList.toggle('active', sidebarOpen);
  if (sidebarOpen) {
    chatInput.focus();
  }
});

// --- Chat ---
const chatHistory: ChatMessage[] = [];

function appendMessage(role: 'user' | 'assistant', content: string): void {
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg chat-msg-${role}`;
  msgDiv.textContent = content;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChat(): Promise<void> {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  appendMessage('user', text);
  chatHistory.push({ role: 'user', content: text });

  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-msg chat-msg-assistant chat-typing';
  typingDiv.textContent = 'Thinking...';
  chatMessages.appendChild(typingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  const result = await window.browser.chatSend(chatHistory);
  typingDiv.remove();

  if (result.error) {
    const errDiv = document.createElement('div');
    errDiv.className = 'chat-msg chat-msg-error';
    errDiv.textContent = result.error;
    chatMessages.appendChild(errDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (result.reply) {
    chatHistory.push({ role: 'assistant', content: result.reply });
    appendMessage('assistant', result.reply);
  }
}

chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

// --- Settings modal ---
function openSettings(): void {
  webview.style.visibility = 'hidden';
  settingsModal.classList.add('open');
  settingsOverlay.classList.add('open');
}

function closeSettings(): void {
  webview.style.visibility = '';
  settingsModal.classList.remove('open');
  settingsOverlay.classList.remove('open');
}

settingsBtn.addEventListener('click', async () => {
  const settings = await window.browser.getSettings();
  apiKeyInput.value = settings.openaiKey;
  openSettings();
});

cancelSettingsBtn.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

saveSettingsBtn.addEventListener('click', async () => {
  await window.browser.saveSettings({ openaiKey: apiKeyInput.value.trim() });
  closeSettings();
});
