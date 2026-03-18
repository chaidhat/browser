import { useState, useRef, useEffect, useCallback } from 'react';
import { IoSend } from 'react-icons/io5';
import { renderContent } from '../utils/renderContent';
import type { ChatMessage } from '../preload';

interface DisplayMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
}

interface Props {
  open: boolean;
}

let nextSidebarRequestId = 0;

export function ChatSidebar({ open }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [inputValue, setInputValue] = useState('');
  const chatHistoryRef = useRef<ChatMessage[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, isTyping, streamingContent]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  const sendChat = useCallback(async () => {
    const text = inputValue.trim();
    if (!text) return;

    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    chatHistoryRef.current.push({ role: 'user', content: text });

    setIsTyping(true);
    setStreamingContent('');
    let accumulated = '';
    const requestId = `sidebar-${nextSidebarRequestId++}`;

    cleanupRef.current = window.browser.chatSendStream(requestId, [...chatHistoryRef.current], {
      onChunk(chunk: string) {
        accumulated += chunk;
        setStreamingContent(accumulated);
      },
      onDone() {
        setIsTyping(false);
        setStreamingContent('');
        chatHistoryRef.current.push({ role: 'assistant', content: accumulated });
        setMessages(prev => [...prev, { role: 'assistant', content: accumulated }]);
        cleanupRef.current = null;
      },
      onError(error: string) {
        setIsTyping(false);
        setStreamingContent('');
        setMessages(prev => [...prev, { role: 'error', content: error }]);
        cleanupRef.current = null;
      },
    });
  }, [inputValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  return (
    <div className={`h-full bg-neutral-50 dark:bg-neutral-800 border-l border-neutral-300 dark:border-neutral-700 flex flex-col overflow-hidden transition-all duration-250 ease-in-out ${open ? 'w-[380px] min-w-[380px]' : 'w-0 min-w-0'}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-300 dark:border-neutral-700 font-semibold text-sm whitespace-nowrap">
        <span>AI Chat</span>
        <span className="text-[11px] font-normal text-neutral-500 dark:text-neutral-400 bg-black/5 dark:bg-white/8 px-2 py-0.5 rounded">gpt-5.4</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5 scrollbar-thin" ref={messagesRef}>
        {messages.map((msg, i) => {
          if (msg.role === 'error') {
            return (
              <div key={i} className="p-2.5 px-3.5 rounded-xl text-[13px] leading-relaxed max-w-[90%] break-words whitespace-pre-wrap bg-red-500/10 text-red-600 dark:text-red-400 self-start border border-red-500/20 text-xs">
                {msg.content}
              </div>
            );
          }
          if (msg.role === 'assistant') {
            return (
              <div
                key={i}
                className="msg-assistant p-2.5 px-3.5 rounded-xl rounded-bl text-[13px] leading-relaxed max-w-[90%] break-words text-black dark:text-neutral-200 self-start"
                dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
              />
            );
          }
          return (
            <div key={i} className="p-2.5 px-3.5 rounded-xl rounded-br text-[13px] leading-relaxed max-w-[90%] break-words whitespace-pre-wrap bg-black dark:bg-neutral-200 text-white dark:text-neutral-900 self-end">
              {msg.content}
            </div>
          );
        })}
        {isTyping && (
          streamingContent ? (
            <div
              className="msg-assistant p-2.5 px-3.5 rounded-xl rounded-bl text-[13px] leading-relaxed max-w-[90%] break-words text-black dark:text-neutral-200 self-start"
              dangerouslySetInnerHTML={{ __html: renderContent(streamingContent) }}
            />
          ) : (
            <div className="p-2.5 px-3.5 rounded-xl text-[13px] leading-relaxed max-w-[90%] self-start bg-transparent text-neutral-400">
              <span className="inline-block bg-gradient-to-r from-neutral-400 via-black to-neutral-400 dark:from-neutral-500 dark:via-white dark:to-neutral-500 bg-[length:200%_100%] bg-clip-text [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] animate-shimmer">Thinking...</span>
            </div>
          )
        )}
      </div>
      <div className="flex items-end gap-2 p-3 px-4 border-t border-neutral-300 dark:border-neutral-700">
        <textarea
          ref={inputRef}
          className="flex-1 resize-none border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-black dark:text-neutral-200 text-[13px] font-[inherit] p-2 px-3 outline-none max-h-[120px] transition-colors focus:border-black dark:focus:border-neutral-400 placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
          placeholder="Ask anything..."
          rows={1}
          value={inputValue}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
        />
        <button
          className="w-9 h-9 border-none rounded-lg bg-black dark:bg-neutral-200 text-white dark:text-neutral-900 cursor-pointer flex items-center justify-center transition-colors shrink-0 hover:bg-neutral-700 dark:hover:bg-neutral-300"
          title="Send"
          onClick={sendChat}
        >
          <IoSend size={14} />
        </button>
      </div>
    </div>
  );
}
