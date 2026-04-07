import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { IoClose } from 'react-icons/io5';
import { FiArrowUp, FiArrowRight, FiChevronDown, FiCopy, FiCheck, FiSquare, FiEdit2, FiRefreshCw, FiExternalLink } from 'react-icons/fi';
import { renderContent } from '../utils/renderContent';
import type { ChatMessage, ChatContentBlock, SerperResult, SerperImageResult, HistoryEntry, ToolCallInfo } from '../preload';
import logoLight from '../assets/logo.png';
import logoDark from '../assets/logo-dark.png';
import { rankedDomains } from '../utils/rankedDomains';
import { buildCustomToolsPromptText } from '../customTools';

const MODELS = [
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', keyField: 'openaiKey' as const },
  { id: 'gpt-5.4', label: 'GPT-5.4', keyField: 'openaiKey' as const },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', keyField: 'anthropicKey' as const },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', keyField: 'googleKey' as const },
];

export interface ToolCallDisplay {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, any>;
  result?: string;
  status: 'running' | 'done' | 'error';
}

export interface SearchResults {
  query: string;
  results: SerperResult[];
  images?: SerperImageResult[];
}

export interface PdfAttachment {
  name: string;
  dataUrl: string;
}

export interface DisplayMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  images?: string[];
  pdfs?: PdfAttachment[];
  searchResults?: SearchResults;
  durationMs?: number;
  toolCalls?: ToolCallDisplay[];
}

const customToolsPromptText = buildCustomToolsPromptText();

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
  onOpenSpecialTab?: () => void;
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

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 10000);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return (
    <button
      onClick={handleCopy}
      className={`border-none bg-transparent cursor-pointer p-1 rounded transition-colors text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 ${className}`}
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
    </button>
  );
}

function RetryButton({ index, onRetry }: { index: number; onRetry: (idx: number, modelId: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="border-none bg-transparent cursor-pointer p-1 rounded transition-colors text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
        title="Retry with different model"
      >
        <FiRefreshCw size={14} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg overflow-hidden">
          {MODELS.map(m => (
            <button
              key={m.id}
              onClick={() => { setOpen(false); onRetry(index, m.id); }}
              className="block w-full text-left px-3 py-1.5 border-none bg-transparent cursor-pointer text-[12px] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors whitespace-nowrap"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

function ToolCallRow({ toolCall }: { toolCall: ToolCallDisplay }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="text-[15px] leading-relaxed text-neutral-400 dark:text-neutral-500">
      <div
        className="flex items-center gap-1 cursor-pointer select-none hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`text-[9px] transition-transform inline-block ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        <span>tool call <span className="text-neutral-500 dark:text-neutral-400">{toolCall.toolName}</span></span>
        {toolCall.status === 'running' && (
          <span
            className="ml-1 inline-block h-[0.8em] w-[0.8em] animate-spin rounded-full border-[1.5px] border-current border-t-transparent align-[-0.08em] opacity-70"
            aria-label="Running"
          />
        )}
        {toolCall.status === 'error' && <span className="text-red-400 ml-0.5">failed</span>}
      </div>
      {expanded && (
        <div className="ml-4 mt-1 p-2 rounded-md bg-neutral-100 dark:bg-neutral-800 text-[13px] leading-relaxed font-mono max-h-[200px] overflow-auto whitespace-pre-wrap">
          <div className="text-neutral-500 dark:text-neutral-400">args: {JSON.stringify(toolCall.toolArgs, null, 2)}</div>
          {toolCall.result != null && (
            <div className="mt-1.5 pt-1.5 text-neutral-400 dark:text-neutral-500 border-t border-neutral-200 dark:border-neutral-700">
              result: {toolCall.result.length > 500 ? toolCall.result.slice(0, 500) + '…' : toolCall.result}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Extract the "output" string value from a partial/complete JSON like {"output":"..."} */
function extractOutputFromPartialJson(raw: string): string {
  // Find the start of the output value
  const keyPatterns = ['"output":"', '"output": "', '"output" : "'];
  let startIdx = -1;
  let patternLen = 0;
  for (const p of keyPatterns) {
    const idx = raw.indexOf(p);
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
      startIdx = idx;
      patternLen = p.length;
    }
  }
  if (startIdx === -1) return ''; // Haven't streamed the output key yet
  const valueStart = startIdx + patternLen;
  // Walk the string handling escape sequences to find the closing quote
  let result = '';
  let i = valueStart;
  while (i < raw.length) {
    if (raw[i] === '\\') {
      if (i + 1 >= raw.length) break; // Incomplete escape at end of buffer — wait for more data
      const next = raw[i + 1];
      if (next === '"') { result += '"'; i += 2; }
      else if (next === 'n') { result += '\n'; i += 2; }
      else if (next === 't') { result += '\t'; i += 2; }
      else if (next === '\\') { result += '\\'; i += 2; }
      else if (next === '/') { result += '/'; i += 2; }
      else if (next === 'r') { i += 2; } // Skip \r
      else if (next === 'u') {
        // Unicode escape \uXXXX
        if (i + 6 > raw.length) break; // Incomplete unicode escape — wait for more data
        const hex = raw.substring(i + 2, i + 6);
        result += String.fromCharCode(parseInt(hex, 16));
        i += 6;
      } else { result += next; i += 2; }
    } else if (raw[i] === '"') {
      break; // End of string value
    } else {
      result += raw[i];
      i++;
    }
  }
  return result;
}

function parseSearchToolResults(raw: string): SearchResults | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.query !== 'string' || !Array.isArray(parsed.results)) return null;
    const images = Array.isArray(parsed.images)
      ? parsed.images
          .filter((img: any) => img && typeof img.imageUrl === 'string' && typeof img.link === 'string')
          .map((img: any) => ({ title: img.title || '', imageUrl: img.imageUrl, link: img.link }))
      : undefined;
    return {
      query: parsed.query,
      results: parsed.results
        .filter((r: any) => r && typeof r.title === 'string' && typeof r.link === 'string')
        .map((r: any) => ({
          title: r.title,
          link: r.link,
          snippet: typeof r.snippet === 'string' ? r.snippet : '',
        })),
      images: images && images.length > 0 ? images : undefined,
    };
  } catch {
    return null;
  }
}

function applySearchResultsToMessages(messages: DisplayMessage[], searchResults?: SearchResults): DisplayMessage[] {
  if (!searchResults || messages.length === 0) return [...messages];
  const updated = [...messages];
  updated[updated.length - 1] = {
    ...updated[updated.length - 1],
    searchResults,
  };
  return updated;
}

let nextRequestId = 0;

export function ChatView({ tabId, tabTitle, hidden, messages, onMessagesChange, onTitleChange, onNavigate, onOpenLink, onThinkingChange, initialQuery, onInitialQueryConsumed, visitHistory = [], onOpenSpecialTab }: Props) {
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingPdfs, setPendingPdfs] = useState<PdfAttachment[]>([]);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [selectedModel, setSelectedModel] = useState('gpt-5.4-mini');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCallDisplay[]>([]);
  const pendingToolCallsRef = useRef<ToolCallDisplay[]>([]);
  const pendingSearchResultsRef = useRef<SearchResults | undefined>(undefined);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showImages, setShowImages] = useState<Record<number, boolean>>({});
  const [acIndex, setAcIndex] = useState(-1);
  const [showAc, setShowAc] = useState(false);
  const [ghostSuggestion, setGhostSuggestion] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const editPrevInputRef = useRef<string>('');
  const ghostRequestRef = useRef(0);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const acSuggestions = useMemo(() => {
    if (messages.length > 0) return [];
    if (pendingImages.length > 0 || pendingPdfs.length > 0) return [];
    const q = inputValue.trim().toLowerCase();
    if (!q) return [];
    const results: { url: string; title: string; score: number }[] = [];
    const seen = new Set<string>();
    // Visit history first (higher priority)
    for (const entry of visitHistory) {
      let origin: string;
      try { origin = new URL(entry.url).origin; } catch { continue; }
      if (seen.has(origin)) continue;
      const originLower = origin.toLowerCase();
      const domain = originLower.replace(/^https?:\/\//, '');
      const titleLower = (entry.title || '').toLowerCase();
      if (domain.includes(q) || titleLower.includes(q)) {
        const score = domain.startsWith(q) ? 200 : 100 + Math.min(entry.visitCount, 10);
        results.push({ url: origin, title: entry.title, score });
        seen.add(origin);
      }
    }
    // Ranked domains as fallback (lower priority)
    for (const domain of rankedDomains) {
      const url = `https://${domain}`;
      if (seen.has(url)) continue;
      if (domain.includes(q)) {
        const score = domain.startsWith(q) ? 50 : 10;
        results.push({ url, title: '', score });
        seen.add(url);
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 6);
  }, [inputValue, messages.length, visitHistory, pendingImages.length, pendingPdfs.length]);

  useEffect(() => {
    setShowAc(acSuggestions.length > 0);
    setAcIndex(-1);
  }, [acSuggestions]);

  // Debounced inline suggestion: visit history when empty chat, AI when in conversation
  const isEmpty = messages.length === 0 && !isTyping && pendingImages.length === 0 && pendingPdfs.length === 0;

  // Ghost completion from visit history when isEmpty (synchronous, like Toolbar)
  const historyGhost = useMemo((): string | null => {
    if (!isEmpty) return null;
    const q = inputValue.trim().toLowerCase();
    if (!q) return null;
    // Use the top acSuggestion to derive inline ghost text
    if (acSuggestions.length > 0) {
      const topUrl = acSuggestions[0].url;
      const stripped = topUrl.replace(/^https?:\/\/(www\.)?/, '');
      if (stripped.toLowerCase().startsWith(q)) {
        return stripped.slice(q.length);
      }
    }
    return null;
  }, [isEmpty, inputValue, acSuggestions]);

  useEffect(() => {
    if (isEmpty) {
      // For empty chat, ghost comes from historyGhost (synchronous), not API
      setGhostSuggestion(historyGhost);
      return;
    }
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    if (isTyping) { setGhostSuggestion(null); return; }
    const trimmed = inputValue.trim();
    if (trimmed.length > 0 && trimmed.length < 3) { setGhostSuggestion(null); return; }
    const reqId = ++ghostRequestRef.current;
    suggestTimerRef.current = setTimeout(async () => {
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
    }, trimmed ? 300 : 500);
    return () => { if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current); };
  }, [inputValue, messages, isTyping, isEmpty, historyGhost]);

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

  const addFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const pdfFiles = files.filter(f => f.type === 'application/pdf');
    if (imageFiles.length === 0 && pdfFiles.length === 0) return;
    setGhostSuggestion(null);
    setShowAc(false);
    if (imageFiles.length > 0) {
      const dataUrls = await Promise.all(imageFiles.map(fileToDataUrl));
      setPendingImages(prev => [...prev, ...dataUrls]);
    }
    if (pdfFiles.length > 0) {
      const pdfAttachments = await Promise.all(pdfFiles.map(async f => ({
        name: f.name,
        dataUrl: await fileToDataUrl(f),
      })));
      setPendingPdfs(prev => [...prev, ...pdfAttachments]);
    }
  }, []);

  const sendChat = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? inputValue).trim();
    if (!text && pendingImages.length === 0 && pendingPdfs.length === 0) return;

    // If no existing messages and input looks like a URL, navigate instead of chatting
    if (messages.length === 0 && text && pendingImages.length === 0 && looksLikeUrl(text) && onNavigate) {
      setInputValue('');
      const url = /^https?:\/\//i.test(text) ? text : 'https://' + text;
      onNavigate(url);
      return;
    }

    // If no existing messages and input is "email", "discord", etc., open Messages tab
    if (messages.length === 0 && text && pendingImages.length === 0) {
      const lower = text.toLowerCase().trim();
      if (lower === 'email' || lower === 'mail' || lower === 'inbox' || lower === 'discord' || lower === 'messages') {
        setInputValue('');
        onOpenSpecialTab?.();
        return;
      }
    }

    const images = [...pendingImages];
    const pdfs = [...pendingPdfs];
    setInputValue('');
    setPendingImages([]);
    setPendingPdfs([]);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    const baseMessages = editingIndex !== null ? messages.slice(0, editingIndex) : messages;
    setEditingIndex(null);
    const newMessages: DisplayMessage[] = [
      ...baseMessages,
      { role: 'user', content: text, images: images.length > 0 ? images : undefined, pdfs: pdfs.length > 0 ? pdfs : undefined },
    ];
    onMessagesChange(tabId, newMessages);

    const apiHistory: ChatMessage[] = [
      { role: 'system', content: `You are a helpful assistant built into a web browser. You are also a helpful search engine. Be concise and direct. Format links as markdown. Today's date is ${new Date().toISOString().split('T')[0]}.

Expect the user to sometimes send short search-term-style queries, including single-word queries. In those cases, interpret the message as a request to search the web and then describe the most relevant results.

You MUST respond with exactly one JSON object in one of these two formats:

**Option A - Final response:**
{"outputType": "text", "output": "your response here with markdown formatting"}

**Option B - Tool calls (can call multiple in parallel):**
{"outputType": "toolCalls", "toolCalls": [{"name": "<toolName>", "input": {<args>}}]}

Examples of valid tool calls:
{"outputType": "toolCalls", "toolCalls": [{"name": "search", "input": {"query": "best daily running shoes 2026"}}]}
{"outputType": "toolCalls", "toolCalls": [{"name": "consultModel", "input": {"model": "claude-opus-4-6", "question": "Compare two daily running shoe recommendations and explain the tradeoffs."}}]}
{"outputType": "toolCalls", "toolCalls": [{"name": "search", "input": {"query": "best speed running shoes 2026"}}, {"name": "consultModel", "input": {"model": "gemini-3.1-pro", "question": "What matters most when choosing a speed-focused running shoe?"}}]}

Available tools:
${customToolsPromptText}

After tools execute, you will receive a message with {"toolResults": [{tool, result}]}. Use these results to formulate your final response (Option A) or call more tools (Option B).

You should default to calling the search tool first. If the user is asking for information, current facts, recommendations, research, or anything that benefits from web results, your first response should usually be Option B with a search tool call.

When searching, ALWAYS call at least 3 search tool calls in parallel with different queries to get comprehensive results. For example, if the user asks "best laptops for programming", you should search for "best laptops for programming 2026", "best developer laptops reviews", and "programming laptop recommendations specs" all in one Option B response. Vary the phrasing and angle of each query to maximize coverage.

Do not send Option A until you have already used the search tool, unless the user is clearly asking for something that does not need web results.

If you respond with Option A instead of a tool call, that is the end of your turn. Do not expect any more tools to run after a direct response. The user must send another message before you can continue.

When multiple tool calls would help, call as many as possible in parallel in a single Option B response instead of serializing them across multiple turns.

Use the thinking tool frequently to share your honest, unfiltered reasoning with the user. Call it before making decisions, when weighing tradeoffs, when you are unsure, or when your approach changes. Do not hold back — the user wants radical transparency into your thought process.

If the user asks you to do something that you cannot do with your current tools (e.g. access files, run code, manage servers, interact with services, or anything beyond web search and text generation), always try consultOpenclaw. OpenClaw is a powerful agent running on the user's server with access to tools, memory, and the ability to execute tasks on their behalf. When in doubt, ask OpenClaw. IMPORTANT: OpenClaw has NO context of your conversation — each call starts a fresh session. You must include all relevant context, background, and details in your question every time you consult it.

When using the bash tool and you cd into a directory, ALWAYS first check for AGENTS.md or CLAUDE.md files in that directory and all parent directories by running: d="$PWD"; while [ "$d" != "/" ]; do cat "$d/AGENTS.md" "$d/CLAUDE.md" 2>/dev/null; d="$(dirname "$d")"; done
If any are found, read and follow their instructions.

IMPORTANT: Your entire response must be valid JSON. Use \\n for newlines within the output string. Escape quotes with \\".` },
      ...newMessages
      .filter(m => m.role !== 'error')
      .map(m => {
        const hasAttachments = (m.images && m.images.length > 0) || (m.pdfs && m.pdfs.length > 0);
        if (hasAttachments) {
          const content: ChatContentBlock[] = [];
          if (m.images) {
            for (const img of m.images) {
              content.push({ type: 'image_url', image_url: { url: img, detail: 'auto' } });
            }
          }
          if (m.pdfs) {
            for (const pdf of m.pdfs) {
              content.push({ type: 'file', file: { url: pdf.dataUrl, mimeType: 'application/pdf' } });
            }
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
    setPendingToolCalls([]);
    pendingToolCallsRef.current = [];
    pendingSearchResultsRef.current = undefined;
    let accumulated = '';
    const requestId = `chat-${tabId}-${nextRequestId++}`;
    currentRequestIdRef.current = requestId;
    const msgsSnapshot = newMessages;
    const startTime = Date.now();

    cleanupRef.current = window.browser.chatSendStream(requestId, apiHistory, {
      onChunk(chunk: string) {
        accumulated += chunk;
        setStreamingContent(accumulated);
      },
      onToolCall(info: ToolCallInfo) {
        setPendingToolCalls(prev => {
          const idx = prev.findIndex(tc => tc.toolCallId === info.toolCallId);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...info };
            pendingToolCallsRef.current = updated;
            return updated;
          }
          const added = [...prev, { ...info }];
          pendingToolCallsRef.current = added;
          return added;
        });
        if (info.toolName === 'search' && info.status === 'done' && info.result) {
          const parsedResults = parseSearchToolResults(info.result);
          if (parsedResults && parsedResults.results.length > 0) {
            pendingSearchResultsRef.current = parsedResults;
            onMessagesChange(tabId, applySearchResultsToMessages(msgsSnapshot, parsedResults));
          }
        }
      },
      onDone() {
        setIsTyping(false);
        onThinkingChange?.(tabId, false);
        setStreamingContent('');

        const finalContent = accumulated;
        const finalMessages = applySearchResultsToMessages(msgsSnapshot, pendingSearchResultsRef.current);
        const collectedToolCalls = pendingToolCallsRef.current.length > 0 ? [...pendingToolCallsRef.current] : undefined;
        const assistantMsg: DisplayMessage = { role: 'assistant', content: finalContent, durationMs: Date.now() - startTime, toolCalls: collectedToolCalls };

        setPendingToolCalls([]);
        pendingToolCallsRef.current = [];
        pendingSearchResultsRef.current = undefined;

        onMessagesChange(tabId, [...finalMessages, assistantMsg]);
        cleanupRef.current = null;
      },
      onError(error: string) {
        setIsTyping(false);
        onThinkingChange?.(tabId, false);
        setStreamingContent('');
        setPendingToolCalls([]);
        pendingToolCallsRef.current = [];
        onMessagesChange(tabId, [...applySearchResultsToMessages(msgsSnapshot, pendingSearchResultsRef.current), { role: 'error', content: error }]);
        pendingSearchResultsRef.current = undefined;
        cleanupRef.current = null;
      },
    }, selectedModel);
  }, [inputValue, pendingImages, pendingPdfs, messages, tabId, tabTitle, selectedModel, onMessagesChange, onTitleChange, onThinkingChange]);

  const retryRef = useRef<{ assistantIndex: number; modelId: string } | null>(null);

  const retryWithModel = useCallback((assistantIndex: number, modelId: string) => {
    const userIdx = assistantIndex - 1;
    if (userIdx < 0 || messages[userIdx]?.role !== 'user') return;
    const userMsg = messages[userIdx];
    setEditingIndex(userIdx);
    setSelectedModel(modelId);
    setInputValue(userMsg.content);
    if (userMsg.images) setPendingImages(userMsg.images);
    if (userMsg.pdfs) setPendingPdfs(userMsg.pdfs);
    retryRef.current = { assistantIndex, modelId };
  }, [messages]);

  // Auto-send when retry is queued
  useEffect(() => {
    if (retryRef.current && editingIndex !== null && inputValue) {
      retryRef.current = null;
      sendChat();
    }
  }, [editingIndex, inputValue, sendChat]);

  const stopChat = useCallback(() => {
    if (currentRequestIdRef.current) {
      window.browser.chatAbortStream(currentRequestIdRef.current);
    }
    cleanupRef.current?.();
    cleanupRef.current = null;
    currentRequestIdRef.current = null;
    setIsTyping(false);
    onThinkingChange?.(tabId, false);
    setStreamingContent('');
  }, [tabId, onThinkingChange]);

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
      const fullText = ghostSuggestion ? inputValue + ghostSuggestion : inputValue;
      if (ghostSuggestion) {
        setInputValue(fullText);
        setGhostSuggestion(null);
      }
      if (e.metaKey && fullText.trim() && onNavigate) {
        setInputValue('');
        onNavigate(`https://www.google.com/search?q=${encodeURIComponent(fullText.trim())}`);
        return;
      }
      sendChat(fullText);
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
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/') || items[i].type === 'application/pdf') {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await addFiles(files);
    }
  }, [addFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    await addFiles(files);
  }, [addFiles]);

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
      className="flex-1 flex flex-col h-full bg-white dark:bg-[#111] overflow-hidden"
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
                <div key={i} className="p-2.5 px-3.5 rounded-xl text-[15px] leading-relaxed max-w-[90%] break-words whitespace-pre-wrap bg-red-500/10 text-red-600 dark:text-red-400 self-start border border-red-500/20" >
                  {msg.content}
                </div>
              );
            }
            if (msg.role === 'assistant') {
              return (
                <div key={i} className="flex flex-col self-start max-w-[90%]">
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="flex flex-col gap-1 mb-1 ml-1">
                      {msg.toolCalls.map((tc) => (
                        <ToolCallRow key={tc.toolCallId} toolCall={tc} />
                      ))}
                      {msg.toolCalls.some(tc => (tc.toolName === 'readEmail' || tc.toolName === 'readDiscord') && tc.status === 'done') && (
                        <button
                          onClick={() => onOpenSpecialTab?.()}
                          className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors cursor-pointer mt-1"
                        >
                          <FiArrowRight size={12} /> Open Messages
                        </button>
                      )}
                    </div>
                  )}
                  <div
                    className="msg-assistant p-2.5 px-3.5 rounded-xl rounded-bl text-[15px] leading-relaxed break-words text-black dark:text-neutral-200"
                                       dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
                    ref={(el) => {
                      if (!el) return;
                      el.querySelectorAll('pre').forEach((pre) => {
                        if (pre.querySelector('.code-copy-btn')) return;
                        pre.style.position = 'relative';
                        const btn = document.createElement('button');
                        btn.className = 'code-copy-btn';
                        btn.title = 'Copy code';
                        btn.style.cssText = 'position:absolute;top:6px;right:6px;border:none;background:rgba(128,128,128,0.2);cursor:pointer;padding:4px;border-radius:4px;color:inherit;opacity:0.5;transition:opacity 0.15s;line-height:0;';
                        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
                        btn.onmouseenter = () => { btn.style.opacity = '1'; };
                        btn.onmouseleave = () => { btn.style.opacity = '0.5'; };
                        btn.onclick = () => {
                          const code = pre.querySelector('code');
                          navigator.clipboard.writeText((code || pre).textContent || '');
                          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                          setTimeout(() => {
                            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
                          }, 10000);
                        };
                        pre.appendChild(btn);
                      });
                    }}
                  />
                  <div className="flex items-center gap-1 mt-1 ml-4">
                    {msg.durationMs != null && (
                      <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{formatDuration(msg.durationMs)}</span>
                    )}
                    <CopyButton text={msg.content} />
                    <RetryButton index={i} onRetry={retryWithModel} />
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="group/user flex flex-col self-end max-w-[90%] items-end">
                  {msg.images && msg.images.map((img, j) => (
                    <img key={j} src={img} className="block max-w-full max-h-[300px] rounded-lg mb-1.5 object-contain cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLightboxImage(img)} />
                  ))}
                  {msg.pdfs && msg.pdfs.map((pdf, j) => (
                    <div key={`pdf-${j}`} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-neutral-200 dark:bg-neutral-700 text-[12px] mb-1.5">
                      <span className="font-medium text-red-500">PDF</span>
                      <span className="text-neutral-600 dark:text-neutral-300 max-w-[150px] truncate">{pdf.name}</span>
                    </div>
                  ))}
                {msg.content && (
                <div className="p-2.5 px-3.5 rounded-xl rounded-br-sm text-[15px] leading-relaxed break-words whitespace-pre-wrap bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-200" >
                  {msg.content}
                </div>
                )}
                <div className="flex justify-end opacity-0 group-hover/user:opacity-100 transition-opacity">
                  <CopyButton text={msg.content} />
                  <button
                    onClick={() => {
                      editPrevInputRef.current = inputValue;
                      setEditingIndex(i);
                      setInputValue(msg.content);
                      if (inputRef.current) {
                        inputRef.current.focus();
                      }
                    }}
                    className="border-none bg-transparent cursor-pointer p-1 rounded transition-colors text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
                    title="Edit"
                  >
                    <FiEdit2 size={14} />
                  </button>
                </div>
                {msg.searchResults && (msg.searchResults.results.length > 0 || (msg.searchResults.images && msg.searchResults.images.length > 0)) && (
                  <div className="self-start w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 overflow-hidden" >
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
                        <span className="text-[15px] font-medium truncate flex items-center gap-1" style={{ color: '#007AFF' }}><span className="underline truncate">{r.title}</span><FiExternalLink size={12} className="shrink-0" /></span>
                        <span className="text-[15px] text-neutral-500 dark:text-neutral-400 line-clamp-1" >{r.snippet}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {isTyping && pendingToolCalls.length > 0 && (
            <div className="flex flex-col gap-1 self-start max-w-[90%] ml-1">
              {pendingToolCalls.map((tc) => (
                <ToolCallRow key={tc.toolCallId} toolCall={tc} />
              ))}
              {pendingToolCalls.some(tc => (tc.toolName === 'readEmail' || tc.toolName === 'readDiscord') && tc.status === 'done') && (
                <button
                  onClick={() => onOpenSpecialTab?.()}
                  className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors cursor-pointer mt-1"
                >
                  <FiArrowRight size={12} /> Open Messages
                </button>
              )}
            </div>
          )}
          {isTyping && (
            streamingContent ? (
              <div
                className="msg-assistant p-2.5 px-3.5 rounded-xl rounded-bl text-[15px] leading-relaxed max-w-[90%] break-words text-black dark:text-neutral-200 self-start"
                dangerouslySetInnerHTML={{ __html: renderContent(streamingContent) }}
              />
            ) : (
              <div className="p-2.5 px-3.5 rounded-xl text-[15px] leading-relaxed max-w-[90%] self-start bg-transparent text-neutral-400" >
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
        {(pendingImages.length > 0 || pendingPdfs.length > 0) && (
          <div className="flex gap-2 pr-3 pb-3 pt-3 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={`img-${i}`} className="relative w-16 h-16 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800">
                <img src={img} className="w-full h-full object-cover brightness-100" />
                <button
                  className="absolute -top-0.5 -right-0.5 w-[18px] h-[18px] border-none rounded-full bg-black/50 text-white cursor-pointer flex items-center justify-center p-0 transition-colors hover:bg-black/70"
                  onClick={() => removeImage(i)}
                >
                  <IoClose size={12} />
                </button>
              </div>
            ))}
            {pendingPdfs.map((pdf, i) => (
              <div key={`pdf-${i}`} className="relative h-16 rounded-lg overflow-hidden border border-neutral-300 dark:border-neutral-600 flex items-center gap-1.5 px-2.5 bg-neutral-50 dark:bg-neutral-800">
                <span className="text-[11px] font-medium text-red-500">PDF</span>
                <span className="text-[12px] text-neutral-600 dark:text-neutral-300 max-w-[100px] truncate">{pdf.name}</span>
                <button
                  className="absolute top-0.5 right-0.5 w-[18px] h-[18px] border-none rounded-full bg-black/60 dark:bg-white/30 text-white cursor-pointer flex items-center justify-center p-0 transition-colors hover:bg-black/80 dark:hover:bg-white/50"
                  onClick={() => setPendingPdfs(prev => prev.filter((_, j) => j !== i))}
                >
                  <IoClose size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {editingIndex !== null && (
          <div className="flex items-center justify-between px-1 pb-1 no-drag">
            <span className="text-[12px] text-neutral-500 dark:text-neutral-400">Editing message</span>
            <button
              className="border-none bg-transparent cursor-pointer p-0.5 rounded transition-colors text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
              title="Cancel edit"
              onClick={() => {
                setEditingIndex(null);
                setInputValue(editPrevInputRef.current);
              }}
            >
              <IoClose size={16} />
            </button>
          </div>
        )}
        <div className="flex items-start gap-2.5 pb-0 pr-0 no-drag w-full">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              className="h-10 w-full resize-none border border-neutral-200 dark:border-neutral-700 rounded-[10px] bg-white dark:bg-neutral-900 text-black dark:text-neutral-200 text-[15px] py-2 px-3.5 outline-none max-h-[120px] overflow-hidden transition-colors placeholder:text-neutral-400 dark:placeholder:text-neutral-600 box-border"
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
                      className={`px-3 py-1.5 text-[15px] cursor-pointer flex items-center gap-2 truncate ${
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
          {isTyping ? (
            <button
              className="w-10 h-10 border-none rounded-[10px] bg-neutral-900 dark:bg-neutral-700 text-white cursor-pointer flex items-center justify-center transition-colors shrink-0 hover:bg-neutral-700 dark:hover:bg-neutral-600"
              title="Stop"
              onClick={stopChat}
            >
              <FiSquare size={16} />
            </button>
          ) : (
            <button
              className="w-10 h-10 border-none rounded-[10px] bg-neutral-900 dark:bg-neutral-700 text-white cursor-pointer flex items-center justify-center transition-colors shrink-0 hover:bg-neutral-700 dark:hover:bg-neutral-600"
              title="Send"
              onClick={() => sendChat()}
            >
              {isEmpty ? <FiArrowRight size={18} /> : <FiArrowUp size={18} />}
            </button>
          )}
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
