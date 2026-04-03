import { createRoot } from 'react-dom/client';
import type { BrowserAPI } from './preload';
import App from './App';
import { SettingsPage } from './components/SettingsModal';

declare global {
  interface Window {
    browser: BrowserAPI;
  }
}

// Sync dark mode class with theme setting
function syncDarkMode() {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function applyTheme(theme: string) {
  document.documentElement.classList.remove('sunset');
  if (theme === 'dark' || theme === 'sunset') {
    document.documentElement.classList.add('dark');
    if (theme === 'sunset') document.documentElement.classList.add('sunset');
  } else if (theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    syncDarkMode();
  }
}

// Load saved theme, then listen for OS changes
window.browser.getSettings().then(s => applyTheme(s.theme || 'system'));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  window.browser.getSettings().then(s => {
    if (s.theme === 'system') syncDarkMode();
  });
});

// Expose so SettingsPage can call it for live preview
(window as any).__applyTheme = applyTheme;

const isSettings = new URLSearchParams(window.location.search).get('settings') === '1';

const root = createRoot(document.getElementById('root')!);
root.render(isSettings ? <SettingsPage /> : <App />);
