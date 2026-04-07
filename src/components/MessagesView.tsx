import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiRefreshCw, FiMail, FiMessageCircle, FiAlertCircle, FiInbox, FiX, FiChevronsRight } from 'react-icons/fi';

type MessageItem =
  | { source: 'email'; time: number; subject: string; from: string; date: string; preview: string; seq: number; uid: number }
  | { source: 'discord'; time: number; author: string; content: string; dateStr: string; attachments: number; id: string }
  | { source: 'custom'; time: number; subject: string; sender: string; body: string; id: string };

type SelectedItem =
  | { source: 'email'; uid: number }
  | { source: 'discord'; id: string }
  | { source: 'custom'; id: string };

interface EmailDetail {
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  html: string;
}

interface Props {
  tabId: number;
  hidden?: boolean;
}

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function formatFullDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getAuthorColor(author: string): string {
  const colors = ['#5865F2', '#EB459E', '#57F287', '#FEE75C', '#ED4245', '#FF7B3A', '#9B59B6', '#1ABC9C'];
  let hash = 0;
  for (let i = 0; i < author.length; i++) hash = ((hash << 5) - hash + author.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function itemKey(item: MessageItem): string {
  if (item.source === 'email') return `email:${item.uid}`;
  if (item.source === 'discord') return `discord:${item.id}`;
  return item.id; // custom already has full id
}

function isSelected(item: MessageItem, sel: SelectedItem | null): boolean {
  if (!sel) return false;
  if (item.source === 'email' && sel.source === 'email') return item.uid === sel.uid;
  if (item.source === 'discord' && sel.source === 'discord') return item.id === sel.id;
  if (item.source === 'custom' && sel.source === 'custom') return item.id === sel.id;
  return false;
}

// Convert a MessageItem to a DB row for upsert
function toDbRow(item: MessageItem) {
  return {
    id: itemKey(item),
    source: item.source,
    time: item.time,
    email_subject: item.source === 'email' ? item.subject : item.source === 'custom' ? item.subject : null,
    email_from: item.source === 'email' ? item.from : item.source === 'custom' ? item.sender : null,
    email_preview: item.source === 'email' ? item.preview : item.source === 'custom' ? item.body.slice(0, 200) : null,
    email_seq: item.source === 'email' ? item.seq : null,
    email_uid: item.source === 'email' ? item.uid : null,
    discord_author: item.source === 'discord' ? item.author : null,
    discord_content: item.source === 'discord' ? item.content : null,
    discord_attachments: item.source === 'discord' ? item.attachments : 0,
    date_str: item.source === 'email' ? item.date : item.source === 'discord' ? item.dateStr : new Date(item.time).toISOString(),
  };
}

// Convert a DB row back to a MessageItem
function fromDbRow(row: any): MessageItem {
  if (row.source === 'email') {
    return { source: 'email', time: row.time, subject: row.email_subject || '', from: row.email_from || '', date: row.date_str || '', preview: row.email_preview || '', seq: row.email_seq || 0, uid: row.email_uid || 0 };
  }
  if (row.source === 'discord') {
    return { source: 'discord', time: row.time, author: row.discord_author || '', content: row.discord_content || '', dateStr: row.date_str || '', attachments: row.discord_attachments || 0, id: row.id.replace('discord:', '') };
  }
  return { source: 'custom', time: row.time, subject: row.email_subject || '', sender: row.email_from || '', body: row.email_preview || '', id: row.id };
}

// Detail panel for a selected message
function DetailPanel({ selected, items, onClose }: { selected: SelectedItem; items: MessageItem[]; onClose: () => void }) {
  const item = items.find(i => isSelected(i, selected));
  const [emailDetail, setEmailDetail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (selected.source === 'email') {
      setDetailLoading(true);
      setDetailError(null);
      setEmailDetail(null);
      // Try DB cache first
      window.browser.dbGetEmailBody(selected.uid)
        .then(cached => {
          if (cached) {
            setEmailDetail({ subject: cached.subject, from: cached.sender, to: cached.recipient, date: cached.date_str, body: cached.body, html: cached.html });
            setDetailLoading(false);
            return;
          }
          // Fetch from IMAP
          return window.browser.readEmailMessage({ uid: selected.uid })
            .then(result => {
              if (result.error) { setDetailError(result.error); }
              else {
                const detail = result as EmailDetail;
                setEmailDetail(detail);
                // Cache in DB
                window.browser.dbSaveEmailBody({ uid: selected.uid, subject: detail.subject, sender: detail.from, recipient: detail.to, date_str: detail.date, body: detail.body, html: detail.html }).catch(() => {});
              }
            });
        })
        .catch(err => setDetailError(err instanceof Error ? err.message : String(err)))
        .finally(() => setDetailLoading(false));
    } else if (selected.source === 'custom') {
      setDetailLoading(true);
      setDetailError(null);
      setEmailDetail(null);
      window.browser.dbGetCustomMessage(selected.id)
        .then(msg => {
          if (msg) setEmailDetail({ subject: msg.subject, from: msg.sender, to: '', date: new Date(msg.time).toISOString(), body: msg.body, html: '' });
          else setDetailError('Message not found.');
        })
        .catch(err => setDetailError(err instanceof Error ? err.message : String(err)))
        .finally(() => setDetailLoading(false));
    }
  }, [selected]);

  if (!item) return null;

  if (item.source === 'discord') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 h-11 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <button onClick={onClose} className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 border-none bg-transparent cursor-pointer text-neutral-500">
            <FiChevronsRight size={14} />
          </button>
          <FiMessageCircle size={14} className="text-pink-500" />
          <span className="text-[13px] font-medium text-neutral-800 dark:text-neutral-200">Discord Message</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-[16px] font-semibold" style={{ color: getAuthorColor(item.author) }}>{item.author}</span>
            <span className="text-[12px] text-neutral-400">{formatFullDate(item.time)}</span>
          </div>
          <div className="text-[15px] text-neutral-800 dark:text-neutral-200 leading-relaxed whitespace-pre-wrap">
            {item.content}
          </div>
          {item.attachments > 0 && (
            <div className="mt-3 text-[13px] text-neutral-400">
              {item.attachments} attachment{item.attachments > 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Email / Custom detail
  const detailTitle = item.source === 'email' ? item.subject : item.source === 'custom' ? item.subject : '';
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 h-11 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <button onClick={onClose} className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 border-none bg-transparent cursor-pointer text-neutral-500">
          <FiChevronsRight size={14} />
        </button>
        {item.source === 'email' ? <FiMail size={14} className="text-blue-500" /> : <FiInbox size={14} className="text-neutral-500" />}
        <span className="text-[13px] font-medium text-neutral-800 dark:text-neutral-200 truncate flex-1">{detailTitle}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {detailLoading && (
          <div className="flex items-center justify-center h-32 text-neutral-400 text-[14px]">Loading...</div>
        )}
        {detailError && (
          <div className="p-4 text-[14px] text-red-500">{detailError}</div>
        )}
        {emailDetail && (
          <div className="p-4">
            <h2 className="text-[18px] font-semibold text-neutral-800 dark:text-neutral-200 mb-3">{emailDetail.subject}</h2>
            <div className="flex flex-col gap-1 mb-4 text-[13px]">
              <div className="flex gap-2">
                <span className="text-neutral-400 w-10 shrink-0">From</span>
                <span className="text-neutral-700 dark:text-neutral-300">{emailDetail.from}</span>
              </div>
              {emailDetail.to && (
                <div className="flex gap-2">
                  <span className="text-neutral-400 w-10 shrink-0">To</span>
                  <span className="text-neutral-700 dark:text-neutral-300">{emailDetail.to}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-neutral-400 w-10 shrink-0">Date</span>
                <span className="text-neutral-700 dark:text-neutral-300">{formatFullDate(new Date(emailDetail.date).getTime())}</span>
              </div>
            </div>
            <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4">
              {emailDetail.html ? (
                <div
                  className="text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200 [&_a]:text-blue-500 [&_a]:underline [&_img]:max-w-full [&_img]:h-auto"
                  dangerouslySetInnerHTML={{ __html: emailDetail.html }}
                />
              ) : (
                <pre className="text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap font-[inherit]">
                  {emailDetail.body}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MessagesView({ tabId, hidden }: Props) {
  const [items, setItems] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'email' | 'discord' | 'custom'>('all');
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [listWidth, setListWidth] = useState(380);
  const resizingRef = useRef(false);
  const [emailTotal, setEmailTotal] = useState<number | null>(null);

  // Pagination cursors: track oldest seq for email, oldest message ID for discord
  const emailOldestSeqRef = useRef<number | null>(null); // null = no more
  const discordOldestIdRef = useRef<string | null>(null); // null = no more
  const observerRef = useRef<IntersectionObserver | null>(null);
  const itemsRef = useRef<MessageItem[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const fetchAbortRef = useRef(false);
  const targetDateRef = useRef<number>(0);
  // Track oldest fetched time per source directly in refs (not via React state)
  const emailOldestTimeRef = useRef<number>(Infinity);
  const discordOldestTimeRef = useRef<number>(Infinity);

  const sourceReachedTarget = useCallback((source: 'email' | 'discord', target: number): boolean => {
    if (source === 'email') {
      if (emailOldestSeqRef.current === null) return true; // exhausted
      return emailOldestTimeRef.current <= target;
    } else {
      if (discordOldestIdRef.current === null) return true; // exhausted
      return discordOldestTimeRef.current <= target;
    }
  }, []);

  // Fetch loop: keep loading from each source INDEPENDENTLY until it reaches targetDate
  // If email already reached x, only fetch discord (and vice versa). Stop when both are done.
  const fetchUntilTarget = useCallback(async (targetDate: number, batchSize = 50) => {
    while (!fetchAbortRef.current) {
      const emailDone = sourceReachedTarget('email', targetDate);
      const discordDone = sourceReachedTarget('discord', targetDate);
      if (emailDone && discordDone) break;

      const promises: Promise<any>[] = [];
      const fetchingEmail = !emailDone && emailOldestSeqRef.current !== null;
      const fetchingDiscord = !discordDone && discordOldestIdRef.current !== null;

      if (!fetchingEmail && !fetchingDiscord) break; // both exhausted or done

      if (fetchingEmail) {
        promises.push(
          window.browser.readEmail({ limit: batchSize, beforeSeq: emailOldestSeqRef.current! }).catch(() => null)
        );
      } else {
        promises.push(Promise.resolve(null));
      }

      if (fetchingDiscord) {
        promises.push(
          window.browser.readDiscord({ limit: batchSize, before: discordOldestIdRef.current! }).catch(() => null)
        );
      } else {
        promises.push(Promise.resolve(null));
      }

      const [emailResult, discordResult] = await Promise.all(promises);
      if (fetchAbortRef.current) break;

      const newItems: MessageItem[] = [];
      let gotAny = false;

      if (fetchingEmail && emailResult && !emailResult.error && emailResult.messages && emailResult.messages.length > 0) {
        gotAny = true;
        for (const msg of emailResult.messages) {
          const t = msg.date ? new Date(msg.date).getTime() : 0;
          newItems.push({
            source: 'email', time: t,
            subject: msg.subject, from: msg.from, date: msg.date, preview: msg.preview, seq: msg.seq || 0, uid: msg.uid || 0,
          });
          if (t > 0 && t < emailOldestTimeRef.current) emailOldestTimeRef.current = t;
        }
        const minSeq = Math.min(...emailResult.messages.map((m: any) => m.seq || 0));
        emailOldestSeqRef.current = minSeq > 1 ? minSeq : null;
      } else if (fetchingEmail) {
        emailOldestSeqRef.current = null; // exhausted
      }

      if (fetchingDiscord && discordResult && !discordResult.error && discordResult.messages && discordResult.messages.length > 0) {
        gotAny = true;
        for (const msg of discordResult.messages) {
          const t = msg.time ? new Date(msg.time).getTime() : 0;
          newItems.push({
            source: 'discord', time: t,
            author: msg.author, content: msg.content, dateStr: msg.time, attachments: msg.attachments, id: msg.id || '',
          });
          if (t > 0 && t < discordOldestTimeRef.current) discordOldestTimeRef.current = t;
        }
        const oldest = discordResult.messages[discordResult.messages.length - 1];
        discordOldestIdRef.current = discordResult.messages.length >= batchSize && oldest?.id ? oldest.id : null;
      } else if (fetchingDiscord) {
        discordOldestIdRef.current = null; // exhausted
      }

      if (newItems.length > 0) {
        setItems(prev => {
          const existing = new Set(prev.map(itemKey));
          const deduped = newItems.filter(item => !existing.has(itemKey(item)));
          if (deduped.length === 0) return prev;
          const merged = [...prev, ...deduped];
          merged.sort((a, b) => b.time - a.time);
          return merged;
        });
        // Persist to DB in background
        window.browser.dbUpsertMessages(newItems.map(toDbRow)).catch(() => {});
        window.browser.dbSaveCursors({
          emailOldestSeq: emailOldestSeqRef.current,
          discordOldestId: discordOldestIdRef.current,
        }).catch(() => {});
      }

      if (!gotAny) break;
    }
  }, [sourceReachedTarget]);

  // Persist new items to SQLite
  const persistToDb = useCallback(async (newItems: MessageItem[]) => {
    if (newItems.length === 0) return;
    try { await window.browser.dbUpsertMessages(newItems.map(toDbRow)); } catch { /* ignore */ }
  }, []);

  const preloadEmailBodies = useCallback(async () => {
    // Find all email UIDs in current items that don't have cached bodies yet
    const emailItems = itemsRef.current.filter(i => i.source === 'email') as Extract<MessageItem, { source: 'email' }>[];
    if (emailItems.length === 0) return;

    for (const email of emailItems) {
      if (fetchAbortRef.current) break;
      // Check if already cached
      const cached = await window.browser.dbGetEmailBody(email.uid).catch(() => null);
      if (cached) continue;
      // Fetch and cache
      try {
        const result = await window.browser.readEmailMessage({ uid: email.uid });
        if (!result.error && result.subject) {
          await window.browser.dbSaveEmailBody({
            uid: email.uid,
            subject: result.subject || '',
            sender: result.from || '',
            recipient: result.to || '',
            date_str: result.date || '',
            body: result.body || '',
            html: result.html || '',
          });
        }
      } catch { /* skip */ }
    }
  }, []);

  const fetchInitial = useCallback(async () => {
    setEmailError(null);
    setDiscordError(null);
    fetchAbortRef.current = true;
    await new Promise(r => setTimeout(r, 0));
    fetchAbortRef.current = false;
    emailOldestSeqRef.current = null;
    discordOldestIdRef.current = null;
    emailOldestTimeRef.current = Infinity;
    discordOldestTimeRef.current = Infinity;

    // 1. Load from SQLite cache first for instant display
    try {
      const cached = await window.browser.dbGetMessages({ limit: 100000 });
      if (cached && cached.length > 0) {
        const cachedItems = cached.map(fromDbRow);
        // Update oldest time refs from cache
        for (const item of cachedItems) {
          if (item.source === 'email' && item.time > 0 && item.time < emailOldestTimeRef.current) emailOldestTimeRef.current = item.time;
          if (item.source === 'discord' && item.time > 0 && item.time < discordOldestTimeRef.current) discordOldestTimeRef.current = item.time;
        }
        setItems(cachedItems);
        setLoading(false); // show cached data immediately
      }
    } catch { /* no cache yet */ }

    // 2. Load saved cursors
    try {
      const cursors = await window.browser.dbLoadCursors();
      if (cursors.emailOldestSeq) emailOldestSeqRef.current = cursors.emailOldestSeq;
      if (cursors.discordOldestId) discordOldestIdRef.current = cursors.discordOldestId;
    } catch { /* ignore */ }

    // 3. Fetch fresh data from APIs
    const [emailResult, discordResult] = await Promise.all([
      window.browser.readEmail({ limit: 20 }).catch(err => ({ error: err instanceof Error ? err.message : String(err) } as const)),
      window.browser.readDiscord({ limit: 20 }).catch(err => ({ error: err instanceof Error ? err.message : String(err) } as const)),
    ]);

    if (emailResult.error) setEmailError(emailResult.error);
    if (discordResult.error) setDiscordError(discordResult.error);

    const freshItems: MessageItem[] = [];

    if (!emailResult.error && emailResult.messages && emailResult.messages.length > 0) {
      if (emailResult.messageCount) setEmailTotal(emailResult.messageCount);
      for (const msg of emailResult.messages) {
        const t = msg.date ? new Date(msg.date).getTime() : 0;
        freshItems.push({
          source: 'email', time: t,
          subject: msg.subject, from: msg.from, date: msg.date, preview: msg.preview, seq: msg.seq || 0, uid: msg.uid || 0,
        });
        if (t > 0 && t < emailOldestTimeRef.current) emailOldestTimeRef.current = t;
      }
      const minSeq = Math.min(...emailResult.messages.map(m => m.seq || 0));
      emailOldestSeqRef.current = minSeq > 1 ? minSeq : null;
    }

    if (!discordResult.error && discordResult.messages && discordResult.messages.length > 0) {
      for (const msg of discordResult.messages) {
        const t = msg.time ? new Date(msg.time).getTime() : 0;
        freshItems.push({
          source: 'discord', time: t,
          author: msg.author, content: msg.content, dateStr: msg.time, attachments: msg.attachments, id: msg.id || '',
        });
        if (t > 0 && t < discordOldestTimeRef.current) discordOldestTimeRef.current = t;
      }
      const oldest = discordResult.messages[discordResult.messages.length - 1];
      discordOldestIdRef.current = discordResult.messages.length >= 20 && oldest?.id ? oldest.id : null;
    }

    // Merge fresh with existing (cached) items
    setItems(prev => {
      const existing = new Map(prev.map(item => [itemKey(item), item]));
      for (const item of freshItems) existing.set(itemKey(item), item);
      const merged = Array.from(existing.values());
      merged.sort((a, b) => b.time - a.time);
      return merged;
    });
    setLoading(false);

    // Persist fresh items to DB
    persistToDb(freshItems);

    // Save cursors
    window.browser.dbSaveCursors({
      emailOldestSeq: emailOldestSeqRef.current,
      discordOldestId: discordOldestIdRef.current,
    }).catch(() => {});

    // Preload 1 month in background (skip if cache already covers it)
    const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    targetDateRef.current = oneMonthAgo;
    const emailAlreadyReached = sourceReachedTarget('email', oneMonthAgo);
    const discordAlreadyReached = sourceReachedTarget('discord', oneMonthAgo);
    if (!emailAlreadyReached || !discordAlreadyReached) {
      await fetchUntilTarget(oneMonthAgo);
    }

    // Pre-cache all email bodies in background
    preloadEmailBodies();
  }, [fetchUntilTarget, persistToDb]);

  const loadMore = useCallback(async () => {
    if (emailOldestSeqRef.current === null && discordOldestIdRef.current === null) return;
    if (loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    // Load one more month beyond what we have, then stop
    const oldestEmailTime = emailOldestTimeRef.current === Infinity ? Date.now() : emailOldestTimeRef.current;
    const oldestDiscordTime = discordOldestTimeRef.current === Infinity ? Date.now() : discordOldestTimeRef.current;
    const oldestLoaded = Math.min(oldestEmailTime, oldestDiscordTime);
    const newTarget = oldestLoaded - 30 * 24 * 60 * 60 * 1000;
    targetDateRef.current = newTarget;

    await fetchUntilTarget(newTarget);

    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [fetchUntilTarget]);

  useEffect(() => {
    fetchInitial();

    // Start real-time sync (IMAP IDLE + Discord polling)
    window.browser.startMessageSync().catch(() => {});

    // Listen for new messages pushed from main process
    window.browser.onNewEmails((messages) => {
      const newItems: MessageItem[] = messages.map(msg => ({
        source: 'email' as const,
        time: msg.date ? new Date(msg.date).getTime() : Date.now(),
        subject: msg.subject, from: msg.from, date: msg.date, preview: msg.preview, seq: msg.seq, uid: msg.uid,
      }));
      setItems(prev => {
        const existing = new Set(prev.map(itemKey));
        const deduped = newItems.filter(item => !existing.has(itemKey(item)));
        if (deduped.length === 0) return prev;
        return [...deduped, ...prev].sort((a, b) => b.time - a.time);
      });
    });

    window.browser.onNewDiscordMessages((messages) => {
      const newItems: MessageItem[] = messages.map(msg => ({
        source: 'discord' as const,
        time: msg.time ? new Date(msg.time).getTime() : Date.now(),
        author: msg.author, content: msg.content, dateStr: msg.time, attachments: msg.attachments, id: msg.id,
      }));
      setItems(prev => {
        const existing = new Set(prev.map(itemKey));
        const deduped = newItems.filter(item => !existing.has(itemKey(item)));
        if (deduped.length === 0) return prev;
        return [...deduped, ...prev].sort((a, b) => b.time - a.time);
      });
    });

    window.browser.onEmailsRemoved((uids) => {
      const removedKeys = new Set(uids.map(uid => `email:${uid}`));
      setItems(prev => prev.filter(item => !removedKeys.has(itemKey(item))));
    });

    return () => {
      fetchAbortRef.current = true;
      window.browser.stopMessageSync().catch(() => {});
    };
  }, [fetchInitial]);

  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  // Callback ref for sentinel — sets up observer when element mounts, cleans up when it unmounts
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (node) {
      const observer = new IntersectionObserver(
        (entries) => { if (entries[0]?.isIntersecting) loadMoreRef.current(); },
        { rootMargin: '300px' }
      );
      observer.observe(node);
      observerRef.current = observer;
    }
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter(m => m.source === filter);
  }, [items, filter]);

  const emailCount = useMemo(() => items.filter(m => m.source === 'email').length, [items]);
  const discordCount = useMemo(() => items.filter(m => m.source === 'discord').length, [items]);
  const customCount = useMemo(() => items.filter(m => m.source === 'custom').length, [items]);
  const bothErrored = !!emailError && !!discordError;
  const noItems = !loading && filtered.length === 0 && !bothErrored;

  return (
    <div className={`absolute inset-0 flex bg-white dark:bg-[#111] ${hidden ? 'invisible' : ''}`} data-tab-id={tabId}>
      {/* Left: message list */}
      <div className={`flex flex-col shrink-0 min-w-0 h-full`} style={selected ? { width: listWidth } : { flex: 1 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-11 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <div className="flex items-center gap-2">
            <FiInbox size={16} className="text-neutral-500" />
            {!selected && <span className="text-[15px] font-medium text-neutral-800 dark:text-neutral-200">Messages</span>}
            <div className="flex gap-1 ml-1">
              {([...(['all', 'email', 'discord'] as const), ...(customCount > 0 ? ['custom' as const] : [])]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border-none cursor-pointer transition-colors
                    ${filter === f
                      ? 'bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                    }`}
                >
                  {f === 'all' ? `All (${items.length})` : f === 'email' ? `Email (${emailCount})` : f === 'discord' ? `Discord (${discordCount})` : `Notes (${customCount})`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
              {emailCount}{emailTotal ? `/${emailTotal}` : ''} emails · {discordCount} discord
            </span>
            <button
              onClick={fetchInitial}
              disabled={loading}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors border-none bg-transparent cursor-pointer disabled:opacity-50"
            >
              <FiRefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {loading && items.length === 0 && (
            <div className="flex items-center justify-center h-full text-neutral-400 text-[14px]">Loading messages...</div>
          )}

          {bothErrored && !selected && (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
              <FiAlertCircle size={24} className="text-neutral-400" />
              <p className="text-[14px] text-neutral-500 dark:text-neutral-400">{emailError}</p>
              <p className="text-[14px] text-neutral-500 dark:text-neutral-400">{discordError}</p>
            </div>
          )}

          {!bothErrored && (emailError || discordError) && (
            <div className="px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
              {emailError && <span>Email: {emailError}</span>}
              {emailError && discordError && <span> · </span>}
              {discordError && <span>Discord: {discordError}</span>}
            </div>
          )}

          {noItems && !selected && (
            <div className="flex items-center justify-center h-full text-neutral-400 text-[14px]">No messages found</div>
          )}

          {filtered.map((item) => {
            const active = isSelected(item, selected);
            const title = item.source === 'email' ? item.subject : item.source === 'discord' ? item.content : item.subject;
            const sender = item.source === 'email' ? item.from : item.source === 'discord' ? item.author : item.sender;
            const key = itemKey(item);
            const sourceLabel = item.source === 'email' ? 'Email' : item.source === 'discord' ? 'Discord' : 'Note';
            const sourceColor = item.source === 'email' ? 'text-blue-500' : item.source === 'discord' ? 'text-pink-500' : 'text-neutral-500';
            return (
              <div
                key={key}
                onClick={() => {
                  if (item.source === 'email') setSelected({ source: 'email', uid: item.uid });
                  else if (item.source === 'discord') setSelected({ source: 'discord', id: item.id });
                  else setSelected({ source: 'custom', id: item.id });
                }}
                className={`flex items-center gap-3 px-4 h-9 border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors cursor-pointer
                  ${active ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
              >
                <span className={`text-[11px] font-medium w-[50px] shrink-0 ${sourceColor}`}>
                  {sourceLabel}
                </span>
                <span className="text-[12px] text-neutral-700 dark:text-neutral-300 truncate w-[120px] shrink-0">
                  {sender}
                </span>
                <span className="text-[13px] text-neutral-800 dark:text-neutral-200 truncate flex-1 min-w-0">
                  {title}
                </span>
                <span className="text-[11px] text-neutral-400 w-[70px] shrink-0 text-right">
                  {formatTime(item.time)}
                </span>
              </div>
            );
          })}

          <div ref={sentinelRef} className="h-1" />

          {loadingMore && (
            <div className="flex items-center justify-center py-4 text-neutral-400 text-[13px]">
              <FiRefreshCw size={13} className="animate-spin mr-2" />
              Loading more...
            </div>
          )}
        </div>
      </div>

      {/* Resize handle + detail panel */}
      {selected && (
        <>
          <div
            className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors border-l border-neutral-200 dark:border-neutral-800"
            onMouseDown={(e) => {
              e.preventDefault();
              resizingRef.current = true;
              const startX = e.clientX;
              const startWidth = listWidth;
              const onMove = (ev: MouseEvent) => {
                if (!resizingRef.current) return;
                const newWidth = Math.max(200, Math.min(800, startWidth + ev.clientX - startX));
                setListWidth(newWidth);
              };
              const onUp = () => {
                resizingRef.current = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
              };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          />
          <div className="flex-1 min-w-0 h-full">
            <DetailPanel selected={selected} items={items} onClose={() => setSelected(null)} />
          </div>
        </>
      )}
    </div>
  );
}
