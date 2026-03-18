import { useState, useEffect } from 'react';

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [braveKey, setBraveKey] = useState('');
  const [serperKey, setSerperKey] = useState('');

  useEffect(() => {
    window.browser.getSettings().then(settings => {
      setApiKey(settings.openaiKey);
      setBraveKey(settings.braveKey || '');
      setSerperKey(settings.serperKey || '');
    });
  }, []);

  const handleSave = async () => {
    await window.browser.saveSettings({ openaiKey: apiKey.trim(), braveKey: braveKey.trim(), serperKey: serperKey.trim() });
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50 z-[200]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl p-7 px-8 w-[420px] z-[201] shadow-[0_20px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
        <h2 className="text-lg font-semibold mb-5 text-black dark:text-neutral-200">Settings</h2>
        <div className="mb-5">
          <label htmlFor="api-key-input" className="block text-[13px] font-medium mb-1.5 text-neutral-700 dark:text-neutral-300">
            OpenAI API Key
          </label>
          <input
            type="password"
            id="api-key-input"
            className="w-full h-9 px-3 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-black dark:text-neutral-200 text-[13px] font-mono outline-none focus:border-black dark:focus:border-neutral-400 focus:shadow-[0_0_0_2px_rgba(0,0,0,0.1)] dark:focus:shadow-[0_0_0_2px_rgba(255,255,255,0.1)]"
            placeholder="sk-..."
            spellCheck={false}
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1.5">Your key is stored locally and never shared.</p>
        </div>
        <div className="mb-5">
          <label htmlFor="brave-key-input" className="block text-[13px] font-medium mb-1.5 text-neutral-700 dark:text-neutral-300">
            Brave Search API Key
          </label>
          <input
            type="password"
            id="brave-key-input"
            className="w-full h-9 px-3 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-black dark:text-neutral-200 text-[13px] font-mono outline-none focus:border-black dark:focus:border-neutral-400 focus:shadow-[0_0_0_2px_rgba(0,0,0,0.1)] dark:focus:shadow-[0_0_0_2px_rgba(255,255,255,0.1)]"
            placeholder="BSA..."
            spellCheck={false}
            autoComplete="off"
            value={braveKey}
            onChange={(e) => setBraveKey(e.target.value)}
          />
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1.5">Enables AI web search. Get a key at brave.com/search/api</p>
        </div>
        <div className="mb-5">
          <label htmlFor="serper-key-input" className="block text-[13px] font-medium mb-1.5 text-neutral-700 dark:text-neutral-300">
            Serper API Key
          </label>
          <input
            type="password"
            id="serper-key-input"
            className="w-full h-9 px-3 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-black dark:text-neutral-200 text-[13px] font-mono outline-none focus:border-black dark:focus:border-neutral-400 focus:shadow-[0_0_0_2px_rgba(0,0,0,0.1)] dark:focus:shadow-[0_0_0_2px_rgba(255,255,255,0.1)]"
            placeholder="..."
            spellCheck={false}
            autoComplete="off"
            value={serperKey}
            onChange={(e) => setSerperKey(e.target.value)}
          />
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1.5">Pre-fetches search results for chat queries. Get a key at serper.dev</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="h-[34px] px-4 border-none rounded-lg text-[13px] font-medium cursor-pointer transition-colors bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="h-[34px] px-4 border-none rounded-lg text-[13px] font-medium cursor-pointer transition-colors bg-black dark:bg-neutral-200 text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-300"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}
