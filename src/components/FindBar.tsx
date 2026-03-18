import { useState, useRef, useEffect, useCallback } from 'react';
import { FiChevronUp, FiChevronDown, FiX } from 'react-icons/fi';

interface Props {
  onFind: (text: string, forward: boolean) => void;
  onClose: () => void;
  matchCount: number;
  activeMatch: number;
}

export function FindBar({ onFind, onClose, matchCount, activeMatch }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const findAndRefocus = useCallback((text: string, forward: boolean) => {
    onFind(text, forward);
  }, [onFind]);

  const handleChange = useCallback((value: string) => {
    setQuery(value);
    if (value) {
      findAndRefocus(value, true);
    }
  }, [findAndRefocus]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (query) findAndRefocus(query, !e.shiftKey);
    }
  }, [onClose, findAndRefocus, query]);

  return (
    <div className="absolute top-0 right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-b-lg shadow-lg">
      <input
        ref={inputRef}
        type="text"
        className="w-48 h-7 px-2 text-[13px] bg-neutral-100 dark:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 rounded text-black dark:text-neutral-200 outline-none focus:border-blue-400"
        placeholder="Find in page"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {query && (
        <span className="text-xs text-neutral-400 min-w-[3rem] text-center">
          {matchCount > 0 ? `${activeMatch}/${matchCount}` : 'No matches'}
        </span>
      )}
      <button
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 text-neutral-500 dark:text-neutral-400"
        title="Previous (Shift+Enter)"
        onClick={() => query && findAndRefocus(query, false)}
      >
        <FiChevronUp size={14} />
      </button>
      <button
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 text-neutral-500 dark:text-neutral-400"
        title="Next (Enter)"
        onClick={() => query && findAndRefocus(query, true)}
      >
        <FiChevronDown size={14} />
      </button>
      <button
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 text-neutral-500 dark:text-neutral-400"
        title="Close (Esc)"
        onClick={onClose}
      >
        <FiX size={14} />
      </button>
    </div>
  );
}
