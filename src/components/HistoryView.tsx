import { useState, useRef } from 'react';
import { FiRotateCcw, FiTrash2 } from 'react-icons/fi';
import type { Workspace } from './TabSidebar';

interface Props {
  tabId: number;
  hidden?: boolean;
  archivedWorkspaces: Workspace[];
  onRestore: (workspaceId: number) => void;
  onDelete: (workspaceId: number) => void;
}

export function HistoryView({ tabId, hidden, archivedWorkspaces, onRestore, onDelete }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastClickedRef = useRef<number | null>(null);

  const handleClick = (wsId: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedRef.current !== null) {
      // Range select
      const ids = archivedWorkspaces.map(w => w.id);
      const lastIdx = ids.indexOf(lastClickedRef.current);
      const curIdx = ids.indexOf(wsId);
      if (lastIdx !== -1 && curIdx !== -1) {
        const from = Math.min(lastIdx, curIdx);
        const to = Math.max(lastIdx, curIdx);
        setSelectedIds(prev => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(ids[i]);
          return next;
        });
      }
    } else if (e.metaKey) {
      // Toggle individual
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(wsId)) next.delete(wsId);
        else next.add(wsId);
        return next;
      });
      lastClickedRef.current = wsId;
    } else {
      // Single select
      setSelectedIds(new Set([wsId]));
      lastClickedRef.current = wsId;
    }
  };

  const handleRestoreSelected = () => {
    for (const id of selectedIds) onRestore(id);
    setSelectedIds(new Set());
  };

  const handleDeleteSelected = () => {
    for (const id of selectedIds) onDelete(id);
    setSelectedIds(new Set());
  };

  const selCount = selectedIds.size;

  return (
    <div className={`absolute inset-0 flex flex-col bg-white dark:bg-[#111] ${hidden ? 'invisible' : ''}`} data-tab-id={tabId}>
      <div className="flex items-center gap-2 px-4 h-11 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <FiRotateCcw size={16} className="text-neutral-500" />
        <span className="text-[15px] font-medium text-neutral-800 dark:text-neutral-200">History</span>
        <span className="text-[11px] text-neutral-400">{archivedWorkspaces.length} archived</span>
        <div className="flex-1" />
        {selCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-neutral-400">{selCount} selected</span>
            <button
              onClick={handleRestoreSelected}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border-none bg-transparent cursor-pointer"
            >
              <FiRotateCcw size={11} /> Restore
            </button>
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border-none bg-transparent cursor-pointer"
            >
              <FiTrash2 size={11} /> Delete
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {archivedWorkspaces.length === 0 && (
          <div className="flex items-center justify-center h-full text-neutral-400 text-[14px]">No archived workspaces</div>
        )}
        {archivedWorkspaces.map(ws => {
          const name = ws.name || ws.tabs[0]?.title || 'Untitled';
          const tabCount = ws.tabs.length;
          const tabTypes = ws.tabs.map(t => t.type).filter((v, i, a) => a.indexOf(v) === i).join(', ');
          const isSelected = selectedIds.has(ws.id);
          return (
            <div
              key={ws.id}
              onClick={(e) => handleClick(ws.id, e)}
              className={`flex items-center gap-3 px-4 h-10 border-b border-neutral-100 dark:border-neutral-800/50 cursor-pointer transition-colors
                ${isSelected
                  ? 'bg-black/8 dark:bg-white/8 text-neutral-400 dark:text-neutral-500'
                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/30'
                }`}
            >
              <span className="text-[13px] text-neutral-800 dark:text-neutral-200 truncate flex-1 min-w-0">
                {name}
              </span>
              <span className="text-[11px] text-neutral-400 shrink-0">
                {tabCount} tab{tabCount !== 1 ? 's' : ''} · {tabTypes}
              </span>
              {selCount === 0 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRestore(ws.id); }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors border-none bg-transparent cursor-pointer"
                  >
                    <FiRotateCcw size={11} /> Restore
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(ws.id); }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border-none bg-transparent cursor-pointer"
                  >
                    <FiTrash2 size={11} />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
