import { useReducer, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { WorkspaceSidebar, Workspace } from './components/TabSidebar';
import { Toolbar } from './components/Toolbar';
import { HorizontalTabBar } from './components/HorizontalTabBar';
import { WebviewContainer, WebviewContainerHandle, TabInfo } from './components/WebviewContainer';
import { ChatView, DisplayMessage } from './components/ChatView';
import { DownloadBar, DownloadItem } from './components/DownloadBar';
import { MessagesView } from './components/MessagesView';
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

interface AppState {
  workspaces: Workspace[];
  activeWorkspaceId: number;
  nextWorkspaceId: number;
  nextTabId: number;
}

type ChatHistories = Record<number, DisplayMessage[]>;

type AppAction =
  | { type: 'CREATE_WORKSPACE'; url?: string }
  | { type: 'CLOSE_WORKSPACE'; workspaceId: number }
  | { type: 'SWITCH_WORKSPACE'; workspaceId: number }
  | { type: 'REORDER_WORKSPACES'; workspaces: Workspace[] }
  | { type: 'CREATE_TAB'; workspaceId?: number; url?: string; tabType?: 'messages' }
  | { type: 'CLOSE_TAB'; tabId: number }
  | { type: 'SWITCH_TAB'; tabId: number }
  | { type: 'UPDATE_TAB'; tabId: number; title?: string; url?: string }
  | { type: 'CONVERT_TAB'; tabId: number; url: string }
  | { type: 'DUPLICATE_TAB'; tabId: number }
  | { type: 'RENAME_WORKSPACE'; workspaceId: number; name: string }
  | { type: 'RESTORE'; state: AppState };

function findWorkspaceForTab(state: AppState, tabId: number): Workspace | undefined {
  return state.workspaces.find(w => w.tabs.some(t => t.id === tabId));
}

function updateWorkspace(state: AppState, wsId: number, updater: (ws: Workspace) => Workspace): AppState {
  return { ...state, workspaces: state.workspaces.map(w => w.id === wsId ? updater(w) : w) };
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'CREATE_WORKSPACE': {
      const tabId = state.nextTabId;
      const wsId = state.nextWorkspaceId;
      const hasUrl = !!action.url;
      const newTab: TabInfo = {
        id: tabId,
        title: hasUrl ? 'New Tab' : 'New Chat',
        url: action.url || '',
        type: hasUrl ? 'page' : 'chat',
      };
      const newWs: Workspace = {
        id: wsId,
        name: '',
        tabs: [newTab],
        activeTabId: tabId,
      };
      return {
        workspaces: [...state.workspaces, newWs],
        activeWorkspaceId: wsId,
        nextWorkspaceId: wsId + 1,
        nextTabId: tabId + 1,
      };
    }

    case 'CLOSE_WORKSPACE': {
      const idx = state.workspaces.findIndex(w => w.id === action.workspaceId);
      if (idx === -1) return state;

      if (state.workspaces.length === 1) {
        // Last workspace — create a fresh one
        const tabId = state.nextTabId;
        const wsId = state.nextWorkspaceId;
        const newTab: TabInfo = { id: tabId, title: 'New Chat', url: '', type: 'chat' };
        const newWs: Workspace = { id: wsId, name: '', tabs: [newTab], activeTabId: tabId };
        return {
          workspaces: [newWs],
          activeWorkspaceId: wsId,
          nextWorkspaceId: wsId + 1,
          nextTabId: tabId + 1,
        };
      }

      const newWorkspaces = state.workspaces.filter(w => w.id !== action.workspaceId);
      let newActiveWsId = state.activeWorkspaceId;
      if (state.activeWorkspaceId === action.workspaceId) {
        const newIdx = idx >= newWorkspaces.length ? newWorkspaces.length - 1 : idx;
        newActiveWsId = newWorkspaces[newIdx].id;
      }
      return { ...state, workspaces: newWorkspaces, activeWorkspaceId: newActiveWsId };
    }

    case 'SWITCH_WORKSPACE': {
      if (!state.workspaces.find(w => w.id === action.workspaceId)) return state;
      return { ...state, activeWorkspaceId: action.workspaceId };
    }

    case 'RENAME_WORKSPACE': {
      return updateWorkspace(state, action.workspaceId, ws => ({ ...ws, name: action.name }));
    }

    case 'REORDER_WORKSPACES': {
      return { ...state, workspaces: action.workspaces };
    }

    case 'CREATE_TAB': {
      const wsId = action.workspaceId ?? state.activeWorkspaceId;
      const ws = state.workspaces.find(w => w.id === wsId);
      if (!ws) return state;

      // For messages tab, switch to existing one if it exists
      if (action.tabType === 'messages') {
        const existing = ws.tabs.find(t => t.type === 'messages');
        if (existing) {
          return {
            ...updateWorkspace(state, wsId, w => ({ ...w, activeTabId: existing.id })),
            activeWorkspaceId: wsId,
          };
        }
      }

      const tabId = state.nextTabId;
      let tabType: TabInfo['type'];
      let title: string;
      if (action.tabType === 'messages') {
        tabType = 'messages';
        title = 'Messages';
      } else if (action.url) {
        tabType = 'page';
        title = 'New Tab';
      } else {
        tabType = 'chat';
        title = 'New Chat';
      }
      const newTab: TabInfo = { id: tabId, title, url: action.url || '', type: tabType };
      return {
        ...updateWorkspace(state, wsId, w => ({
          ...w,
          tabs: [...w.tabs, newTab],
          activeTabId: tabId,
        })),
        nextTabId: tabId + 1,
      };
    }

    case 'CLOSE_TAB': {
      const ws = findWorkspaceForTab(state, action.tabId);
      if (!ws) return state;

      if (ws.tabs.length === 1) {
        // Last tab in workspace — replace with a fresh chat
        const tabId = state.nextTabId;
        const newTab: TabInfo = { id: tabId, title: 'New Chat', url: '', type: 'chat' };
        return {
          ...updateWorkspace(state, ws.id, w => ({
            ...w,
            tabs: [newTab],
            activeTabId: tabId,
          })),
          nextTabId: tabId + 1,
        };
      }

      const idx = ws.tabs.findIndex(t => t.id === action.tabId);
      const newTabs = ws.tabs.filter(t => t.id !== action.tabId);
      let newActiveTabId = ws.activeTabId;
      if (ws.activeTabId === action.tabId) {
        const newIdx = idx >= newTabs.length ? newTabs.length - 1 : idx;
        newActiveTabId = newTabs[newIdx].id;
      }
      return updateWorkspace(state, ws.id, w => ({
        ...w,
        tabs: newTabs,
        activeTabId: newActiveTabId,
      }));
    }

    case 'SWITCH_TAB': {
      const ws = findWorkspaceForTab(state, action.tabId);
      if (!ws) return state;
      return {
        ...updateWorkspace(state, ws.id, w => ({ ...w, activeTabId: action.tabId })),
        activeWorkspaceId: ws.id,
      };
    }

    case 'UPDATE_TAB': {
      const ws = findWorkspaceForTab(state, action.tabId);
      if (!ws) return state;
      return updateWorkspace(state, ws.id, w => ({
        ...w,
        tabs: w.tabs.map(t =>
          t.id === action.tabId
            ? { ...t, ...(action.title !== undefined && { title: action.title }), ...(action.url !== undefined && { url: action.url }) }
            : t
        ),
      }));
    }

    case 'CONVERT_TAB': {
      const ws = findWorkspaceForTab(state, action.tabId);
      if (!ws) return state;
      return updateWorkspace(state, ws.id, w => ({
        ...w,
        tabs: w.tabs.map(t =>
          t.id === action.tabId
            ? { ...t, type: 'page' as const, url: action.url, title: 'Loading...' }
            : t
        ),
      }));
    }

    case 'DUPLICATE_TAB': {
      const ws = findWorkspaceForTab(state, action.tabId);
      if (!ws) return state;
      const srcTab = ws.tabs.find(t => t.id === action.tabId);
      if (!srcTab) return state;
      const newId = state.nextTabId;
      const newTab: TabInfo = { ...srcTab, id: newId };
      const idx = ws.tabs.findIndex(t => t.id === action.tabId);
      const newTabs = [...ws.tabs];
      newTabs.splice(idx + 1, 0, newTab);
      return {
        ...updateWorkspace(state, ws.id, w => ({
          ...w,
          tabs: newTabs,
          activeTabId: newId,
        })),
        nextTabId: newId + 1,
      };
    }

    case 'RESTORE': {
      return action.state;
    }

    default:
      return state;
  }
}

// Migrate old flat tab format to workspace format
function migrateLoadedState(saved: any): { state: AppState; chatHistories: ChatHistories; favicons: Record<number, string> } | null {
  if (!saved) return null;

  // New format
  if (saved.workspaces?.length) {
    return {
      state: {
        workspaces: saved.workspaces,
        activeWorkspaceId: saved.activeWorkspaceId,
        nextWorkspaceId: saved.nextWorkspaceId,
        nextTabId: saved.nextTabId,
      },
      chatHistories: saved.chatHistories || {},
      favicons: saved.favicons || {},
    };
  }

  // Old format: flat tabs array
  if (saved.tabs?.length) {
    const ws: Workspace = {
      id: 1,
      name: '',
      tabs: saved.tabs,
      activeTabId: saved.activeTabId,
    };
    return {
      state: {
        workspaces: [ws],
        activeWorkspaceId: 1,
        nextWorkspaceId: 2,
        nextTabId: saved.nextTabId,
      },
      chatHistories: saved.chatHistories || {},
      favicons: saved.favicons || {},
    };
  }

  return null;
}

export default function App() {
  const [appState, dispatch] = useReducer(appReducer, {
    workspaces: [],
    activeWorkspaceId: -1,
    nextWorkspaceId: 0,
    nextTabId: 0,
  });

  const [tabSidebarOpen, setTabSidebarOpen] = useState(true);
  const openSettings = useCallback(() => window.browser.openSettings(), []);
  const [font, setFont] = useState<'geist' | 'pt-serif'>('pt-serif');
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

  // Derived values
  const activeWorkspace = appState.workspaces.find(w => w.id === appState.activeWorkspaceId);
  const activeTab = activeWorkspace?.tabs.find(t => t.id === activeWorkspace.activeTabId);
  const allTabs = useMemo(() => appState.workspaces.flatMap(w => w.tabs), [appState.workspaces]);

  const activeTabIdRef = useRef(activeTab?.id ?? -1);
  activeTabIdRef.current = activeTab?.id ?? -1;

  useEffect(() => {
    if (activeTab) {
      document.title = activeTab.title;
    }
  }, [activeTab?.title, activeTab?.id]);

  useEffect(() => {
    const ff = font === 'geist' ? 'Geist, sans-serif' : "'PT Serif', serif";
    document.documentElement.style.fontFamily = ff;
    document.body.style.fontFamily = ff;
  }, [font]);

  useEffect(() => {
    (async () => {
      const saved = await window.browser.loadTabs();
      const migrated = migrateLoadedState(saved);
      if (migrated) {
        dispatch({ type: 'RESTORE', state: migrated.state });
        setChatHistories(migrated.chatHistories);
        setFavicons(migrated.favicons);
      } else {
        dispatch({ type: 'CREATE_WORKSPACE' });
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
        workspaces: appState.workspaces,
        activeWorkspaceId: appState.activeWorkspaceId,
        nextWorkspaceId: appState.nextWorkspaceId,
        nextTabId: appState.nextTabId,
        chatHistories,
        favicons,
      });
    }, 500);
  }, [appState, chatHistories, favicons, initialized]);

  const historySaveRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!initialized) return;
    if (historySaveRef.current) clearTimeout(historySaveRef.current);
    historySaveRef.current = setTimeout(() => {
      window.browser.saveHistory(visitHistory);
    }, 2000);
  }, [visitHistory, initialized]);

  const handleCloseTab = useCallback((tabId: number) => {
    dispatch({ type: 'CLOSE_TAB', tabId });
    setChatHistories(prev => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const handleCloseWorkspace = useCallback((workspaceId: number) => {
    const ws = appState.workspaces.find(w => w.id === workspaceId);
    if (ws) {
      // Clean up chat histories for all tabs in the workspace
      setChatHistories(prev => {
        const next = { ...prev };
        for (const tab of ws.tabs) {
          delete next[tab.id];
        }
        return next;
      });
    }
    dispatch({ type: 'CLOSE_WORKSPACE', workspaceId });
  }, [appState.workspaces]);

  const handleTabUpdate = useCallback((id: number, updates: { title?: string; url?: string }) => {
    dispatch({ type: 'UPDATE_TAB', tabId: id, ...updates });
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
        const tab = allTabs.find(t => t.id === id);
        if (!tab?.url) return prev;
        return prev.map(h => h.url === tab.url ? { ...h, title: updates.title! } : h);
      });
    }
  }, [allTabs]);

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
    dispatch({ type: 'UPDATE_TAB', tabId, title });
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
        if (activeTab) {
          handleCloseTab(activeTab.id);
        }
      } else if (e.metaKey && e.key === 'f') {
        e.preventDefault();
        setFindOpen(prev => !prev);
      } else if (e.metaKey && e.altKey && e.key === 'ArrowUp') {
        // Switch to previous workspace
        e.preventDefault();
        const idx = appState.workspaces.findIndex(w => w.id === appState.activeWorkspaceId);
        if (idx > 0) {
          dispatch({ type: 'SWITCH_WORKSPACE', workspaceId: appState.workspaces[idx - 1].id });
        }
      } else if (e.metaKey && e.altKey && e.key === 'ArrowDown') {
        // Switch to next workspace
        e.preventDefault();
        const idx = appState.workspaces.findIndex(w => w.id === appState.activeWorkspaceId);
        if (idx < appState.workspaces.length - 1) {
          dispatch({ type: 'SWITCH_WORKSPACE', workspaceId: appState.workspaces[idx + 1].id });
        }
      } else if (e.metaKey && e.shiftKey && (e.key === '[' || e.key === '{')) {
        // Switch to previous tab in workspace
        e.preventDefault();
        if (activeWorkspace && activeWorkspace.tabs.length > 1) {
          const idx = activeWorkspace.tabs.findIndex(t => t.id === activeWorkspace.activeTabId);
          if (idx > 0) {
            dispatch({ type: 'SWITCH_TAB', tabId: activeWorkspace.tabs[idx - 1].id });
            setUnreadTabs(prev => ({ ...prev, [activeWorkspace.tabs[idx - 1].id]: false }));
          }
        }
      } else if (e.metaKey && e.shiftKey && (e.key === ']' || e.key === '}')) {
        // Switch to next tab in workspace
        e.preventDefault();
        if (activeWorkspace && activeWorkspace.tabs.length > 1) {
          const idx = activeWorkspace.tabs.findIndex(t => t.id === activeWorkspace.activeTabId);
          if (idx < activeWorkspace.tabs.length - 1) {
            dispatch({ type: 'SWITCH_TAB', tabId: activeWorkspace.tabs[idx + 1].id });
            setUnreadTabs(prev => ({ ...prev, [activeWorkspace.tabs[idx + 1].id]: false }));
          }
        }
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [appState.activeWorkspaceId, appState.workspaces, activeWorkspace, activeTab, handleCloseTab, findOpen]);

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
      dispatch({ type: 'CONVERT_TAB', tabId: activeTab.id, url });
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
      const newTabId = appState.nextTabId;
      dispatch({ type: 'CREATE_TAB' });
      setInitialQueries(prev => ({ ...prev, [newTabId]: query }));
    }
  }, [activeTab?.type, activeTab?.id, chatHistories, appState.nextTabId]);

  const isChat = activeTab?.type === 'chat';
  const isMessages = activeTab?.type === 'messages';
  const isNonPage = activeTab?.type !== 'page';

  return (
    <div className="flex h-full w-full">
      <div className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${tabSidebarOpen ? 'w-[200px]' : 'w-0'}`}>
      <WorkspaceSidebar
        workspaces={appState.workspaces}
        activeWorkspaceId={appState.activeWorkspaceId}
        loadingTabs={loadingTabs}
        favicons={favicons}
        thinkingTabs={thinkingTabs}
        unreadTabs={unreadTabs}
        onSwitch={(wsId) => {
          dispatch({ type: 'SWITCH_WORKSPACE', workspaceId: wsId });
        }}
        onClose={handleCloseWorkspace}
        onRename={(wsId, name) => dispatch({ type: 'RENAME_WORKSPACE', workspaceId: wsId, name })}
        onCreate={() => dispatch({ type: 'CREATE_WORKSPACE' })}
        onGenerateTodos={() => {
          const newTabId = appState.nextTabId;
          dispatch({ type: 'CREATE_WORKSPACE' });
          setInitialQueries(prev => ({ ...prev, [newTabId]: 'say hi openai!' }));
        }}
        onReorder={(workspaces) => dispatch({ type: 'REORDER_WORKSPACES', workspaces })}
        onOpenSettings={openSettings}
      />
      </div>
      <div className="flex-1 flex flex-col min-w-0 h-full bg-white dark:bg-[#111]">
        {activeWorkspace && activeWorkspace.tabs.length >= 2 && (
          <HorizontalTabBar
            tabs={activeWorkspace.tabs}
            activeTabId={activeWorkspace.activeTabId}
            loadingTabs={loadingTabs}
            favicons={favicons}
            thinkingTabs={thinkingTabs}
            unreadTabs={unreadTabs}
            onSwitch={(tabId) => {
              dispatch({ type: 'SWITCH_TAB', tabId });
              setUnreadTabs(prev => ({ ...prev, [tabId]: false }));
            }}
            onClose={handleCloseTab}
            onToggleTabSidebar={() => setTabSidebarOpen(prev => !prev)}
            tabSidebarOpen={tabSidebarOpen}
            onCreateTab={() => dispatch({ type: 'CREATE_TAB' })}
          />
        )}
        {!(isNonPage && activeWorkspace && activeWorkspace.tabs.length >= 2) && (
          <Toolbar
            activeUrl={activeTab?.url || ''}
            loading={activeTab ? !!loadingTabs[activeTab.id] : false}
            onNavigate={handleNavigate}
            onSearch={handleSearch}
            onBack={() => webviewRef.current?.goBack()}
            onForward={() => webviewRef.current?.goForward()}
            onReload={() => webviewRef.current?.reload()}
            onToggleTabSidebar={() => setTabSidebarOpen(prev => !prev)}
            tabSidebarOpen={tabSidebarOpen}
            onOpenSettings={openSettings}
            isChatTab={isChat || isMessages}
            allTabs={allTabs}
            visitHistory={visitHistory}
            onCreateTab={() => dispatch({ type: 'CREATE_TAB' })}
            hasTabBar={!!activeWorkspace && activeWorkspace.tabs.length >= 2}
            onOpenSpecialTab={(tabType) => dispatch({ type: 'CREATE_TAB', tabType })}
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
          {allTabs.filter(t => t.type === 'chat').map(tab => (
            <ChatView
              key={tab.id}
              tabId={tab.id}
              tabTitle={tab.title}
              hidden={tab.id !== activeTab?.id}
              messages={chatHistories[tab.id] || []}
              onMessagesChange={handleChatMessagesChange}
              onTitleChange={handleChatTitleChange}
              onNavigate={(url) => dispatch({ type: 'CONVERT_TAB', tabId: tab.id, url })}
              onOpenLink={(url) => dispatch({ type: 'CREATE_TAB', url })}
              onThinkingChange={handleThinkingChange}
              initialQuery={initialQueries[tab.id]}
              onInitialQueryConsumed={(tabId) => setInitialQueries(prev => { const next = { ...prev }; delete next[tabId]; return next; })}
              visitHistory={visitHistory}
              onOpenSpecialTab={() => dispatch({ type: 'CREATE_TAB', tabType: 'messages' })}
            />
          ))}
          {allTabs.filter(t => t.type === 'messages').map(tab => (
            <MessagesView key={tab.id} tabId={tab.id} hidden={tab.id !== activeTab?.id} />
          ))}
          <WebviewContainer
            ref={webviewRef}
            tabs={allTabs}
            activeTabId={activeTab?.id ?? -1}
            onTabUpdate={handleTabUpdate}
            onLoadingChange={handleLoadingChange}
            onFaviconChange={handleFaviconChange}
            hidden={isNonPage}
          />
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
