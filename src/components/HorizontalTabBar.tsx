import { FiX, FiSidebar, FiPlus } from 'react-icons/fi';
import type { TabInfo } from './WebviewContainer';

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
}

const btnClass = "p-1.5 w-8 border-none rounded-md bg-transparent text-neutral-500 dark:text-neutral-400 cursor-pointer flex items-center justify-center transition-colors hover:bg-black/6 dark:hover:bg-white/6 hover:text-black dark:hover:text-neutral-200 active:bg-black/10 dark:active:bg-white/12";

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function HorizontalTabBar({ tabs, activeTabId, loadingTabs, favicons, thinkingTabs, unreadTabs, onSwitch, onClose, onToggleTabSidebar, tabSidebarOpen, onCreateTab }: Props) {
  return (
    <div className={`flex items-center h-11 gap-px px-3 bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-300 dark:border-neutral-700 shrink-0 drag ${tabSidebarOpen ? '' : 'pl-[88px]'}`} style={{ transition: 'padding-left 200ms ease-in-out' }}>
      <div className="flex gap-px shrink-0 no-drag mr-0.5 h-8">
        <button
          className={`${btnClass} ${tabSidebarOpen ? 'bg-black/10 dark:bg-white/12 text-black dark:text-neutral-200' : ''}`}
          title="Toggle Sidebar"
          onClick={onToggleTabSidebar}
        >
          <FiSidebar size={14} />
        </button>
        <button className={btnClass} title="New Tab" onClick={onCreateTab}>
          <FiPlus size={14} />
        </button>
      </div>
      <div className="ml-2 flex items-center gap-px gap-x-1 overflow-x-auto min-w-0 no-drag">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const isLoading = tab.type === 'page' && loadingTabs[tab.id];
        const favicon = tab.type === 'page' && favicons[tab.id];
        const isChat = tab.type === 'chat';
        const isThinking = isChat && thinkingTabs[tab.id];
        const isUnread = !isActive && unreadTabs[tab.id];

        return (
          <div
            key={tab.id}
            className={`flex items-center gap-1.5 h-8 px-3 rounded cursor-pointer text-xs select-none group max-w-[200px] min-w-[60px] shrink-0 transition-colors
              ${isActive
                ? 'bg-white dark:bg-white/12 text-black dark:text-neutral-200'
                : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/6'
              }`}
            onClick={() => onSwitch(tab.id)}
          >
            {isLoading ? (
              <Spinner />
            ) : favicon ? (
              <img src={favicon} className="w-3 h-3 shrink-0 rounded-sm" alt="" />
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
        );
      })}
      </div>
    </div>
  );
}
