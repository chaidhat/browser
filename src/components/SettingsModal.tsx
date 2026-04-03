import { useState, useEffect } from 'react';

interface EmailAccount {
  id: string;
  label: string;
  email: string;
  imap: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; password: string };
  smtp: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; password: string };
  lastMessageCount?: number;
}

interface Props {
  onClose: () => void;
  activeUrl?: string;
  onClearHistory?: () => void;
}

const inputClass = "w-full h-9 px-3 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-black dark:text-neutral-200 text-[13px] font-mono outline-none focus:border-black dark:focus:border-neutral-400 focus:shadow-[0_0_0_2px_rgba(0,0,0,0.1)] dark:focus:shadow-[0_0_0_2px_rgba(255,255,255,0.1)]";
const selectClass = "w-full h-9 px-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-black dark:text-neutral-200 text-[13px] outline-none focus:border-black dark:focus:border-neutral-400";
const labelClass = "block text-[13px] font-medium mb-1.5 text-neutral-700 dark:text-neutral-300";
const helpClass = "text-[11px] text-neutral-400 dark:text-neutral-500 mt-1.5";

export function SettingsModal({ onClose, activeUrl, onClearHistory }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [braveKey, setBraveKey] = useState('');
  const [serperKey, setSerperKey] = useState('');
  const [font, setFont] = useState<'inter' | 'pt-serif'>('pt-serif');
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    window.browser.getSettings().then(settings => {
      setApiKey(settings.openaiKey);
      setAnthropicKey(settings.anthropicKey || '');
      setGoogleKey(settings.googleKey || '');
      setBraveKey(settings.braveKey || '');
      setSerperKey(settings.serperKey || '');
      setFont(settings.font || 'pt-serif');
      setEmailAccounts(settings.emailAccounts || []);
    });
  }, []);

  const selectedAccount = emailAccounts.find(a => a.id === selectedAccountId) || null;

  const updateAccount = (id: string, changes: Partial<EmailAccount>) => {
    setEmailAccounts(prev => prev.map(a => a.id === id ? { ...a, ...changes } : a));
  };

  const updateImap = (id: string, changes: Partial<EmailAccount['imap']>) => {
    setEmailAccounts(prev => prev.map(a => a.id === id ? { ...a, imap: { ...a.imap, ...changes } } : a));
  };

  const updateSmtp = (id: string, changes: Partial<EmailAccount['smtp']>) => {
    setEmailAccounts(prev => prev.map(a => a.id === id ? { ...a, smtp: { ...a.smtp, ...changes } } : a));
  };

  const addAccount = () => {
    const newAccount: EmailAccount = {
      id: crypto.randomUUID(),
      label: `Account ${emailAccounts.length + 1}`,
      email: '',
      imap: { host: '', port: 993, security: 'tls', username: '', password: '' },
      smtp: { host: '', port: 465, security: 'tls', username: '', password: '' },
    };
    setEmailAccounts(prev => [...prev, newAccount]);
    setSelectedAccountId(newAccount.id);
    setTestResult(null);
  };

  const removeAccount = (id: string) => {
    setEmailAccounts(prev => prev.filter(a => a.id !== id));
    if (selectedAccountId === id) {
      setSelectedAccountId(null);
      setTestResult(null);
    }
  };

  const handleTestImap = async () => {
    if (!selectedAccount) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await window.browser.testImap(selectedAccount);
      if (result.success) {
        setTestResult({ type: 'success', message: `Connected — ${result.messageCount} message${result.messageCount === 1 ? '' : 's'} in inbox` });
        updateAccount(selectedAccount.id, { lastMessageCount: result.messageCount } as Partial<EmailAccount>);
      } else {
        setTestResult({ type: 'error', message: result.error || 'Connection failed' });
      }
    } catch (err: unknown) {
      setTestResult({ type: 'error', message: err instanceof Error ? err.message : 'Connection failed' });
    }
    setIsTesting(false);
  };

  const handleSave = async () => {
    await window.browser.saveSettings({
      openaiKey: apiKey.trim(),
      anthropicKey: anthropicKey.trim(),
      googleKey: googleKey.trim(),
      braveKey: braveKey.trim(),
      serperKey: serperKey.trim(),
      font,
      emailAccounts,
    });
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 dark:bg-black/50 z-[200] no-drag" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-xl w-[640px] max-h-[80vh] z-[201] shadow-[0_20px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.4)] no-drag flex flex-col overflow-hidden">
        <h2 className="text-lg font-semibold p-7 px-8 pb-0 mb-5 text-black dark:text-neutral-200 shrink-0">Settings</h2>
        <div className="flex-1 overflow-y-auto px-8 scrollbar-thin">
        <div className="mb-5">
          <label htmlFor="api-key-input" className={labelClass}>
            OpenAI API Key
          </label>
          <input
            type="password"
            id="api-key-input"
            className={inputClass}
            placeholder="sk-..."
            spellCheck={false}
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className={helpClass}>Your key is stored locally and never shared.</p>
        </div>
        <div className="mb-5">
          <label htmlFor="anthropic-key-input" className={labelClass}>
            Anthropic API Key
          </label>
          <input
            type="password"
            id="anthropic-key-input"
            className={inputClass}
            placeholder="sk-ant-..."
            spellCheck={false}
            autoComplete="off"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
          />
          <p className={helpClass}>Required for Claude Opus 4.6. Get a key at console.anthropic.com</p>
        </div>
        <div className="mb-5">
          <label htmlFor="google-key-input" className={labelClass}>
            Google AI API Key
          </label>
          <input
            type="password"
            id="google-key-input"
            className={inputClass}
            placeholder="AI..."
            spellCheck={false}
            autoComplete="off"
            value={googleKey}
            onChange={(e) => setGoogleKey(e.target.value)}
          />
          <p className={helpClass}>Required for Gemini 3.1 Pro. Get a key at aistudio.google.com</p>
        </div>
        <div className="mb-5">
          <label htmlFor="brave-key-input" className={labelClass}>
            Brave Search API Key
          </label>
          <input
            type="password"
            id="brave-key-input"
            className={inputClass}
            placeholder="BSA..."
            spellCheck={false}
            autoComplete="off"
            value={braveKey}
            onChange={(e) => setBraveKey(e.target.value)}
          />
          <p className={helpClass}>Enables AI web search. Get a key at brave.com/search/api</p>
        </div>
        <div className="mb-5">
          <label htmlFor="serper-key-input" className={labelClass}>
            Serper API Key
          </label>
          <input
            type="password"
            id="serper-key-input"
            className={inputClass}
            placeholder="..."
            spellCheck={false}
            autoComplete="off"
            value={serperKey}
            onChange={(e) => setSerperKey(e.target.value)}
          />
          <p className={helpClass}>Pre-fetches search results for chat queries. Get a key at serper.dev</p>
        </div>

        {/* Font */}
        <div className="mb-5 pt-4 border-t border-neutral-200 dark:border-neutral-700">
          <label className={labelClass}>Font</label>
          <div className="flex gap-2">
            <button
              className={`flex-1 px-3 py-2 rounded-lg border text-[13px] cursor-pointer transition-colors ${font === 'inter' ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium' : 'border-neutral-200 dark:border-neutral-700 bg-transparent text-neutral-600 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/5'}`}
              style={{ fontFamily: 'Inter, sans-serif' }}
              onClick={() => setFont('inter')}
            >
              Inter
            </button>
            <button
              className={`flex-1 px-3 py-2 rounded-lg border text-[13px] cursor-pointer transition-colors ${font === 'pt-serif' ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium' : 'border-neutral-200 dark:border-neutral-700 bg-transparent text-neutral-600 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/5'}`}
              style={{ fontFamily: "'PT Serif', serif" }}
              onClick={() => setFont('pt-serif')}
            >
              PT Serif
            </button>
          </div>
        </div>

        {/* Email Accounts */}
        <div className="mb-5 pt-4 border-t border-neutral-200 dark:border-neutral-700">
          <label className={labelClass}>Email Accounts</label>
          <p className={helpClass + ' !mt-0 mb-3'}>Configure IMAP and SMTP for email accounts.</p>

          <div className="flex gap-3">
            {/* Account list */}
            <div className="w-[160px] shrink-0">
              <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
                {emailAccounts.map(account => (
                  <button
                    key={account.id}
                    className={`w-full text-left px-3 py-2 text-[13px] border-b border-neutral-200 dark:border-neutral-700 last:border-b-0 cursor-pointer transition-colors truncate ${
                      selectedAccountId === account.id
                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium'
                        : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                    }`}
                    onClick={() => { setSelectedAccountId(account.id); setTestResult(null); }}
                  >
                    <span className="block truncate">{account.label || account.email || 'Untitled'}</span>
                    {account.lastMessageCount != null && (
                      <span className="block text-[10px] text-neutral-400 dark:text-neutral-500 font-normal">{account.lastMessageCount.toLocaleString()} mail{account.lastMessageCount === 1 ? '' : 's'}</span>
                    )}
                  </button>
                ))}
              </div>
              <button
                className="mt-2 w-full h-[34px] border-none rounded-lg text-[13px] font-medium cursor-pointer transition-colors bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600"
                onClick={addAccount}
              >
                + Add Account
              </button>
            </div>

            {/* Account detail */}
            {selectedAccount ? (
              <div className="flex-1 min-w-0">
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="block text-[11px] font-medium mb-1 text-neutral-500 dark:text-neutral-400">Label</label>
                    <input
                      className={inputClass}
                      value={selectedAccount.label}
                      onChange={e => updateAccount(selectedAccount.id, { label: e.target.value })}
                      placeholder="Work Gmail"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium mb-1 text-neutral-500 dark:text-neutral-400">Email</label>
                    <input
                      className={inputClass}
                      value={selectedAccount.email}
                      onChange={e => updateAccount(selectedAccount.id, { email: e.target.value })}
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                {/* IMAP */}
                <div className="mb-3">
                  <div className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">IMAP</div>
                  <div className="grid grid-cols-[1fr_80px_100px] gap-2 mb-2">
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Host</label>
                      <input className={inputClass} value={selectedAccount.imap.host} onChange={e => updateImap(selectedAccount.id, { host: e.target.value })} placeholder="imap.gmail.com" />
                    </div>
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Port</label>
                      <input className={inputClass} type="number" value={selectedAccount.imap.port} onChange={e => updateImap(selectedAccount.id, { port: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Security</label>
                      <select className={selectClass} value={selectedAccount.imap.security} onChange={e => updateImap(selectedAccount.id, { security: e.target.value as 'tls' | 'starttls' | 'none' })}>
                        <option value="tls">TLS</option>
                        <option value="starttls">STARTTLS</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Username</label>
                      <input className={inputClass} value={selectedAccount.imap.username} onChange={e => updateImap(selectedAccount.id, { username: e.target.value })} placeholder="you@example.com" />
                    </div>
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Password</label>
                      <input className={inputClass} type="password" value={selectedAccount.imap.password} onChange={e => updateImap(selectedAccount.id, { password: e.target.value })} placeholder="App password" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      className="h-[30px] px-3 border-none rounded-lg text-[12px] font-medium cursor-pointer transition-colors bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-default"
                      onClick={handleTestImap}
                      disabled={isTesting || !selectedAccount.imap.host || !selectedAccount.imap.username}
                    >
                      {isTesting ? 'Testing...' : 'Test IMAP'}
                    </button>
                    {testResult && (
                      <span className={`text-[12px] ${testResult.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {testResult.message}
                      </span>
                    )}
                  </div>
                </div>

                {/* SMTP */}
                <div className="mb-3">
                  <div className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">SMTP</div>
                  <div className="grid grid-cols-[1fr_80px_100px] gap-2 mb-2">
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Host</label>
                      <input className={inputClass} value={selectedAccount.smtp.host} onChange={e => updateSmtp(selectedAccount.id, { host: e.target.value })} placeholder="smtp.gmail.com" />
                    </div>
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Port</label>
                      <input className={inputClass} type="number" value={selectedAccount.smtp.port} onChange={e => updateSmtp(selectedAccount.id, { port: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Security</label>
                      <select className={selectClass} value={selectedAccount.smtp.security} onChange={e => updateSmtp(selectedAccount.id, { security: e.target.value as 'tls' | 'starttls' | 'none' })}>
                        <option value="tls">TLS</option>
                        <option value="starttls">STARTTLS</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Username</label>
                      <input className={inputClass} value={selectedAccount.smtp.username} onChange={e => updateSmtp(selectedAccount.id, { username: e.target.value })} placeholder="you@example.com" />
                    </div>
                    <div>
                      <label className="block text-[11px] mb-0.5 text-neutral-400">Password</label>
                      <input className={inputClass} type="password" value={selectedAccount.smtp.password} onChange={e => updateSmtp(selectedAccount.id, { password: e.target.value })} placeholder="App password" />
                    </div>
                  </div>
                </div>

                <button
                  className="h-[30px] px-3 border-none rounded-lg text-[12px] font-medium cursor-pointer transition-colors bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
                  onClick={() => removeAccount(selectedAccount.id)}
                >
                  Remove Account
                </button>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[13px] text-neutral-400 dark:text-neutral-500">
                {emailAccounts.length === 0 ? 'Add an account to get started' : 'Select an account to configure'}
              </div>
            )}
          </div>
        </div>

        {activeUrl && (() => {
          try {
            const origin = new URL(activeUrl).origin;
            return (
              <div className="mb-5 pt-4 border-t border-neutral-200 dark:border-neutral-700">
                <label className={labelClass}>
                  Site Data
                </label>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-2">Clear cookies, cache, and storage for {origin}</p>
                <button
                  className="h-[34px] px-4 border-none rounded-lg text-[13px] font-medium cursor-pointer transition-colors bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
                  onClick={async () => {
                    await window.browser.clearSiteData(origin);
                    onClose();
                  }}
                >
                  Clear Data for This Site
                </button>
              </div>
            );
          } catch { return null; }
        })()}
        <div className="mb-5 pt-4 border-t border-neutral-200 dark:border-neutral-700">
          <label className={labelClass}>
            Browsing History
          </label>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-2">Clear URL autocomplete history</p>
          <button
            className="h-[34px] px-4 border-none rounded-lg text-[13px] font-medium cursor-pointer transition-colors bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
            onClick={() => {
              onClearHistory?.();
              onClose();
            }}
          >
            Clear History
          </button>
        </div>
        </div>
        <div className="flex justify-end gap-2 p-7 px-8 pt-4 shrink-0 border-t border-neutral-200 dark:border-neutral-700">
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
