import { useState, useEffect, useRef, useMemo } from 'react';
import { FiChevronLeft, FiChevronRight, FiRefreshCw, FiSidebar, FiPlus } from 'react-icons/fi';
import { resolveUrl, isUrl } from '../utils/navigate';
import { rankedDomains } from '../utils/rankedDomains';

interface TabInfo {
  id: number;
  title: string;
  url: string;
  type: 'chat' | 'page' | 'messages' | 'notes' | 'history';
}

interface HistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  lastVisited: number;
}

interface Suggestion {
  url: string;
  title: string;
}

interface Props {
  activeUrl: string;
  loading: boolean;
  onNavigate: (url: string) => void;
  onSearch: (query: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onToggleTabSidebar: () => void;
  tabSidebarOpen: boolean;
  onOpenSettings: () => void;
  isChatTab?: boolean;
  allTabs?: TabInfo[];
  visitHistory?: HistoryEntry[];
  onCreateTab: () => void;
  hasTabBar?: boolean;
  onOpenSpecialTab?: (tabType: 'messages' | 'notes' | 'history') => void;
}

const btnClass = "w-8 h-8 border-none rounded-md bg-transparent text-neutral-500 dark:text-neutral-400 cursor-pointer flex items-center justify-center transition-colors hover:bg-black/6 dark:hover:bg-white/6 hover:text-black dark:hover:text-neutral-200 active:bg-black/10 dark:active:bg-white/12";

function splitUrl(url: string): { before: string; domain: string; after: string } | null {
  const match = url.match(/^(https?:\/\/)((?:[a-z0-9-]+\.)*[a-z0-9-]+\.[a-z]{2,})(\/.*)?$/i);
  if (!match) return null;
  return { before: match[1], domain: match[2], after: match[3] || '' };
}

export function Toolbar({
  activeUrl, loading,
  onNavigate, onSearch, onBack, onForward, onReload,
  onToggleTabSidebar, tabSidebarOpen, onOpenSettings, isChatTab,
  allTabs = [], visitHistory = [], onCreateTab, hasTabBar, onOpenSpecialTab,
}: Props) {
  const [urlValue, setUrlValue] = useState(activeUrl);
  const [progressState, setProgressState] = useState<'idle' | 'loading' | 'completing'>('idle');

  useEffect(() => {
    if (loading) {
      if (progressState === 'idle') {
        setProgressState('loading');
      }
    } else if (progressState === 'loading') {
      setProgressState('completing');
    }
  }, [loading]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUrlValue(activeUrl);
    setShowDropdown(false);
  }, [activeUrl]);

  const suggestions = useMemo((): Suggestion[] => {
    const q = urlValue.trim().toLowerCase();
    if (!q || q === activeUrl.toLowerCase()) return [];

    const seen = new Set<string>();
    const results: (Suggestion & { score: number })[] = [];

    // Match against open tabs
    for (const tab of allTabs) {
      if (!tab.url || tab.type === 'chat' || seen.has(tab.url)) continue;
      const urlLower = tab.url.toLowerCase();
      const titleLower = (tab.title || '').toLowerCase();
      if (urlLower.includes(q) || titleLower.includes(q)) {
        const domain = urlLower.replace(/^https?:\/\//, '').split('/')[0];
        const score = domain.startsWith(q) ? 100 : urlLower.includes(q) ? 50 : 30;
        results.push({ url: tab.url, title: tab.title, score });
        seen.add(tab.url);
      }
    }

    // Match against visit history
    for (const entry of visitHistory) {
      if (seen.has(entry.url)) continue;
      const urlLower = entry.url.toLowerCase();
      const titleLower = (entry.title || '').toLowerCase();
      if (urlLower.includes(q) || titleLower.includes(q)) {
        const domain = urlLower.replace(/^https?:\/\//, '').split('/')[0];
        const score = domain.startsWith(q) ? 90 : (urlLower.includes(q) ? 40 : 20) + Math.min(entry.visitCount, 10);
        results.push({ url: entry.url, title: entry.title, score });
        seen.add(entry.url);
      }
    }

    // Ranked domains as fallback
    for (const domain of rankedDomains) {
      const url = `https://${domain}`;
      if (seen.has(url)) continue;
      if (domain.includes(q)) {
        const score = domain.startsWith(q) ? 30 : 5;
        results.push({ url, title: '', score });
        seen.add(url);
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 8);
  }, [urlValue, activeUrl, allTabs, visitHistory]);

  // Compute inline ghost completion — the top match whose domain starts with what user typed
  const ghostCompletion = useMemo((): string | null => {
    const q = urlValue.trim().toLowerCase();
    if (!q || !isFocused) return null;

    // Gather all candidate URLs from tabs + history, sorted by relevance
    const candidates: { url: string; score: number }[] = [];
    for (const tab of allTabs) {
      if (tab.url && tab.type !== 'chat') candidates.push({ url: tab.url, score: 50 });
    }
    for (const entry of visitHistory) {
      candidates.push({ url: entry.url, score: 40 + Math.min(entry.visitCount, 10) });
    }

    for (const c of candidates.sort((a, b) => b.score - a.score)) {
      // Strip protocol and www, check if domain starts with query
      const stripped = c.url.replace(/^https?:\/\/(www\.)?/, '');
      if (stripped.toLowerCase().startsWith(q)) {
        return stripped;
      }
    }
    // Fallback to ranked domains
    for (const domain of rankedDomains) {
      if (domain.startsWith(q)) {
        return domain;
      }
    }
    return null;
  }, [urlValue, isFocused, allTabs, visitHistory]);

  useEffect(() => {
    setShowDropdown(suggestions.length > 0);
    setSelectedIndex(-1);
  }, [suggestions]);

  const acceptSuggestion = (s: Suggestion) => {
    setUrlValue(s.url);
    setShowDropdown(false);
    inputRef.current?.blur();
    onNavigate(s.url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab') {
        if (selectedIndex >= 0) {
          e.preventDefault();
          setUrlValue(suggestions[selectedIndex].url);
          setShowDropdown(false);
          return;
        }
        if (ghostCompletion) {
          e.preventDefault();
          setUrlValue(ghostCompletion);
          return;
        }
      }
      if (e.key === 'Escape') {
        setShowDropdown(false);
        return;
      }
    }

    // Tab to accept ghost completion even when dropdown isn't showing
    if (e.key === 'Tab' && ghostCompletion) {
      e.preventDefault();
      setUrlValue(ghostCompletion);
      return;
    }

    if (e.key === 'Enter') {
      if (showDropdown && selectedIndex >= 0) {
        e.preventDefault();
        acceptSuggestion(suggestions[selectedIndex]);
        return;
      }
      const value = urlValue.trim();
      if (!value) return;
      const lower = value.toLowerCase();
      if (lower === 'email' || lower === 'mail' || lower === 'inbox' || lower === 'discord' || lower === 'messages') {
        setShowDropdown(false);
        inputRef.current?.blur();
        setUrlValue('');
        onOpenSpecialTab?.('messages');
        return;
      }
      if (lower === 'notes' || lower === 'note') {
        setShowDropdown(false);
        inputRef.current?.blur();
        setUrlValue('');
        onOpenSpecialTab?.('notes');
        return;
      }
      setShowDropdown(false);
      inputRef.current?.blur();
      if (e.metaKey) {
        onNavigate(`https://www.google.com/search?q=${encodeURIComponent(value)}`);
      } else if (ghostCompletion) {
        // Ghost completion matched — navigate to it
        onNavigate(resolveUrl(ghostCompletion));
      } else if (isUrl(value)) {
        onNavigate(resolveUrl(value));
      } else {
        onSearch(value);
      }
    }
  };

  return (
    <div className={`relative flex items-center h-11 gap-2 bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-300 dark:border-neutral-700 drag pr-3 ${hasTabBar ? 'pl-3' : tabSidebarOpen ? 'pl-3' : 'pl-[88px]'}`} style={{ transition: 'padding-left 200ms ease-in-out' }}>
      <div className="flex gap-0.5 no-drag">
        {!hasTabBar && (
          <>
            <button
              className={`${btnClass} ${tabSidebarOpen ? 'bg-black/10 dark:bg-white/12 text-black dark:text-neutral-200' : ''}`}
              title="Toggle Sidebar"
              onClick={onToggleTabSidebar}
            >
              <FiSidebar size={15} />
            </button>
            <button className={btnClass} title="New Tab" onClick={onCreateTab}>
              <FiPlus size={15} />
            </button>
          </>
        )}
        {!isChatTab && (
          <>
            <button className={btnClass} title="Back" onClick={onBack}>
              <FiChevronLeft size={16} />
            </button>
            <button className={btnClass} title="Forward" onClick={onForward}>
              <FiChevronRight size={16} />
            </button>
            <button className={btnClass} title="Reload" onClick={onReload}>
              <FiRefreshCw size={14} />
            </button>
          </>
        )}
      </div>
      {!isChatTab && (
        <div className="flex-1 no-drag relative">
          <input
            ref={inputRef}
            type="text"
            className={`w-full h-8 px-3.5 border-none rounded-lg bg-neutral-100 dark:bg-neutral-900 text-[13px] outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500 ${isFocused ? 'text-black dark:text-neutral-200' : 'text-transparent'}`}
            placeholder="Search or enter URL"
            spellCheck={false}
            autoComplete="off"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { setIsFocused(true); inputRef.current?.select(); }}
            onBlur={() => { setIsFocused(false); setTimeout(() => setShowDropdown(false), 150); }}
          />
          {/* Inline ghost completion */}
          {isFocused && ghostCompletion && (
            <div className="absolute inset-0 flex items-center px-3.5 text-[13px] pointer-events-none truncate">
              <span className="invisible">{urlValue}</span>
              <span className="text-neutral-400 dark:text-neutral-500">{ghostCompletion.slice(urlValue.trim().length)}</span>
            </div>
          )}
          {!isFocused && urlValue && (() => {
            const parts = splitUrl(urlValue);
            if (parts) {
              return (
                <div className="absolute inset-0 flex items-center px-3.5 text-[13px] pointer-events-none truncate">
                  <span className="text-neutral-400 dark:text-neutral-500">{parts.before}</span>
                  <span className="text-black dark:text-neutral-200">{parts.domain}</span>
                  <span className="text-neutral-400 dark:text-neutral-500">{parts.after}</span>
                </div>
              );
            }
            return (
              <div className="absolute inset-0 flex items-center px-3.5 text-[13px] pointer-events-none truncate text-black dark:text-neutral-200">
                {urlValue}
              </div>
            );
          })()}
          {showDropdown && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg overflow-hidden">
              {suggestions.map((s, i) => (
                <div
                  key={s.url}
                  className={`px-3 py-1.5 text-[13px] cursor-pointer flex items-center gap-2 truncate ${
                    i === selectedIndex
                      ? 'bg-blue-500 text-white'
                      : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                  }`}
                  onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(s); }}
                >
                  <span className="truncate font-medium">{s.title || s.url}</span>
                  {s.title && <span className={`truncate text-[11px] ${i === selectedIndex ? 'text-white/70' : 'text-neutral-400 dark:text-neutral-500'}`}>{s.url}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {isChatTab && <div className="flex-1" />}
      {/* Safari-style progress bar */}
      {progressState !== 'idle' && (
        <div className="absolute -bottom-[1px] left-0 right-0 h-[2px] overflow-hidden z-10">
          <div
            className={`h-full bg-blue-500 ${progressState === 'completing' ? 'animate-progress-complete' : 'animate-progress-bar'}`}
            onAnimationEnd={() => { if (progressState === 'completing') setProgressState('idle'); }}
          />
        </div>
      )}
    </div>
  );
}
