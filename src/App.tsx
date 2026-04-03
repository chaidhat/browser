import { useReducer, useState, useRef, useEffect, useCallback } from 'react';
import { TabSidebar } from './components/TabSidebar';
import { Toolbar } from './components/Toolbar';
import { WebviewContainer, WebviewContainerHandle, TabInfo } from './components/WebviewContainer';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatView, DisplayMessage } from './components/ChatView';
import { DownloadBar, DownloadItem } from './components/DownloadBar';
import { FindBar } from './components/FindBar';

function playNotificationTone() {
  // Generate a WAV in memory: C5 for 0.5s then A5 for 0.5s
  const sampleRate = 44100;
  const totalSamples = sampleRate * 1;
  const notes = [
    { freq: 880, startSample: 0, endSample: sampleRate * 1.0 },
  ];
  const samples = new Float32Array(totalSamples);
  for (const note of notes) {
    for (let i = Math.floor(note.startSample); i < Math.floor(note.endSample); i++) {
      const t = (i - note.startSample) / sampleRate;
      const duration = (note.endSample - note.startSample) / sampleRate;
      const envelope = Math.exp(-3 * t / duration); // fade out
      samples[i] += 0.3 * envelope * Math.sin(2 * Math.PI * note.freq * t);
    }
  }
  // Encode as 16-bit PCM WAV
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s * 0x7FFF, true);
  }
  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play().finally(() => { setTimeout(() => URL.revokeObjectURL(url), 2000); });
}

interface TabState {
  tabs: TabInfo[];
  activeTabId: number;
  nextTabId: number;
}

type ChatHistories = Record<number, DisplayMessage[]>;

type TabAction =
  | { type: 'CREATE_TAB'; url?: string }
  | { type: 'CLOSE_TAB'; id: number }
  | { type: 'SWITCH_TAB'; id: number }
  | { type: 'UPDATE_TAB'; id: number; title?: string; url?: string }
  | { type: 'CONVERT_TAB'; id: number; url: string }
  | { type: 'DUPLICATE_TAB'; id: number }
  | { type: 'REORDER_TABS'; tabs: TabInfo[] }
  | { type: 'RESTORE'; state: TabState };

function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {
    case 'CREATE_TAB': {
      const id = state.nextTabId;
      const hasUrl = !!action.url;
      const newTab: TabInfo = {
        id,
        title: hasUrl ? 'New Tab' : 'New Chat',
        url: action.url || '',
        type: hasUrl ? 'page' : 'chat',
      };
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: id,
        nextTabId: id + 1,
      };
    }
    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex(t => t.id === action.id);
      if (idx === -1) return state;

      if (state.tabs.length === 1) {
        const newId = state.nextTabId;
        const newTab: TabInfo = { id: newId, title: 'New Chat', url: '', type: 'chat' };
        return {
          tabs: [newTab],
          activeTabId: newId,
          nextTabId: newId + 1,
        };
      }

      const newTabs = state.tabs.filter(t => t.id !== action.id);
      let newActiveId = state.activeTabId;
      if (state.activeTabId === action.id) {
        const newIdx = idx >= newTabs.length ? newTabs.length - 1 : idx;
        newActiveId = newTabs[newIdx].id;
      }

      return {
        ...state,
        tabs: newTabs,
        activeTabId: newActiveId,
      };
    }
    case 'SWITCH_TAB': {
      if (!state.tabs.find(t => t.id === action.id)) return state;
      return { ...state, activeTabId: action.id };
    }
    case 'UPDATE_TAB': {
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.id
            ? { ...t, ...(action.title !== undefined && { title: action.title }), ...(action.url !== undefined && { url: action.url }) }
            : t
        ),
      };
    }
    case 'CONVERT_TAB': {
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.id
            ? { ...t, type: 'page' as const, url: action.url, title: 'Loading...' }
            : t
        ),
      };
    }
    case 'DUPLICATE_TAB': {
      const srcTab = state.tabs.find(t => t.id === action.id);
      if (!srcTab) return state;
      const newId = state.nextTabId;
      const newTab: TabInfo = { ...srcTab, id: newId };
      const idx = state.tabs.findIndex(t => t.id === action.id);
      const newTabs = [...state.tabs];
      newTabs.splice(idx + 1, 0, newTab);
      return { tabs: newTabs, activeTabId: newId, nextTabId: newId + 1 };
    }
    case 'REORDER_TABS': {
      return { ...state, tabs: action.tabs };
    }
    case 'RESTORE': {
      return action.state;
    }
    default:
      return state;
  }
}

export default function App() {
  const [tabState, dispatch] = useReducer(tabReducer, {
    tabs: [],
    activeTabId: -1,
    nextTabId: 0,
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tabSidebarOpen, setTabSidebarOpen] = useState(true);
  const openSettings = useCallback(() => window.browser.openSettings(), []);
  const [font, setFont] = useState<'inter' | 'pt-serif'>('pt-serif');
  const [loadingTabs, setLoadingTabs] = useState<Record<number, boolean>>({});
  const [favicons, setFavicons] = useState<Record<number, string>>({});
  const [chatHistories, setChatHistories] = useState<ChatHistories>({});
  const [initialized, setInitialized] = useState(false);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [findMatches, setFindMatches] = useState({ active: 0, total: 0 });
  const [thinkingTabs, setThinkingTabs] = useState<Record<number, boolean>>({});
  const [unreadTabs, setUnreadTabs] = useState<Record<number, boolean>>({});
  const [initialQueries, setInitialQueries] = useState<Record<number, string>>({});
  const [visitHistory, setVisitHistory] = useState<{ url: string; title: string; visitCount: number; lastVisited: number }[]>([]);

  const webviewRef = useRef<WebviewContainerHandle>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const activeTabIdRef = useRef(tabState.activeTabId);
  activeTabIdRef.current = tabState.activeTabId;

  const activeTab = tabState.tabs.find(t => t.id === tabState.activeTabId);

  useEffect(() => {
    if (activeTab) {
      document.title = activeTab.title;
    }
  }, [activeTab?.title, activeTab?.id]);

  useEffect(() => {
    const ff = font === 'inter' ? 'Inter, sans-serif' : "'PT Serif', serif";
    document.documentElement.style.fontFamily = ff;
    document.body.style.fontFamily = ff;
  }, [font]);

  useEffect(() => {
    (async () => {
      const saved = await window.browser.loadTabs() as {
        tabs: TabInfo[];
        activeTabId: number;
        nextTabId: number;
        chatHistories: ChatHistories;
      } | null;
      if (saved?.tabs?.length) {
        dispatch({ type: 'RESTORE', state: { tabs: saved.tabs, activeTabId: saved.activeTabId, nextTabId: saved.nextTabId } });
        setChatHistories(saved.chatHistories || {});
      } else {
        dispatch({ type: 'CREATE_TAB' });
      }
      const savedHistory = await window.browser.loadHistory();
      if (savedHistory?.length) setVisitHistory(savedHistory);
      const settings = await window.browser.getSettings();
      setFont(settings.font || 'pt-serif');
      setInitialized(true);
    })();

    // Reload settings when settings window closes
    window.browser.onSettingsChanged(() => {
      window.browser.getSettings().then(s => {
        setFont(s.font || 'pt-serif');
        (window as any).__applyTheme?.(s.theme || 'system');
      });
    });
  }, []);

  useEffect(() => {
    if (!initialized) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      window.browser.saveTabs({
        tabs: tabState.tabs,
        activeTabId: tabState.activeTabId,
        nextTabId: tabState.nextTabId,
        chatHistories,
      });
    }, 500);
  }, [tabState, chatHistories, initialized]);

  const historySaveRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!initialized) return;
    if (historySaveRef.current) clearTimeout(historySaveRef.current);
    historySaveRef.current = setTimeout(() => {
      window.browser.saveHistory(visitHistory);
    }, 2000);
  }, [visitHistory, initialized]);

  const handleCloseTab = useCallback((id: number) => {
    dispatch({ type: 'CLOSE_TAB', id });
    setChatHistories(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleTabUpdate = useCallback((id: number, updates: { title?: string; url?: string }) => {
    dispatch({ type: 'UPDATE_TAB', id, ...updates });
    if (updates.url && updates.url !== 'about:blank' && !updates.url.startsWith('data:')) {
      setVisitHistory(prev => {
        const existing = prev.find(h => h.url === updates.url);
        if (existing) {
          return prev.map(h => h.url === updates.url
            ? { ...h, visitCount: h.visitCount + 1, lastVisited: Date.now(), title: updates.title || h.title }
            : h
          );
        }
        const entry = { url: updates.url!, title: updates.title || '', visitCount: 1, lastVisited: Date.now() };
        return [...prev, entry].slice(-500);
      });
    }
    if (updates.title && !updates.url) {
      setVisitHistory(prev => {
        const tab = tabState.tabs.find(t => t.id === id);
        if (!tab?.url) return prev;
        return prev.map(h => h.url === tab.url ? { ...h, title: updates.title! } : h);
      });
    }
  }, [tabState.tabs]);

  const handleLoadingChange = useCallback((tabId: number, isLoading: boolean) => {
    setLoadingTabs(prev => ({ ...prev, [tabId]: isLoading }));
  }, []);

  const handleFaviconChange = useCallback((tabId: number, favicon: string) => {
    setFavicons(prev => ({ ...prev, [tabId]: favicon }));
  }, []);

  const handleChatMessagesChange = useCallback((tabId: number, messages: DisplayMessage[]) => {
    setChatHistories(prev => ({ ...prev, [tabId]: messages }));
  }, []);

  const handleChatTitleChange = useCallback((tabId: number, title: string) => {
    dispatch({ type: 'UPDATE_TAB', id: tabId, title });
  }, []);

  const handleThinkingChange = useCallback((tabId: number, thinking: boolean) => {
    setThinkingTabs(prev => ({ ...prev, [tabId]: thinking }));
    if (!thinking) {
      playNotificationTone();
      // Mark unread if tab isn't active
      if (tabId !== activeTabIdRef.current) {
        setUnreadTabs(prev => ({ ...prev, [tabId]: true }));
      }
    }
  }, []);

  useEffect(() => {
    window.browser.onOpenUrl((url: string) => {
      dispatch({ type: 'CREATE_TAB', url });
    });

    window.browser.onDownloadStarted((event) => {
      setDownloads(prev => {
        // Deduplicate — if a download with the same savePath is already active, replace it
        const filtered = prev.filter(dl => dl.savePath !== event.savePath || dl.state !== 'downloading');
        return [...filtered, {
          id: event.id,
          fileName: event.fileName,
          totalBytes: event.totalBytes,
          receivedBytes: 0,
          savePath: event.savePath,
          state: 'downloading',
        }];
      });
    });

    window.browser.onDownloadProgress((event) => {
      setDownloads(prev => prev.map(dl =>
        dl.id === event.id
          ? { ...dl, receivedBytes: event.receivedBytes, totalBytes: event.totalBytes }
          : dl
      ));
    });

    window.browser.onFoundInPageResult((activeMatch, totalMatches) => {
      setFindMatches({ active: activeMatch, total: totalMatches });
    });

    window.browser.onDownloadDone((event) => {
      setDownloads(prev => prev.map(dl =>
        dl.id === event.id
          ? { ...dl, state: event.state, savePath: event.savePath }
          : dl
      ));
    });

    // Forward Cmd+T/F intercepted from webview to our document keydown handler
    window.browser.onShortcutFromWebview((key: string, alt: boolean) => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key,
        metaKey: true,
        altKey: alt,
        bubbles: true,
      }));
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && (e.key === 't' || e.key === '†' || e.code === 'KeyT')) {
        e.preventDefault();
        setTabSidebarOpen(prev => !prev);
      } else if (e.metaKey && e.key === 't') {
        e.preventDefault();
        dispatch({ type: 'CREATE_TAB' });
      } else if (e.metaKey && e.key === 'w') {
        e.preventDefault();
        if (tabState.activeTabId !== -1) {
          handleCloseTab(tabState.activeTabId);
        }
      } else if (e.metaKey && e.key === 'f') {
        e.preventDefault();
        setFindOpen(prev => !prev);
      } else if (e.metaKey && e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = tabState.tabs.findIndex(t => t.id === tabState.activeTabId);
        if (idx > 0) {
          dispatch({ type: 'SWITCH_TAB', id: tabState.tabs[idx - 1].id });
          setUnreadTabs(prev => ({ ...prev, [tabState.tabs[idx - 1].id]: false }));
        }
      } else if (e.metaKey && e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        const idx = tabState.tabs.findIndex(t => t.id === tabState.activeTabId);
        if (idx < tabState.tabs.length - 1) {
          dispatch({ type: 'SWITCH_TAB', id: tabState.tabs[idx + 1].id });
          setUnreadTabs(prev => ({ ...prev, [tabState.tabs[idx + 1].id]: false }));
        }
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [tabState.activeTabId, handleCloseTab, activeTab?.type, findOpen]);

  useEffect(() => {
    setFindOpen(false);
    setFindMatches({ active: 0, total: 0 });
  }, [activeTab?.id]);

  const chatFindRef = useRef<{ query: string; matches: number }>({ query: '', matches: 0 });

  const chatFindHighlightsRef = useRef<(() => void) | null>(null);

  const handleFind = useCallback((text: string, forward: boolean) => {
    if (activeTab?.type === 'chat') {
      // Clear previous highlights
      chatFindHighlightsRef.current?.();

      const container = document.querySelector(`[data-chat-messages="${activeTab.id}"]`);
      if (!container || !text) {
        setFindMatches({ active: 0, total: 0 });
        return;
      }

      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      const marks: HTMLElement[] = [];

      // Walk text nodes and wrap matches with <mark>
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = [];

      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const nodeMatches = [...node.textContent!.matchAll(regex)];
        if (nodeMatches.length > 0) {
          nodesToProcess.push({ node, matches: nodeMatches });
        }
      }

      for (const { node: textNode, matches: nodeMatches } of nodesToProcess) {
        const parent = textNode.parentNode;
        if (!parent) continue;
        const fullText = textNode.textContent!;
        const frag = document.createDocumentFragment();
        let lastIndex = 0;

        for (const match of nodeMatches) {
          const start = match.index!;
          if (start > lastIndex) {
            frag.appendChild(document.createTextNode(fullText.slice(lastIndex, start)));
          }
          const mark = document.createElement('mark');
          mark.style.cssText = 'background:#fde047;color:#000;border-radius:2px;';
          mark.textContent = match[0];
          marks.push(mark);
          frag.appendChild(mark);
          lastIndex = start + match[0].length;
        }
        if (lastIndex < fullText.length) {
          frag.appendChild(document.createTextNode(fullText.slice(lastIndex)));
        }
        parent.replaceChild(frag, textNode);
      }

      // Track active match index
      const total = marks.length;
      if (total > 0) {
        const activeIdx = chatFindRef.current.query === text
          ? ((chatFindRef.current.matches + (forward ? 1 : -1) + total) % total)
          : 0;
        chatFindRef.current.query = text;
        chatFindRef.current.matches = activeIdx;

        // Highlight active match differently
        marks.forEach((m, i) => {
          if (i === activeIdx) {
            m.style.cssText = 'background:#fb923c;color:#000;border-radius:2px;';
            m.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        });

        setFindMatches({ active: activeIdx + 1, total });
      } else {
        chatFindRef.current.query = text;
        chatFindRef.current.matches = 0;
        setFindMatches({ active: 0, total: 0 });
      }

      // Cleanup function to remove marks
      chatFindHighlightsRef.current = () => {
        for (const mark of marks) {
          const parent = mark.parentNode;
          if (parent) {
            parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
            parent.normalize();
          }
        }
        chatFindHighlightsRef.current = null;
      };
    } else {
      webviewRef.current?.findInPage(text, forward);
    }
  }, [activeTab?.type]);

  useEffect(() => {
    if (!findOpen) {
      chatFindHighlightsRef.current?.();
      webviewRef.current?.stopFindInPage();
      setFindMatches({ active: 0, total: 0 });
      chatFindRef.current = { query: '', matches: 0 };
    }
  }, [findOpen]);


  const handleNavigate = useCallback((url: string) => {
    if (activeTab?.type === 'chat') {
      dispatch({ type: 'CONVERT_TAB', id: activeTab.id, url });
    } else {
      webviewRef.current?.loadURL(url);
    }
  }, [activeTab?.type, activeTab?.id]);

  const handleSearch = useCallback((query: string) => {
    // If current tab is an empty chat, use it; otherwise create a new chat tab
    if (activeTab?.type === 'chat' && (!chatHistories[activeTab.id] || chatHistories[activeTab.id].length === 0)) {
      setInitialQueries(prev => ({ ...prev, [activeTab.id]: query }));
    } else {
      // We need to create a new chat tab and set its initial query
      // The tab ID will be tabState.nextTabId
      const newTabId = tabState.nextTabId;
      dispatch({ type: 'CREATE_TAB' });
      setInitialQueries(prev => ({ ...prev, [newTabId]: query }));
    }
  }, [activeTab?.type, activeTab?.id, chatHistories, tabState.nextTabId]);

  const isChat = activeTab?.type === 'chat';

  return (
    <div className="flex h-full w-full">
      <div className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${tabSidebarOpen ? 'w-[200px]' : 'w-0'}`}>
      <TabSidebar
        tabs={tabState.tabs}
        activeTabId={tabState.activeTabId}
        loadingTabs={loadingTabs}
        favicons={favicons}
        thinkingTabs={thinkingTabs}
        unreadTabs={unreadTabs}
        onSwitch={(id) => {
          dispatch({ type: 'SWITCH_TAB', id });
          setUnreadTabs(prev => ({ ...prev, [id]: false }));
        }}
        onClose={handleCloseTab}
        onCreate={() => dispatch({ type: 'CREATE_TAB' })}
        onDuplicate={(id) => dispatch({ type: 'DUPLICATE_TAB', id })}
        onReorder={(tabs) => dispatch({ type: 'REORDER_TABS', tabs })}
        onOpenSettings={openSettings}
      />
      </div>
      <div className="flex-1 flex flex-col min-w-0 h-full bg-white dark:bg-[#111]">
        {!isChat && (
          <Toolbar
            activeUrl={activeTab?.url || ''}
            loading={activeTab ? !!loadingTabs[activeTab.id] : false}
            sidebarOpen={sidebarOpen}
            onNavigate={handleNavigate}
            onSearch={handleSearch}
            onBack={() => webviewRef.current?.goBack()}
            onForward={() => webviewRef.current?.goForward()}
            onReload={() => webviewRef.current?.reload()}
            onToggleChat={() => setSidebarOpen(prev => !prev)}
            onToggleTabSidebar={() => setTabSidebarOpen(prev => !prev)}
            tabSidebarOpen={tabSidebarOpen}
            onOpenSettings={openSettings}
            isChatTab={isChat}
            allTabs={tabState.tabs}
            visitHistory={visitHistory}
          />
        )}
        <div className="flex flex-1 min-h-0 relative">
          {findOpen && (
            <FindBar
              onFind={handleFind}
              onClose={() => setFindOpen(false)}
              matchCount={findMatches.total}
              activeMatch={findMatches.active}
            />
          )}
          {tabState.tabs.filter(t => t.type === 'chat').map(tab => (
            <ChatView
              key={tab.id}
              tabId={tab.id}
              tabTitle={tab.title}
              hidden={tab.id !== tabState.activeTabId}
              messages={chatHistories[tab.id] || []}
              onMessagesChange={handleChatMessagesChange}
              onTitleChange={handleChatTitleChange}
              onNavigate={(url) => dispatch({ type: 'CONVERT_TAB', id: tab.id, url })}
              onOpenLink={(url) => dispatch({ type: 'CREATE_TAB', url })}
              onThinkingChange={handleThinkingChange}
              initialQuery={initialQueries[tab.id]}
              onInitialQueryConsumed={(tabId) => setInitialQueries(prev => { const next = { ...prev }; delete next[tabId]; return next; })}
              visitHistory={visitHistory}
            />
          ))}
          <WebviewContainer
            ref={webviewRef}
            tabs={tabState.tabs}
            activeTabId={tabState.activeTabId}
            onTabUpdate={handleTabUpdate}
            onLoadingChange={handleLoadingChange}
            onFaviconChange={handleFaviconChange}
            hidden={isChat}
          />
          {!isChat && <ChatSidebar open={sidebarOpen} />}
        </div>
        <DownloadBar
          downloads={downloads}
          onDismiss={(id) => setDownloads(prev => prev.filter(dl => dl.id !== id))}
          onShowInFolder={(filePath) => window.browser.showInFolder(filePath)}
          onDismissAll={() => setDownloads([])}
        />
      </div>
    </div>
  );
}
