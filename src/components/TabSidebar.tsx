import { useState, useRef } from 'react';
import { FiX, FiPlus, FiSettings } from 'react-icons/fi';
import type { TabInfo } from './WebviewContainer';

export interface Workspace {
  id: number;
  name: string;
  tabs: TabInfo[];
  activeTabId: number;
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
  onCreate: () => void;
  onReorder: (workspaces: Workspace[]) => void;
  onOpenSettings: () => void;
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

export function WorkspaceSidebar({ workspaces, activeWorkspaceId, loadingTabs, favicons, thinkingTabs, unreadTabs, onSwitch, onClose, onCreate, onReorder, onOpenSettings }: Props) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: number; position: 'before' | 'after' } | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);

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
    <div className="w-[200px] h-full bg-transparent flex flex-col p-2 pt-[44px] gap-0.5 shrink-0 relative drag border-r border-black/10 dark:border-white/8">
      <div className="absolute top-0 left-0 right-0 h-[38px] drag" />
      <div className="flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden flex-1 min-h-0 no-drag scrollbar-thin">
        {workspaces.map(ws => {
          const { name, activeTab } = getWorkspaceDisplay(ws);
          const isLoading = activeTab?.type === 'page' && loadingTabs[activeTab.id];
          const favicon = activeTab?.type === 'page' && favicons[activeTab.id];
          const isChat = activeTab?.type === 'chat';
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
                draggable
                onDragStart={(e) => handleDragStart(e, ws.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, ws.id)}
                onDragLeave={() => { if (dropTarget?.id === ws.id) setDropTarget(null); }}
                onDrop={(e) => { e.preventDefault(); }}
                className={`flex items-center h-9 px-2.5 gap-2 rounded-md cursor-pointer shrink-0 transition-colors text-xs select-none group no-drag
                  ${ws.id === activeWorkspaceId
                    ? 'bg-white/60 dark:bg-white/12 text-black dark:text-neutral-200'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/6'
                  }`}
                onContextMenu={async (e) => {
                  e.preventDefault();
                  const items = [
                    { label: 'Close Workspace', id: 'close' },
                  ];
                  const action = await window.browser.showContextMenu(items);
                  if (action === 'close') onClose(ws.id);
                }}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('.tab-close-btn')) {
                    onSwitch(ws.id);
                  }
                }}
              >
                {isLoading ? (
                  <Spinner />
                ) : favicon ? (
                  <img src={favicon} className="w-3.5 h-3.5 shrink-0 rounded-sm" alt="" />
                ) : isChat && isUnread ? (
                  <div className="w-2 h-2 shrink-0 rounded-full bg-blue-500" />
                ) : isChat ? (
                  null
                ) : (
                  <div className="w-3.5 h-3.5 shrink-0 rounded-sm bg-neutral-300 dark:bg-neutral-600" />
                )}
                <span className={`overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0 text-xs leading-none ${isThinking ? 'bg-gradient-to-r from-neutral-300 via-neutral-500 to-neutral-300 dark:from-neutral-600 dark:via-neutral-300 dark:to-neutral-600 bg-[length:200%_100%] bg-clip-text [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] animate-shimmer' : ''}`}>
                  {name}
                </span>
                {tabCount > 1 && (
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">{tabCount}</span>
                )}
                <button
                  className="tab-close-btn w-[18px] h-[18px] border-none rounded bg-transparent text-neutral-400 dark:text-neutral-500 cursor-pointer flex items-center justify-center shrink-0 p-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-neutral-200"
                  title="Close workspace"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(ws.id);
                  }}
                >
                  <FiX size={10} />
                </button>
              </div>
              {showLineAfter && (
                <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-blue-500 rounded-full translate-y-[1px] z-10 pointer-events-none" />
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
    </div>
  );
}
