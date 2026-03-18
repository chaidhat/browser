import { createRoot } from 'react-dom/client';
import type { BrowserAPI } from './preload';
import App from './App';

declare global {
  interface Window {
    browser: BrowserAPI;
  }
}

// Sync dark mode class with system preference
function syncDarkMode() {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}
syncDarkMode();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncDarkMode);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
