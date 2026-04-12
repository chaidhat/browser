import { useState, useRef } from 'react';
import { FiX, FiPlus, FiSettings, FiInbox, FiClock, FiFileText } from 'react-icons/fi';
import type { TabInfo } from './WebviewContainer';

export interface Workspace {
  id: number;
  name: string;
  tabs: TabInfo[];
  activeTabId: number;
  archived?: boolean;
}

interface Props {
  workspaces: Workspace[];
  activeWorkspaceId: number;
  loadingTabs: Record<number, boolean>;
  favicons: Record<number, string>;
  thinkingTabs: Record<number, boolean>;
  unreadTabs: Record<number, boolean>;
  onSwitch: (workspaceId: number) => void;
  onClose: (workspaceId: number) => void;
  onRename: (workspaceId: number, name: string) => void;
  onCreate: () => void;
  onReorder: (workspaces: Workspace[]) => void;
  onOpenSettings: () => void;
  onResizeStart?: (e: React.MouseEvent) => void;
}

function Spinner() {
  return (
    <svg className="animate-spin w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function getWorkspaceDisplay(ws: Workspace) {
  const activeTab = ws.tabs.find(t => t.id === ws.activeTabId) || ws.tabs[0];
  const name = ws.name || activeTab?.title || 'New Workspace';
  return { name, activeTab };
}

export function WorkspaceSidebar({ workspaces, activeWorkspaceId, loadingTabs, favicons, thinkingTabs, unreadTabs, onSwitch, onClose, onRename, onCreate, onReorder, onOpenSettings, onResizeStart }: Props) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: number; position: 'before' | 'after' } | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastClickedRef = useRef<number | null>(null);

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDragId(id);
    dragNodeRef.current = e.currentTarget as HTMLDivElement;
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => {
      if (dragNodeRef.current) dragNodeRef.current.style.opacity = '0.4';
    });
  };

  const handleDragEnd = () => {
    if (dragNodeRef.current) dragNodeRef.current.style.opacity = '1';
    if (dragId !== null && dropTarget !== null) {
      const fromIdx = workspaces.findIndex(w => w.id === dragId);
      const targetIdx = workspaces.findIndex(w => w.id === dropTarget.id);
      if (fromIdx !== -1 && targetIdx !== -1 && fromIdx !== targetIdx) {
        const reordered = [...workspaces];
        const [moved] = reordered.splice(fromIdx, 1);
        let insertIdx = targetIdx;
        if (fromIdx < targetIdx) insertIdx--;
        if (dropTarget.position === 'after') insertIdx++;
        reordered.splice(insertIdx, 0, moved);
        onReorder(reordered);
      }
    }
    setDragId(null);
    setDropTarget(null);
  };

  const handleDragOver = (e: React.DragEvent, id: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id === dragId) {
      setDropTarget(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';
    setDropTarget({ id, position });
  };

  return (
    <div className="flex-1 min-w-0 h-full bg-transparent flex flex-col p-2 pt-[44px] gap-0.5 shrink-0 relative drag border-r border-black/10 dark:border-white/8">
      <div className="absolute top-0 left-0 right-0 h-[38px] drag" />
      <div className="flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden flex-1 min-h-0 no-drag scrollbar-none">
        {workspaces.map(ws => {
          const { name, activeTab } = getWorkspaceDisplay(ws);
          const isLoading = activeTab?.type === 'page' && loadingTabs[activeTab.id];
          const favicon = activeTab?.type === 'page' && favicons[activeTab.id];
          const isChat = activeTab?.type === 'chat';
          const isMessages = activeTab?.type === 'messages';
          const isHistory = activeTab?.type === 'history';
          const isNotes = activeTab?.type === 'notes';
          const isPinnedMessages = ws.name === 'Messages' && ws.tabs.some(t => t.type === 'messages');
          const isPinnedHistory = ws.name === 'History' && ws.tabs.some(t => t.type === 'history');
          const isPinned = isPinnedMessages || isPinnedHistory;
          const isThinking = ws.tabs.some(t => t.type === 'chat' && thinkingTabs[t.id]);
          const isUnread = ws.tabs.some(t => unreadTabs[t.id]) && ws.id !== activeWorkspaceId;
          const showLineBefore = dropTarget?.id === ws.id && dropTarget.position === 'before' && dragId !== ws.id;
          const showLineAfter = dropTarget?.id === ws.id && dropTarget.position === 'after' && dragId !== ws.id;
          const tabCount = ws.tabs.length;

          return (
            <div key={ws.id} className="relative">
              {showLineBefore && (
                <div className="absolute top-0 left-2 right-2 h-[2px] bg-blue-500 rounded-full -translate-y-[1px] z-10 pointer-events-none" />
              )}
              <div
                draggable={!isPinned}
                onDragStart={(e) => { if (isPinned) { e.preventDefault(); return; } handleDragStart(e, ws.id); }}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, ws.id)}
                onDragLeave={() => { if (dropTarget?.id === ws.id) setDropTarget(null); }}
                onDrop={(e) => { e.preventDefault(); }}
                className={`flex items-center h-9 px-2.5 gap-2 rounded-md cursor-pointer shrink-0 transition-colors text-xs select-none group no-drag
                  ${selectedIds.has(ws.id)
                    ? 'bg-black/8 dark:bg-white/8 text-neutral-400 dark:text-neutral-500'
                    : ws.id === activeWorkspaceId
                    ? 'bg-white/60 dark:bg-white/12 text-black dark:text-neutral-200'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/6'
                  }`}
                onContextMenu={async (e) => {
                  e.preventDefault();
                  // Include this workspace in selection if not already
                  const sel = new Set(selectedIds);
                  if (!sel.has(ws.id)) sel.add(ws.id);
                  const count = sel.size;
                  const items = count > 1
                    ? [{ label: `Close ${count} Workspaces`, id: 'close-multi' }]
                    : [
                        { label: 'Rename Workspace', id: 'rename' },
                        { label: 'Close Workspace', id: 'close' },
                      ];
                  const action = await window.browser.showContextMenu(items);
                  if (action === 'close') {
                    onClose(ws.id);
                    setSelectedIds(new Set());
                  }
                  if (action === 'close-multi') {
                    for (const id of sel) onClose(id);
                    setSelectedIds(new Set());
                  }
                  if (action === 'rename') {
                    const { name: currentName } = getWorkspaceDisplay(ws);
                    setRenamingId(ws.id);
                    setRenameValue(currentName);
                    requestAnimationFrame(() => renameInputRef.current?.select());
                  }
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('.tab-close-btn')) return;
                  if (e.shiftKey && lastClickedRef.current !== null) {
                    // Range select from last clicked to current
                    const wsIds = workspaces.map(w => w.id);
                    const lastIdx = wsIds.indexOf(lastClickedRef.current);
                    const curIdx = wsIds.indexOf(ws.id);
                    if (lastIdx !== -1 && curIdx !== -1) {
                      const from = Math.min(lastIdx, curIdx);
                      const to = Math.max(lastIdx, curIdx);
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        for (let i = from; i <= to; i++) next.add(wsIds[i]);
                        return next;
                      });
                    }
                  } else if (e.metaKey) {
                    // Toggle individual
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(ws.id)) next.delete(ws.id);
                      else next.add(ws.id);
                      return next;
                    });
                    lastClickedRef.current = ws.id;
                  } else {
                    setSelectedIds(new Set());
                    lastClickedRef.current = ws.id;
                    onSwitch(ws.id);
                  }
                }}
              >
                {isLoading ? (
                  <Spinner />
                ) : favicon ? (
                  <img src={favicon} className="w-3.5 h-3.5 shrink-0 rounded-sm" alt="" />
                ) : isMessages ? (
                  <FiInbox size={13} className="shrink-0 text-black dark:text-white" />
                ) : isHistory ? (
                  <FiClock size={13} className="shrink-0 text-black dark:text-white" />
                ) : isNotes ? (
                  <FiFileText size={13} className="shrink-0 text-black dark:text-white" />
                ) : isChat && isUnread ? (
                  <div className="w-2 h-2 shrink-0 rounded-full bg-blue-500" />
                ) : isChat ? (
                  null
                ) : (
                  <div className="w-3.5 h-3.5 shrink-0 rounded-sm bg-neutral-300 dark:bg-neutral-600" />
                )}
                {renamingId === ws.id ? (
                  <input
                    ref={renameInputRef}
                    className="flex-1 min-w-0 text-xs leading-none bg-transparent border-none outline-none text-black dark:text-neutral-200 p-0 m-0"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => {
                      const trimmed = renameValue.trim();
                      onRename(ws.id, trimmed);
                      setRenamingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      } else if (e.key === 'Escape') {
                        setRenamingId(null);
                      }
                    }}
                  />
                ) : (
                  <span className={`overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0 text-xs leading-none ${isThinking ? 'bg-gradient-to-r from-neutral-300 via-neutral-500 to-neutral-300 dark:from-neutral-600 dark:via-neutral-300 dark:to-neutral-600 bg-[length:200%_100%] bg-clip-text [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] animate-shimmer' : ''}`}>
                    {name}
                  </span>
                )}
                {tabCount > 1 && (
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">{tabCount}</span>
                )}
                {!isPinned && <button
                  className="tab-close-btn w-[18px] h-[18px] border-none rounded bg-transparent text-neutral-400 dark:text-neutral-500 cursor-pointer flex items-center justify-center shrink-0 p-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-neutral-200"
                  title="Close workspace"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(ws.id);
                  }}
                >
                  <FiX size={10} />
                </button>}
              </div>
              {showLineAfter && (
                <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-blue-500 rounded-full translate-y-[1px] z-10 pointer-events-none" />
              )}
              {isPinnedHistory && (
                <div className="mx-2.5 mt-1 mb-0.5 border-b border-black/10 dark:border-white/8" />
              )}
            </div>
          );
        })}
        <button
          className="w-full h-[30px] border-none rounded-md bg-transparent text-neutral-500 dark:text-neutral-400 cursor-pointer flex items-center px-2.5 gap-1.5 shrink-0 no-drag mt-0.5 transition-colors hover:bg-black/8 dark:hover:bg-white/8 hover:text-black dark:hover:text-neutral-200 text-xs select-none"
          title="New Workspace"
          onClick={onCreate}
        >
          <FiPlus size={13} />
          <span>Add Workspace</span>
        </button>
      </div>
      <button
        className="w-full h-[30px] border-none rounded-md bg-transparent text-neutral-500 dark:text-neutral-400 cursor-pointer flex items-center px-2.5 gap-1.5 shrink-0 no-drag transition-colors hover:bg-black/8 dark:hover:bg-white/8 hover:text-black dark:hover:text-neutral-200 text-xs select-none mb-1"
        title="Settings"
        onClick={onOpenSettings}
      >
        <FiSettings size={13} />
        <span>Settings</span>
      </button>
      {/* Resize handle on right edge */}
      <div
        className="absolute top-0 right-0 w-[6px] h-full cursor-col-resize no-drag z-10"
        onMouseDown={onResizeStart}
      />
    </div>
  );
}
