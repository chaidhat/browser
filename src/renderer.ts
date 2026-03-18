import type { BrowserAPI, ChatMessage } from './preload';
import { marked } from 'marked';
import katex from 'katex';

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

const webviewContainer = document.getElementById('webview-container') as HTMLDivElement;
const tabsContainer = document.getElementById('tabs') as HTMLDivElement;
const newTabBtn = document.getElementById('new-tab-btn') as HTMLButtonElement;
const tabSidebar = document.getElementById('tab-sidebar') as HTMLDivElement;

const chatSidebar = document.getElementById('chat-sidebar') as HTMLDivElement;
const chatMessages = document.getElementById('chat-messages') as HTMLDivElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatSendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;

const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const settingsOverlay = document.getElementById('settings-overlay') as HTMLDivElement;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement;
const cancelSettingsBtn = document.getElementById('cancel-settings-btn') as HTMLButtonElement;

// --- Tab Management ---
interface Tab {
  id: number;
  webview: Electron.WebviewTag;
  tabEl: HTMLDivElement;
  title: string;
  url: string;
}

let tabs: Tab[] = [];
let activeTabId: number = -1;
let nextTabId = 0;

function createTab(url: string = 'https://www.google.com'): Tab {
  const id = nextTabId++;

  // Create webview
  const webview = document.createElement('webview') as Electron.WebviewTag;
  webview.src = url;
  webview.setAttribute('autosize', 'on');
  webview.className = 'tab-webview';
  webview.style.display = 'none';
  webviewContainer.appendChild(webview);

  // Create tab element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = `
    <span class="tab-title">New Tab</span>
    <button class="tab-close" title="Close tab">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  `;
  tabsContainer.appendChild(tabEl);

  const tab: Tab = { id, webview, tabEl, title: 'New Tab', url };
  tabs.push(tab);

  // Tab click to switch
  tabEl.addEventListener('mousedown', (e) => {
    if (!(e.target as HTMLElement).closest('.tab-close')) {
      switchToTab(id);
    }
  });

  // Close button
  const closeBtn = tabEl.querySelector('.tab-close') as HTMLButtonElement;
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(id);
  });

  // Webview events
  webview.addEventListener('did-navigate', (e: any) => {
    tab.url = e.url;
    if (activeTabId === id) urlBar.value = e.url;
  });
  webview.addEventListener('did-navigate-in-page', (e: any) => {
    tab.url = e.url;
    if (activeTabId === id) urlBar.value = e.url;
  });
  webview.addEventListener('page-title-updated', (e: any) => {
    tab.title = e.title;
    const titleEl = tabEl.querySelector('.tab-title') as HTMLSpanElement;
    titleEl.textContent = e.title;
    if (activeTabId === id) document.title = e.title;
  });
  webview.addEventListener('did-start-loading', () => {
    if (activeTabId === id) urlBar.classList.add('loading');
  });
  webview.addEventListener('did-stop-loading', () => {
    if (activeTabId === id) urlBar.classList.remove('loading');
  });
  switchToTab(id);
  return tab;
}

function switchToTab(id: number): void {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  activeTabId = id;

  // Update webview visibility
  tabs.forEach(t => {
    t.webview.style.display = t.id === id ? 'flex' : 'none';
    t.tabEl.classList.toggle('active', t.id === id);
  });

  // Update URL bar and title
  urlBar.value = tab.url;
  document.title = tab.title;
  urlBar.classList.remove('loading');
}

function closeTab(id: number): void {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];

  // If it's the last tab, create a new one first
  if (tabs.length === 1) {
    createTab();
  }

  // If closing active tab, switch to adjacent
  if (activeTabId === id) {
    const newIdx = idx === tabs.length - 1 ? idx - 1 : idx + 1;
    const newTab = tabs[newIdx];
    if (newTab && newTab.id !== id) {
      switchToTab(newTab.id);
    }
  }

  // Remove
  tab.webview.remove();
  tab.tabEl.remove();
  tabs.splice(idx, 1);
}

// --- Navigation ---
function navigate(input: string): void {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  let url = input;
  if (!/^https?:\/\//i.test(url)) {
    if (/^[a-z0-9]+([-.])[a-z0-9]+.*\.[a-z]{2,}(\/.*)?$/i.test(url)) {
      url = 'https://' + url;
    } else {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
  }
  tab.webview.loadURL(url);
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
backBtn.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.webview.goBack();
});
forwardBtn.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.webview.goForward();
});
reloadBtn.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.webview.reload();
});

newTabBtn.addEventListener('click', () => createTab());

// Keyboard shortcuts for tabs
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.metaKey && e.key === 't') {
    e.preventDefault();
    createTab();
  } else if (e.metaKey && e.key === 'w') {
    e.preventDefault();
    if (activeTabId !== -1) closeTab(activeTabId);
  }
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

marked.setOptions({ breaks: true });

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex.trim(), { displayMode, throwOnError: false });
  } catch {
    return `<span class="math-error">${tex}</span>`;
  }
}

function renderContent(raw: string): string {
  // Extract math blocks BEFORE markdown parsing to prevent backslash stripping.
  // Replace with placeholders, run marked, then restore with rendered KaTeX.
  const placeholders: string[] = [];
  function placeholder(html: string): string {
    const idx = placeholders.length;
    placeholders.push(html);
    return `%%MATH_${idx}%%`;
  }

  // Display math: $$...$$ and \[...\]
  let text = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => placeholder(renderKatex(tex, true)));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => placeholder(renderKatex(tex, true)));
  // Inline math: $...$ and \(...\)
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, tex) => placeholder(renderKatex(tex, false)));
  text = text.replace(/\\\((.+?)\\\)/g, (_, tex) => placeholder(renderKatex(tex, false)));

  // Now run markdown on the remaining text
  let html = marked.parse(text) as string;

  // Restore math placeholders
  html = html.replace(/%%MATH_(\d+)%%/g, (_, idx) => placeholders[parseInt(idx)]);

  return html;
}

function appendMessage(role: 'user' | 'assistant', content: string): void {
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg chat-msg-${role}`;
  if (role === 'assistant') {
    msgDiv.innerHTML = renderContent(content);
  } else {
    msgDiv.textContent = content;
  }
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
  typingDiv.innerHTML = '<span class="shimmer-text">Thinking...</span>';
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
  tabs.forEach(t => t.webview.style.visibility = 'hidden');
  settingsModal.classList.add('open');
  settingsOverlay.classList.add('open');
}

function closeSettings(): void {
  tabs.forEach(t => t.webview.style.visibility = '');
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

// --- Handle new window requests from main process ---
window.browser.onOpenUrl((url: string) => {
  createTab(url);
});

// --- Initialize first tab ---
createTab();
