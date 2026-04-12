import { useState, useRef, useCallback } from 'react';
import { FiX, FiSidebar, FiPlus, FiInbox, FiFileText, FiClock } from 'react-icons/fi';
import type { TabInfo } from './WebviewContainer';
import type { Workspace } from './TabSidebar';

interface Props {
  tabs: TabInfo[];
  activeTabId: number;
  loadingTabs: Record<number, boolean>;
  favicons: Record<number, string>;
  thinkingTabs: Record<number, boolean>;
  unreadTabs: Record<number, boolean>;
  onSwitch: (id: number) => void;
  onClose: (id: number) => void;
  onToggleTabSidebar: () => void;
  tabSidebarOpen: boolean;
  onCreateTab: () => void;
  onReorderTabs: (tabs: TabInfo[]) => void;
  onMoveTabToWorkspace: (tabId: number, targetWorkspaceId: number) => void;
  workspaces: Workspace[];
  activeWorkspaceId: number;
}

const btnClass = "w-8 h-8 border-none rounded-md bg-transparent text-neutral-500 dark:text-neutral-400 cursor-pointer flex items-center justify-center transition-colors hover:bg-black/6 dark:hover:bg-white/6 hover:text-black dark:hover:text-neutral-200 active:bg-black/10 dark:active:bg-white/12";

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function HorizontalTabBar({ tabs, activeTabId, loadingTabs, favicons, thinkingTabs, unreadTabs, onSwitch, onClose, onToggleTabSidebar, tabSidebarOpen, onCreateTab, onReorderTabs, onMoveTabToWorkspace, workspaces, activeWorkspaceId }: Props) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragStartX = useRef(0);
  const didDrag = useRef(false);


  const handleDragStart = useCallback((e: React.MouseEvent, tabId: number) => {
    if (e.button !== 0) return;
    dragStartX.current = e.clientX;
    didDrag.current = false;
    setDragId(tabId);

    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - dragStartX.current) > 4) didDrag.current = true;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setDragId(null);
      setDropIndex(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const srcIdStr = e.dataTransfer.getData('text/tab-id');
    if (!srcIdStr) return;
    const srcId = parseInt(srcIdStr, 10);
    const srcIndex = tabs.findIndex(t => t.id === srcId);
    if (srcIndex === -1 || srcIndex === targetIndex) { setDropIndex(null); return; }
    const newTabs = [...tabs];
    const [moved] = newTabs.splice(srcIndex, 1);
    const insertAt = targetIndex > srcIndex ? targetIndex - 1 : targetIndex;
    newTabs.splice(insertAt, 0, moved);
    onReorderTabs(newTabs);
    setDropIndex(null);
  }, [tabs, onReorderTabs]);

  const handleContextMenu = useCallback(async (e: React.MouseEvent, tabId: number) => {
    e.preventDefault();
    e.stopPropagation();
    const otherWs = workspaces.filter(w => w.id !== activeWorkspaceId && !w.archived);
    const items: { label: string; id: string }[] = [
      { label: 'Close Tab', id: 'close' },
    ];
    if (otherWs.length > 0) {
      for (const ws of otherWs) {
        items.push({
          label: `Move to ${ws.name || ws.tabs[0]?.title || 'Workspace'}`,
          id: `move:${ws.id}`,
        });
      }
    }
    const action = await window.browser.showContextMenu(items);
    if (action === 'close') onClose(tabId);
    else if (action?.startsWith('move:')) onMoveTabToWorkspace(tabId, parseInt(action.slice(5), 10));
  }, [workspaces, activeWorkspaceId, onMoveTabToWorkspace, onClose]);

  return (
    <div className={`flex items-center h-11 gap-px px-3 bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-300 dark:border-neutral-700 shrink-0 drag ${tabSidebarOpen ? '' : 'pl-[88px]'}`} style={{ transition: 'padding-left 200ms ease-in-out' }}>
      <div className="flex gap-0.5 shrink-0 no-drag h-8">
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
      </div>
      <div
        className="ml-2 flex items-center gap-px gap-x-1 overflow-x-auto min-w-0 no-drag scrollbar-none"
        onDragOver={(e) => e.preventDefault()}
      >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isLoading = tab.type === 'page' && loadingTabs[tab.id];
        const favicon = tab.type === 'page' && favicons[tab.id];
        const isChat = tab.type === 'chat';
        const isMessages = tab.type === 'messages';
        const isNotes = tab.type === 'notes';
        const isHistory = tab.type === 'history';
        const isThinking = isChat && thinkingTabs[tab.id];
        const isUnread = !isActive && unreadTabs[tab.id];
        const isDragging = dragId === tab.id;
        const isDropTarget = dropIndex === index && dragId !== null && dragId !== tab.id;

        return (
          <div
            key={tab.id}
            className="relative flex items-center shrink-0"
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
          >
            {isDropTarget && <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-blue-500 -translate-x-1 z-10" />}
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/tab-id', String(tab.id));
                e.dataTransfer.effectAllowed = 'move';
                setDragId(tab.id);
              }}
              onDragEnd={() => { setDragId(null); setDropIndex(null); }}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              className={`flex items-center gap-1.5 h-8 px-3 rounded cursor-pointer text-xs select-none group max-w-[200px] min-w-[60px] shrink-0 transition-all
                ${isActive
                  ? 'bg-white dark:bg-white/12 text-black dark:text-neutral-200'
                  : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/6'
                }
                ${isDragging ? 'opacity-40' : ''}
              `}
              onClick={() => onSwitch(tab.id)}
            >
            {isLoading ? (
              <Spinner />
            ) : favicon ? (
              <img src={favicon} className="w-3 h-3 shrink-0 rounded-sm" alt="" />
            ) : isMessages ? (
              <FiInbox size={12} className="shrink-0 text-black dark:text-white" />
            ) : isNotes ? (
              <FiFileText size={12} className="shrink-0 text-black dark:text-white" />
            ) : isHistory ? (
              <FiClock size={12} className="shrink-0 text-black dark:text-white" />
            ) : isUnread ? (
              <div className="w-2 h-2 shrink-0 rounded-full bg-blue-500" />
            ) : !isChat ? (
              <div className="w-3 h-3 shrink-0 rounded-sm bg-neutral-300 dark:bg-neutral-600" />
            ) : null}
            <span className={`overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0 leading-none ${isThinking ? 'bg-gradient-to-r from-neutral-300 via-neutral-500 to-neutral-300 dark:from-neutral-600 dark:via-neutral-300 dark:to-neutral-600 bg-[length:200%_100%] bg-clip-text [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] animate-shimmer' : ''}`}>
              {tab.title}
            </span>
            {tabs.length > 1 && (
              <button
                className="tab-close-btn w-4 h-4 border-none rounded bg-transparent text-neutral-400 dark:text-neutral-500 cursor-pointer flex items-center justify-center shrink-0 p-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-neutral-200"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <FiX size={9} />
              </button>
            )}
            </div>
          </div>
        );
      })}
      </div>

    </div>
  );
}
