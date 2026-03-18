import { FiX, FiPlus } from 'react-icons/fi';
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
  onCreate: () => void;
}

function Spinner() {
  return (
    <svg className="animate-spin w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function TabSidebar({ tabs, activeTabId, loadingTabs, favicons, thinkingTabs, unreadTabs, onSwitch, onClose, onCreate }: Props) {
  return (
    <div className="w-[200px] h-full bg-transparent flex flex-col p-2 pt-[44px] gap-0.5 shrink-0 border-r border-black/10 dark:border-white/8 relative drag">
      <div className="absolute top-0 left-0 right-0 h-[38px] drag" />
      <div className="flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden flex-1 min-h-0 no-drag scrollbar-thin">
        {tabs.map(tab => {
          const isLoading = tab.type === 'page' && loadingTabs[tab.id];
          const favicon = tab.type === 'page' && favicons[tab.id];
          const isChat = tab.type === 'chat';
          const isThinking = isChat && thinkingTabs[tab.id];
          const isUnread = isChat && unreadTabs[tab.id] && tab.id !== activeTabId;

          return (
            <div
              key={tab.id}
              className={`flex items-center h-8 px-2.5 gap-2 rounded-md cursor-pointer shrink-0 transition-colors text-xs select-none group no-drag
                ${tab.id === activeTabId
                  ? 'bg-white/60 dark:bg-white/12 text-black dark:text-neutral-200'
                  : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/6'
                }`}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('.tab-close-btn')) {
                  onSwitch(tab.id);
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
              <span className={`overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0 text-xs leading-none ${isThinking ? 'bg-gradient-to-r from-neutral-400 via-black to-neutral-400 dark:from-neutral-500 dark:via-white dark:to-neutral-500 bg-[length:200%_100%] bg-clip-text [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] animate-shimmer' : ''}`}>
                {tab.title}
              </span>
              <button
                className="tab-close-btn w-[18px] h-[18px] border-none rounded bg-transparent text-neutral-400 dark:text-neutral-500 cursor-pointer flex items-center justify-center shrink-0 p-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-neutral-200"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <FiX size={10} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="w-full h-[30px] border-none rounded-md bg-transparent text-neutral-500 dark:text-neutral-400 cursor-pointer flex items-center justify-center shrink-0 no-drag mt-1 transition-colors hover:bg-black/8 dark:hover:bg-white/8 hover:text-black dark:hover:text-neutral-200 no-drag"
        title="New Tab"
        onClick={onCreate}
      >
        <FiPlus size={14} />
      </button>
    </div>
  );
}
