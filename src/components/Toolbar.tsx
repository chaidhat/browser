import { useState, useEffect, useRef } from 'react';
import { FiChevronLeft, FiChevronRight, FiRefreshCw, FiMessageSquare, FiSettings } from 'react-icons/fi';
import { resolveUrl, isUrl } from '../utils/navigate';

interface Props {
  activeUrl: string;
  loading: boolean;
  sidebarOpen: boolean;
  onNavigate: (url: string) => void;
  onSearch: (query: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  isChatTab?: boolean;
}

const btnClass = "w-8 h-8 border-none rounded-md bg-transparent text-neutral-500 dark:text-neutral-400 cursor-pointer flex items-center justify-center transition-colors hover:bg-black/6 dark:hover:bg-white/6 hover:text-black dark:hover:text-neutral-200 active:bg-black/10 dark:active:bg-white/12";

export function Toolbar({
  activeUrl, loading, sidebarOpen,
  onNavigate, onSearch, onBack, onForward, onReload,
  onToggleChat, onOpenSettings, isChatTab,
}: Props) {
  const [urlValue, setUrlValue] = useState(activeUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUrlValue(activeUrl);
  }, [activeUrl]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const value = urlValue.trim();
      if (!value) return;
      inputRef.current?.blur();
      if (e.metaKey) {
        // Cmd+Enter → always Google
        onNavigate(`https://www.google.com/search?q=${encodeURIComponent(value)}`);
      } else if (isUrl(value)) {
        // Looks like a URL → navigate directly
        onNavigate(resolveUrl(value));
      } else {
        // Plain text → chat + serper
        onSearch(value);
      }
    }
  };

  return (
    <div className="flex items-center h-12 px-3 gap-2 bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-300 dark:border-neutral-700 drag">
      <div className="flex gap-0.5 no-drag">
        <button className={btnClass} title="Back" onClick={onBack}>
          <FiChevronLeft size={16} />
        </button>
        <button className={btnClass} title="Forward" onClick={onForward}>
          <FiChevronRight size={16} />
        </button>
        <button className={btnClass} title="Reload" onClick={onReload}>
          <FiRefreshCw size={14} />
        </button>
      </div>
      <div className="flex-1 no-drag">
        <input
          ref={inputRef}
          type="text"
          className={`w-full h-8 px-3.5 border-none rounded-lg bg-neutral-100 dark:bg-neutral-900 text-black dark:text-neutral-200 text-[13px] outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500 ${loading ? 'bg-[length:200%_100%] animate-loading bg-gradient-to-r from-white via-neutral-100 to-white dark:from-neutral-700 dark:via-neutral-600 dark:to-neutral-700' : ''}`}
          placeholder="Search or enter URL"
          spellCheck={false}
          autoComplete="off"
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => inputRef.current?.select()}
        />
      </div>
      <div className="flex gap-0.5 no-drag">
        {!isChatTab && (
          <button
            className={`${btnClass} ${sidebarOpen ? 'bg-black/10 dark:bg-white/12 text-black dark:text-neutral-200' : ''}`}
            title="AI Chat"
            onClick={onToggleChat}
          >
            <FiMessageSquare size={16} />
          </button>
        )}
        <button className={btnClass} title="Settings" onClick={onOpenSettings}>
          <FiSettings size={16} />
        </button>
      </div>
    </div>
  );
}
