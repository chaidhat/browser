import { useState, useEffect, useRef, useCallback } from 'react';
import { FiMail, FiMessageCircle, FiArrowRight } from 'react-icons/fi';

interface LinkedMessage {
  messageId: string;
  source: string;
  subject?: string;
  from?: string;
  author?: string;
  content?: string;
}

interface Props {
  tabId: number;
  hidden?: boolean;
  linkedMessageIds?: string[];
  onGoToMessage?: (messageId: string) => void;
}

export function NotesView({ tabId, hidden, linkedMessageIds, onGoToMessage }: Props) {
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [linkedMessages, setLinkedMessages] = useState<LinkedMessage[]>([]);

  useEffect(() => {
    window.browser.loadNoteContent(tabId).then((text: string) => {
      setContent(text || '');
      setLoaded(true);
    });
  }, [tabId]);

  useEffect(() => {
    if (!linkedMessageIds?.length) { setLinkedMessages([]); return; }
    window.browser.dbGetMessagesByIds(linkedMessageIds).then((rows: any[]) => {
      setLinkedMessages(rows.map(r => ({
        messageId: r.message_id,
        source: r.source,
        subject: r.email_subject,
        from: r.email_from,
        author: r.discord_author,
        content: r.discord_content,
      })));
    }).catch(() => {});
  }, [linkedMessageIds]);

  const handleChange = useCallback((text: string) => {
    setContent(text);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      window.browser.saveNoteContent(tabId, text).catch(() => {});
    }, 500);
  }, [tabId]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  if (!loaded) return null;

  return (
    <div className={`absolute inset-0 flex flex-col bg-white dark:bg-[#111] ${hidden ? 'invisible' : ''}`} data-tab-id={tabId}>
      {linkedMessages.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
          {linkedMessages.map(msg => (
            <button
              key={msg.messageId}
              onClick={() => onGoToMessage?.(msg.messageId)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
            >
              {msg.source === 'email' ? (
                <FiMail size={11} className="text-blue-500 shrink-0" />
              ) : (
                <FiMessageCircle size={11} className="text-pink-500 shrink-0" />
              )}
              <span className="truncate max-w-[200px]">
                {msg.source === 'email' ? (msg.subject || msg.from || 'Email') : (msg.author || 'Discord')}
              </span>
              <FiArrowRight size={10} className="text-neutral-400 shrink-0" />
            </button>
          ))}
        </div>
      )}
      <textarea
        value={content}
        onChange={e => handleChange(e.target.value)}
        className="flex-1 w-full resize-none border-none outline-none bg-transparent text-[14px] leading-relaxed text-neutral-800 dark:text-neutral-200 p-6 font-mono"
        placeholder="Write notes here..."
        spellCheck={false}
      />
    </div>
  );
}
