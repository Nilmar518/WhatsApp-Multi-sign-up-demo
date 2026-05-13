import { useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '../../../firebase/firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Thread {
  id: string;
  guestName: string;
  lastMessage: string;
  bookingId: string | null;
  updatedAt: Timestamp | null;
  isInquiry?: boolean;
  checkinDate?: string | null;
  checkoutDate?: string | null;
  listingName?: string | null;
  nights?: number | null;
  payoutAmount?: number | null;
  currency?: string | null;
  numberOfGuests?: number | null;
}

interface Message {
  id: string;
  text: string;
  sender: string;
  createdAt: Timestamp | null;
  sendStatus?: 'sending' | 'failed';
}

interface Props {
  tenantId: string;
  /** Channex property UUID — required to build the correct subcollection path. */
  propertyId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(ts: Timestamp | null): string {
  if (!ts) return '';
  return ts.toDate().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatThreadTime(ts: Timestamp | null): string {
  if (!ts) return '';
  const date = ts.toDate();
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  return isToday
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMoney(amount: number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined) return '';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingInbox({ tenantId, propertyId }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Subscribe to threads ──────────────────────────────────────────────────
  // Path: channex_integrations/{tenantId}/properties/{propertyId}/threads
  useEffect(() => {
    if (!propertyId) {
      setLoadingThreads(true);
      return;
    }

    setLoadingThreads(true);
    setError(null);

    const q = query(
      collection(db, 'channex_integrations', tenantId, 'properties', propertyId, 'threads'),
      orderBy('updatedAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setThreads(
          snapshot.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              guestName: (data.guestName as string | undefined) ?? 'Unknown Guest',
              lastMessage: (data.lastMessage as string | undefined) ?? '',
              bookingId: (data.bookingId as string | null | undefined) ?? null,
              updatedAt: (data.updatedAt as Timestamp | null | undefined) ?? null,
              isInquiry: (data.isInquiry as boolean | undefined) ?? false,
              checkinDate: (data.checkinDate as string | null | undefined) ?? null,
              checkoutDate: (data.checkoutDate as string | null | undefined) ?? null,
              listingName: (data.listingName as string | null | undefined) ?? null,
              nights: (data.nights as number | null | undefined) ?? null,
              payoutAmount: (data.payoutAmount as number | null | undefined) ?? null,
              currency: (data.currency as string | null | undefined) ?? null,
              numberOfGuests: (data.numberOfGuests as number | null | undefined) ?? null,
            } satisfies Thread;
          }),
        );
        setLoadingThreads(false);
      },
      (err) => {
        setError(err.message);
        setLoadingThreads(false);
      },
    );

    return () => {
      unsubscribe();
      setThreads([]);
      setActiveThreadId(null);
    };
  }, [tenantId, propertyId]);

  // ── Subscribe to messages for the active thread ───────────────────────────
  // Path: .../properties/{propertyId}/threads/{threadId}/messages
  useEffect(() => {
    if (!activeThreadId || !propertyId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);

    const q = query(
      collection(
        db,
        'channex_integrations', tenantId,
        'properties', propertyId,
        'threads', activeThreadId,
        'messages',
      ),
      orderBy('createdAt', 'asc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setMessages(
          snapshot.docs.map((d) => ({
            id: d.id,
            text: (d.data().text as string | undefined) ?? '',
            sender: (d.data().sender as string | undefined) ?? 'unknown',
            createdAt: (d.data().createdAt as Timestamp | null | undefined) ?? null,
            sendStatus: d.data().sendStatus as Message['sendStatus'] | undefined,
          })),
        );
        setLoadingMessages(false);
      },
      (err) => {
        setError(err.message);
        setLoadingMessages(false);
      },
    );

    return () => unsubscribe();
  }, [tenantId, propertyId, activeThreadId]);

  // ── Scroll to bottom on new messages ──────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Reset input when switching threads ────────────────────────────────────
  useEffect(() => {
    setReplyText('');
    setSending(false);
  }, [activeThreadId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveThreadId(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Send reply ────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = replyText.trim();
    if (!text || !activeThreadId || !propertyId || sending) return;

    setSending(true);
    setReplyText('');

    const optimisticId = generateId();
    const messageRef = doc(
      db,
      'channex_integrations', tenantId,
      'properties', propertyId,
      'threads', activeThreadId,
      'messages', optimisticId,
    );

    await setDoc(messageRef, {
      text,
      sender: 'host',
      createdAt: serverTimestamp(),
      sendStatus: 'sending',
    });

    try {
      const res = await fetch('/api/booking/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, threadId: activeThreadId, message: text }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }

      await updateDoc(messageRef, { sendStatus: null });
    } catch (err: unknown) {
      await updateDoc(messageRef, { sendStatus: 'failed' }).catch(() => {});
      setError(`Failed to send reply: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // ── Loading (waiting for propertyId to resolve) ───────────────────────────
  if (loadingThreads) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface-subtle px-4 py-4 text-sm text-content-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-notice-text" />
        {propertyId ? 'Loading inbox…' : 'Waiting for property…'}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-sm">

      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-danger-bg bg-danger-bg px-4 py-2 text-xs text-danger-text">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0 font-semibold hover:text-danger-text">
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-edge bg-surface-subtle px-6 py-5">
        <h2 className="text-xl font-semibold text-content">Guest Inbox</h2>
        <p className="mt-1 text-sm text-content-2">
          Booking.com messages and inquiries delivered via Channex.
        </p>
      </div>

      {/* Two-pane layout */}
      <div className="flex" style={{ height: '520px' }}>

        {/* Thread list */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-edge">
          {threads.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-notice-bg">
                <svg className="h-6 w-6 text-notice-text" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-content-2">No messages yet</p>
              <p className="mt-1 text-xs text-content-3">
                Guest messages will appear here once Booking.com delivers them.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-edge">
              {threads.map((thread) => {
                const isActive = thread.id === activeThreadId;
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => setActiveThreadId(thread.id)}
                      className={['w-full text-left px-4 py-4 transition-colors', isActive ? 'bg-notice-bg' : 'hover:bg-surface-subtle'].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={['truncate text-sm font-semibold', isActive ? 'text-notice-text' : 'text-content'].join(' ')}>
                          {thread.guestName}
                        </span>
                        <span className="shrink-0 text-[11px] text-content-3">
                          {formatThreadTime(thread.updatedAt)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-content-2">
                        {thread.isInquiry ? '📋 Inquiry' : thread.lastMessage}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {thread.isInquiry && (
                          <span className="inline-flex items-center rounded-full bg-caution-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-caution-text">
                            Inquiry
                          </span>
                        )}
                        {thread.bookingId && !thread.isInquiry && (
                          <span className="inline-flex items-center rounded-full bg-notice-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-notice-text">
                            {thread.bookingId}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Message pane */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Thread header */}
          {activeThread ? (
            <div className="flex items-start gap-3 border-b border-edge bg-surface-raised px-5 py-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-notice-bg text-sm font-bold text-notice-text">
                {activeThread.guestName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-content">{activeThread.guestName}</p>
                {activeThread.isInquiry ? (
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-content-3">
                    {activeThread.listingName && <span>{activeThread.listingName}</span>}
                    {activeThread.checkinDate && (
                      <span>{activeThread.checkinDate} → {activeThread.checkoutDate ?? '?'}</span>
                    )}
                    {activeThread.nights && <span>{activeThread.nights}n</span>}
                    {activeThread.numberOfGuests && <span>{activeThread.numberOfGuests} guests</span>}
                    {activeThread.payoutAmount != null && (
                      <span className="font-medium text-content-2">
                        {formatMoney(activeThread.payoutAmount, activeThread.currency ?? 'USD')}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-content-3">
                    {activeThread.bookingId ? `Booking · ${activeThread.bookingId}` : 'Guest message'}
                    {activeThread.checkinDate && ` · ${activeThread.checkinDate} → ${activeThread.checkoutDate ?? '?'}`}
                  </p>
                )}
              </div>
              {activeThread.isInquiry && (
                <span className="shrink-0 rounded-full border border-caution-bg bg-caution-bg px-2 py-0.5 text-[10px] font-semibold text-caution-text">
                  Inquiry
                </span>
              )}
            </div>
          ) : (
            <div className="border-b border-edge bg-surface-raised px-5 py-3.5">
              <p className="text-sm text-content-3">Select a conversation from the left</p>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-3 bg-surface-subtle/50 px-5 py-4">
            {!activeThreadId && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-content-3">Choose a thread to view the conversation.</p>
              </div>
            )}
            {activeThreadId && loadingMessages && (
              <div className="flex items-center gap-2 text-sm text-content-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-notice-text" />
                Loading messages…
              </div>
            )}
            {activeThreadId && !loadingMessages && messages.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-content-3">
                  {activeThread?.isInquiry
                    ? 'Inquiry received. Reply below to respond to the guest.'
                    : 'No messages in this thread yet.'}
                </p>
              </div>
            )}
            {messages.map((message) => {
              const isGuest = message.sender === 'guest';
              const isFailed = message.sendStatus === 'failed';
              const isSending = message.sendStatus === 'sending';
              return (
                <div key={message.id} className={['flex', isGuest ? 'justify-start' : 'justify-end'].join(' ')}>
                  <div className={[
                    'max-w-[72%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm',
                    isGuest
                      ? 'rounded-tl-sm bg-surface-raised text-content ring-1 ring-edge'
                      : isFailed
                        ? 'rounded-tr-sm bg-danger-bg text-danger-text ring-1 ring-danger-bg'
                        : 'rounded-tr-sm bg-brand text-white',
                  ].join(' ')}>
                    <p>{message.text}</p>
                    <p className={['mt-1 flex items-center justify-end gap-1 text-[10px]', isGuest ? 'text-content-3' : isFailed ? 'text-danger-text' : 'text-white/70'].join(' ')}>
                      {isFailed && <span>Failed to send ·</span>}
                      {isSending && <span>Sending…</span>}
                      {!isSending && formatTime(message.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply input */}
          {activeThreadId && (
            <div className="border-t border-edge bg-surface-raised px-4 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Reply to guest… (⌘↵ to send)"
                  disabled={sending}
                  className="flex-1 resize-none rounded-xl border border-edge bg-surface-subtle px-3 py-2.5 text-sm text-content placeholder:text-content-3 outline-none transition focus:border-brand focus:bg-surface-raised focus:ring-4 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={!replyText.trim() || sending}
                  onClick={() => void handleSend()}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-sm transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-content-3"
                  aria-label="Send reply"
                >
                  {sending ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
