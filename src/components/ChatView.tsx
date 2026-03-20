import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { IoClose } from 'react-icons/io5';
import { FiArrowUp, FiArrowRight } from 'react-icons/fi';
import { FiChevronDown } from 'react-icons/fi';
import { renderContent } from '../utils/renderContent';
import type { ChatMessage, ChatContentBlock, SerperResult, SerperImageResult, HistoryEntry } from '../preload';
import logoLight from '../assets/logo.png';
import logoDark from '../assets/logo-dark.png';

const MODELS = [
  { id: 'gpt-5.4', label: 'GPT-5.4', keyField: 'openaiKey' as const },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', keyField: 'anthropicKey' as const },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', keyField: 'googleKey' as const },
];

export interface SearchResults {
  query: string;
  results: SerperResult[];
  images?: SerperImageResult[];
}

export interface DisplayMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  images?: string[];
  searchResults?: SearchResults;
}

interface Props {
  tabId: number;
  tabTitle: string;
  hidden?: boolean;
  messages: DisplayMessage[];
  onMessagesChange: (tabId: number, messages: DisplayMessage[]) => void;
  onTitleChange?: (tabId: number, title: string) => void;
  onNavigate?: (url: string) => void;
  onOpenLink?: (url: string) => void;
  onThinkingChange?: (tabId: number, thinking: boolean) => void;
  initialQuery?: string;
  onInitialQueryConsumed?: (tabId: number) => void;
  visitHistory?: HistoryEntry[];
}

function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) || /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.[a-z]{2,}(\/.*)?$/i.test(input);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let nextRequestId = 0;

export function ChatView({ tabId, tabTitle, hidden, messages, onMessagesChange, onTitleChange, onNavigate, onOpenLink, onThinkingChange, initialQuery, onInitialQueryConsumed, visitHistory = [] }: Props) {
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [selectedModel, setSelectedModel] = useState('gpt-5.4');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showImages, setShowImages] = useState<Record<number, boolean>>({});
  const [acIndex, setAcIndex] = useState(-1);
  const [showAc, setShowAc] = useState(false);
  const [ghostSuggestion, setGhostSuggestion] = useState<string | null>(null);
  const ghostRequestRef = useRef(0);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const acSuggestions = useMemo(() => {
    if (messages.length > 0) return [];
    const q = inputValue.trim().toLowerCase();
    if (!q) return [];
    const results: { url: string; title: string; score: number }[] = [];
    const seen = new Set<string>();
    for (const entry of visitHistory) {
      // Strip to origin (scheme + domain, no path)
      let origin: string;
      try { origin = new URL(entry.url).origin; } catch { continue; }
      if (seen.has(origin)) continue;
      const originLower = origin.toLowerCase();
      const domain = originLower.replace(/^https?:\/\//, '');
      const titleLower = (entry.title || '').toLowerCase();
      if (domain.includes(q) || titleLower.includes(q)) {
        const score = domain.startsWith(q) ? 90 : 40 + Math.min(entry.visitCount, 10);
        results.push({ url: origin, title: entry.title, score });
        seen.add(origin);
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 6);
  }, [inputValue, messages.length, visitHistory]);

  useEffect(() => {
    setShowAc(acSuggestions.length > 0);
    setAcIndex(-1);
  }, [acSuggestions]);

  // Debounced inline suggestion: Algolia when empty chat, AI when in conversation
  const isEmpty = messages.length === 0 && !isTyping;
  useEffect(() => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    if (isTyping) { setGhostSuggestion(null); return; }
    const trimmed = inputValue.trim();
    if (trimmed.length > 0 && trimmed.length < 3) { setGhostSuggestion(null); return; }
    // Empty chat: only Algolia (needs input)
    if (isEmpty && !trimmed) { setGhostSuggestion(null); return; }
    const reqId = ++ghostRequestRef.current;
    suggestTimerRef.current = setTimeout(async () => {
      if (isEmpty) {
        // Algolia only for empty chat state
        if (trimmed) {
          const algoliaSuggestion = await window.browser.autocompleteSuggest(trimmed);
          if (ghostRequestRef.current !== reqId) return;
          setGhostSuggestion(algoliaSuggestion);
        }
      } else {
        // AI autocomplete when in conversation
        const apiMessages = messages.filter(m => m.role !== 'error').map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }));
        const suggestion = await window.browser.chatSuggest(apiMessages, trimmed);
        if (ghostRequestRef.current === reqId && suggestion) {
          setGhostSuggestion(suggestion);
        } else if (ghostRequestRef.current === reqId) {
          setGhostSuggestion(null);
        }
      }
    }, trimmed ? 300 : 500);
    return () => { if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current); };
  }, [inputValue, messages, isTyping, isEmpty]);

  const hasStreamingContent = streamingContent.length > 0;
  useEffect(() => {
    if (isTyping && !hasStreamingContent) {
      setThinkingSeconds(0);
      thinkingTimerRef.current = setInterval(() => {
        setThinkingSeconds(s => +(s + 0.1).toFixed(1));
      }, 100);
    } else {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    }
    return () => {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    };
  }, [isTyping, hasStreamingContent]);

  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    if (messagesRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesRef.current;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
    }
  }, []);

  useEffect(() => {
    if (messagesRef.current && isNearBottomRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, isTyping, streamingContent]);

  useEffect(() => {
    if (!hidden) {
      inputRef.current?.focus();
    }
  }, [hidden]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (initialQuery) {
      onInitialQueryConsumed?.(tabId);
      sendChat(initialQuery);
    }
  }, [initialQuery]);

  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  const addImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const dataUrls = await Promise.all(imageFiles.map(fileToDataUrl));
    setPendingImages(prev => [...prev, ...dataUrls]);
  }, []);

  const sendChat = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputValue).trim();
    if (!text && pendingImages.length === 0) return;

    // If no existing messages and input looks like a URL, navigate instead of chatting
    if (messages.length === 0 && text && pendingImages.length === 0 && looksLikeUrl(text) && onNavigate) {
      setInputValue('');
      const url = /^https?:\/\//i.test(text) ? text : 'https://' + text;
      onNavigate(url);
      return;
    }

    const images = [...pendingImages];
    setInputValue('');
    setPendingImages([]);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    const newMessages: DisplayMessage[] = [
      ...messages,
      { role: 'user', content: text, images: images.length > 0 ? images : undefined },
    ];
    onMessagesChange(tabId, newMessages);

    const apiHistory: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant built into a web browser. Be concise and direct in your responses. Avoid unnecessary filler or preamble. When the user asks about a topic without a specific question, search the web and return relevant links so they can explore further. Format links as markdown.' },
      ...newMessages
      .filter(m => m.role !== 'error')
      .map(m => {
        if (m.images && m.images.length > 0) {
          const content: ChatContentBlock[] = [];
          for (const img of m.images) {
            content.push({ type: 'image_url', image_url: { url: img, detail: 'auto' } });
          }
          if (m.content) {
            content.push({ type: 'text', text: m.content });
          }
          return { role: m.role as 'user' | 'assistant', content };
        }
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }),
    ];

    if (tabTitle === 'New Chat' && text && onTitleChange) {
      window.browser.chatGenerateTitle(text).then(title => {
        if (title) onTitleChange(tabId, title);
      });
    }

    setIsTyping(true);
    onThinkingChange?.(tabId, true);
    setStreamingContent('');
    let accumulated = '';
    const requestId = `chat-${tabId}-${nextRequestId++}`;
    const msgsSnapshot = newMessages;

    // Fire Serper web + image search in parallel if user has a key and this is a text query
    let searchResultsData: SearchResults | undefined;
    let chatDone = false;
    if (text && images.length === 0) {
      const webSearch = window.browser.serperSearch(text).catch(() => null);
      const imageSearch = window.browser.serperImageSearch(text).catch(() => null);

      Promise.all([webSearch, imageSearch]).then(([results, imageResults]) => {
        if ((results && results.length > 0) || (imageResults && imageResults.length > 0)) {
          searchResultsData = {
            query: text,
            results: results || [],
            images: imageResults || undefined,
          };
          // Inject search context into the API history
          if (results && results.length > 0) {
            const searchContext = results.map(r => `- [${r.title}](${r.link}): ${r.snippet}`).join('\n');
            apiHistory.push({
              role: 'system',
              content: `Web search results for "${text}":\n${searchContext}\n\nUse these results to inform your answer. Include relevant links.`,
            });
          }
          // Only update messages if chat hasn't finished/errored yet
          if (!chatDone) {
            const updatedMessages = [...msgsSnapshot];
            updatedMessages[updatedMessages.length - 1] = {
              ...updatedMessages[updatedMessages.length - 1],
              searchResults: searchResultsData,
            };
            onMessagesChange(tabId, updatedMessages);
          }
        }
      });
    }

    cleanupRef.current = window.browser.chatSendStream(requestId, apiHistory, {
      onChunk(chunk: string) {
        accumulated += chunk;
        setStreamingContent(accumulated);
      },
      onDone() {
        chatDone = true;
        setIsTyping(false);
        onThinkingChange?.(tabId, false);
        setStreamingContent('');
        // Preserve search results on the user message
        const finalMessages = [...msgsSnapshot];
        if (searchResultsData) {
          finalMessages[finalMessages.length - 1] = {
            ...finalMessages[finalMessages.length - 1],
            searchResults: searchResultsData,
          };
        }
        onMessagesChange(tabId, [...finalMessages, { role: 'assistant', content: accumulated }]);
        cleanupRef.current = null;
      },
      onError(error: string) {
        chatDone = true;
        setIsTyping(false);
        onThinkingChange?.(tabId, false);
        setStreamingContent('');
        const finalMessages = [...msgsSnapshot];
        if (searchResultsData) {
          finalMessages[finalMessages.length - 1] = {
            ...finalMessages[finalMessages.length - 1],
            searchResults: searchResultsData,
          };
        }
        onMessagesChange(tabId, [...finalMessages, { role: 'error', content: error }]);
        cleanupRef.current = null;
      },
    }, selectedModel);
  }, [inputValue, pendingImages, messages, tabId, tabTitle, selectedModel, onMessagesChange, onTitleChange, onThinkingChange]);

  const acceptAcSuggestion = (s: { url: string }) => {
    setShowAc(false);
    setInputValue('');
    onNavigate?.(s.url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAc) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex(i => (i + 1) % acSuggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcIndex(i => (i - 1 + acSuggestions.length) % acSuggestions.length); return; }
      if (e.key === 'Tab' && acIndex >= 0) { e.preventDefault(); setInputValue(acSuggestions[acIndex].url); setShowAc(false); return; }
      if (e.key === 'Escape') { setShowAc(false); return; }
      if (e.key === 'Enter' && !e.shiftKey && acIndex >= 0) { e.preventDefault(); acceptAcSuggestion(acSuggestions[acIndex]); return; }
    }
    // Tab to accept ghost suggestion into input
    if (e.key === 'Tab' && ghostSuggestion) {
      e.preventDefault();
      setInputValue(inputValue + ghostSuggestion);
      setGhostSuggestion(null);
      return;
    }
    if (e.key === 'Escape' && ghostSuggestion) {
      setGhostSuggestion(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = inputValue.trim();
      if (e.metaKey && text && onNavigate) {
        // Cmd+Enter → open Google search, converting this chat tab to a page tab
        setInputValue('');
        onNavigate(`https://www.google.com/search?q=${encodeURIComponent(text)}`);
        return;
      }
      sendChat();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    setGhostSuggestion(null);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(40, Math.min(textarea.scrollHeight, 120)) + 'px';
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      await addImages(imageFiles);
    }
  }, [addImages]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    await addImages(files);
  }, [addImages]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (anchor && anchor.href && onOpenLink) {
      e.preventDefault();
      onOpenLink(anchor.href);
    }
  }, [onOpenLink]);

  return (
    <div
      className="flex-1 flex flex-col h-full bg-white dark:bg-black overflow-hidden"
      style={hidden ? { display: 'none' } : undefined}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="h-6 shrink-0 drag" />
      <div className={isEmpty ? 'hidden' : 'flex-1 relative overflow-hidden'}>
      <div className="absolute inset-0 overflow-y-auto w-full scrollbar-thin" data-chat-messages={tabId} ref={messagesRef} onScroll={handleScroll} onClick={handleLinkClick}>
        <div className="max-w-[768px] mx-auto pl-6 pr-0 pt-6 pb-32 flex flex-col gap-3 min-h-full">
          {messages.map((msg, i) => {
            if (msg.role === 'error') {
              return (
                <div key={i} className="p-2.5 px-3.5 rounded-xl text-[15px] leading-relaxed max-w-[90%] break-words whitespace-pre-wrap bg-red-500/10 text-red-600 dark:text-red-400 self-start border border-red-500/20" style={{ fontFamily: "'PT Serif', serif" }}>
                  {msg.content}
                </div>
              );
            }
            if (msg.role === 'assistant') {
              return (
                <div
                  key={i}
                  className="msg-assistant p-2.5 px-3.5 rounded-xl rounded-bl text-[15px] leading-relaxed max-w-[90%] break-words text-black dark:text-neutral-200 self-start"
                  style={{ fontFamily: "'PT Serif', serif" }}
                  dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
                />
              );
            }
            return (
              <div key={i} className="flex flex-col gap-2 self-end max-w-[90%]">
                <div className="p-2.5 px-3.5 rounded-xl rounded-br-sm text-[15px] leading-relaxed break-words whitespace-pre-wrap bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-200" style={{ fontFamily: "'PT Serif', serif" }}>
                  {msg.images && msg.images.map((img, j) => (
                    <img key={j} src={img} className="block max-w-full max-h-[300px] rounded-lg mb-1.5 object-contain cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLightboxImage(img)} />
                  ))}
                  {msg.content}
                </div>
                {i === 0 && msg.searchResults && (msg.searchResults.results.length > 0 || (msg.searchResults.images && msg.searchResults.images.length > 0)) && (
                  <div className="self-start w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 overflow-hidden" style={{ fontFamily: "'PT Serif', serif" }}>
                    <div className="px-3 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-700">
                      Search results
                    </div>
                    {msg.searchResults.images && msg.searchResults.images.length > 0 && (
                      <>
                        <button
                          className="w-full px-3 py-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-700 bg-transparent cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors text-left"
                          onClick={() => setShowImages(prev => ({ ...prev, [i]: !prev[i] }))}
                        >
                          {showImages[i] ? '▾ Images' : '▸ Images'}
                        </button>
                        {showImages[i] && (
                          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto scrollbar-none border-b border-neutral-100 dark:border-neutral-700/50">
                            {msg.searchResults.images.map((img, j) => (
                              <a key={j} href={img.link} className="shrink-0 no-underline" title={img.title}>
                                <img
                                  src={img.imageUrl}
                                  alt={img.title}
                                  className="h-[72px] w-auto rounded object-cover hover:opacity-80 transition-opacity cursor-pointer"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              </a>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {msg.searchResults.results.map((r, j) => (
                      <a
                        key={j}
                        href={r.link}
                        className="flex flex-col gap-0.5 px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors cursor-pointer border-b border-neutral-100 dark:border-neutral-700/50 last:border-b-0 no-underline"
                      >
                        <span className="text-[15px] font-medium text-blue-600 dark:text-blue-400 truncate" style={{ fontFamily: "'PT Serif', serif" }}>{r.title}</span>
                        <span className="text-[13px] text-neutral-500 dark:text-neutral-400 line-clamp-1" style={{ fontFamily: "'PT Serif', serif" }}>{r.snippet}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {isTyping && (
            streamingContent ? (
              <div
                className="msg-assistant p-2.5 px-3.5 rounded-xl rounded-bl text-[15px] leading-relaxed max-w-[90%] break-words text-black dark:text-neutral-200 self-start"
                style={{ fontFamily: "'PT Serif', serif" }}
                dangerouslySetInnerHTML={{ __html: renderContent(streamingContent) }}
              />
            ) : (
              <div className="p-2.5 px-3.5 rounded-xl text-[15px] leading-relaxed max-w-[90%] self-start bg-transparent text-neutral-400" style={{ fontFamily: "'PT Serif', serif" }}>
                <span className="inline-block bg-gradient-to-r from-neutral-300 via-neutral-500 to-neutral-300 dark:from-neutral-600 dark:via-neutral-300 dark:to-neutral-600 bg-[length:200%_100%] bg-clip-text [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] animate-shimmer">
                  Thinking... {thinkingSeconds > 0 ? `${thinkingSeconds >= 60 ? `${Math.floor(thinkingSeconds / 60)}m ${Math.floor(thinkingSeconds % 60)}s` : `${Math.floor(thinkingSeconds)}s`}` : ''}
                </span>
              </div>
            )
          )}
        </div>
      </div>
      </div>
      <div className={`w-full mx-auto relative ${isEmpty ? 'flex-1 flex flex-col items-center justify-center drag max-w-[640px]' : 'max-w-[768px] pl-8 pr-0 overflow-visible'}`}>
        {isEmpty && (
          <>
            <img src={logoLight} alt="Logo" className="h-20 mb-6 dark:hidden" />
            <img src={logoDark} alt="Logo" className="h-20 mb-6 hidden dark:block" />
          </>
        )}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 px-6 pt-3 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-neutral-300 dark:border-neutral-600">
                <img src={img} className="w-full h-full object-cover" />
                <button
                  className="absolute top-0.5 right-0.5 w-[18px] h-[18px] border-none rounded-full bg-black/60 dark:bg-white/30 text-white cursor-pointer flex items-center justify-center p-0 transition-colors hover:bg-black/80 dark:hover:bg-white/50"
                  onClick={() => removeImage(i)}
                >
                  <IoClose size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-start gap-2.5 pb-0 pr-0 no-drag w-full">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              className="h-10 w-full resize-none border border-neutral-200 dark:border-neutral-700 rounded-[10px] bg-white dark:bg-neutral-900 text-black dark:text-neutral-200 text-[15px] py-2 px-3.5 outline-none max-h-[120px] transition-colors placeholder:text-neutral-400 dark:placeholder:text-neutral-600 box-border"
              style={{ fontFamily: "'PT Serif', serif" }}
              placeholder={ghostSuggestion && !inputValue ? '' : 'Ask anything...'}
              rows={1}
              value={inputValue}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
            {ghostSuggestion && (
              <div
                className="absolute inset-0 pointer-events-none border border-transparent rounded-[10px] py-2 px-3.5 text-[15px] overflow-hidden whitespace-nowrap text-ellipsis h-10 box-border"
                style={{ fontFamily: "'PT Serif', serif" }}
              >
                {inputValue && <span className="invisible whitespace-pre">{inputValue}</span>}
                <span className="text-neutral-400 dark:text-neutral-600">{ghostSuggestion}</span>
              </div>
            )}
            {showAc && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1">
                <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg overflow-hidden">
                  {acSuggestions.map((s, i) => (
                    <div
                      key={s.url}
                      className={`px-3 py-1.5 text-[13px] cursor-pointer flex items-center gap-2 truncate ${
                        i === acIndex
                          ? 'bg-blue-500 text-white'
                          : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                      }`}
                      onMouseDown={(e) => { e.preventDefault(); acceptAcSuggestion(s); }}
                    >
                      <span className="truncate font-medium">{s.title || s.url}</span>
                      {s.title && <span className={`truncate text-[11px] ${i === acIndex ? 'text-white/70' : 'text-neutral-400 dark:text-neutral-500'}`}>{s.url}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            className="w-10 h-10 border-none rounded-[10px] bg-neutral-900 dark:bg-neutral-700 text-white cursor-pointer flex items-center justify-center transition-colors shrink-0 hover:bg-neutral-700 dark:hover:bg-neutral-600"
            title="Send"
            onClick={sendChat}
          >
            {isEmpty ? <FiArrowRight size={18} /> : <FiArrowUp size={18} />}
          </button>
        </div>
        <div className="flex items-center pb-4 no-drag self-start relative z-10">
          <div className="relative" ref={modelMenuRef}>
            <button
              className="h-7 px-2.5 border-none rounded-lg bg-transparent text-[11px] font-medium text-neutral-400 dark:text-neutral-500 cursor-pointer flex items-center gap-1 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300 whitespace-nowrap"
              onClick={() => setModelMenuOpen(prev => !prev)}
            >
              {MODELS.find(m => m.id === selectedModel)?.label}
              <FiChevronDown size={11} />
            </button>
            {modelMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[160px] no-drag">
                {MODELS.map(m => (
                  <button
                    key={m.id}
                    className={`w-full text-left px-3 py-2 text-[12px] border-none cursor-pointer transition-colors ${
                      m.id === selectedModel
                        ? 'bg-neutral-100 dark:bg-neutral-700 text-black dark:text-neutral-200 font-medium'
                        : 'bg-transparent text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700/50'
                    }`}
                    onClick={() => {
                      setSelectedModel(m.id);
                      setModelMenuOpen(false);
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer"
          onClick={() => setLightboxImage(null)}
        >
          <img src={lightboxImage} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  );
}
