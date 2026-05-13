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
import { db } from '../../firebase/firebase';
import type { ActiveProperty } from '../../integrations/airbnb/AirbnbIntegration';

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
  guestCount?: number | null;
  adultCount?: number | null;
  childCount?: number | null;
  numberOfGuests?: number | null;
  numberOfAdults?: number | null;
  numberOfChildren?: number | null;
  numberOfInfants?: number | null;
  numberOfPets?: number | null;
  payoutAmount?: number | null;
  currency?: string | null;
  bookingDetails?: Record<string, unknown> | null;
}

interface Message {
  id: string;
  text: string;
  sender: string;
  createdAt: Timestamp | null;
  sendStatus?: 'sending' | 'failed';
}

interface Props {
  /**
   * The Firestore document ID of the `channex_integrations` document for the
   * active tenant. Passed in by `AirbnbIntegration` (which already holds it
   * from its own snapshot) to avoid a duplicate resolution query.
   */
  integrationDocId: string | null;
  /**
   * The currently selected Airbnb listing (1:1 model). Threads and messages
   * are scoped to this property's subcollection path. When null the inbox
   * shows an empty state prompting the user to select a listing.
   */
  activeProperty: ActiveProperty | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(ts: Timestamp | null): string {
  if (!ts) return '';
  return ts.toDate().toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
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

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBookingDetail(
  details: Record<string, unknown> | null | undefined,
  keys: string[],
): unknown {
  if (!details) return undefined;

  for (const key of keys) {
    const value = details[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function toDateLabel(value: string | null | undefined): string {
  if (!value) return 'N/A';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getNights(checkin: string | null | undefined, checkout: string | null | undefined): number | null {
  if (!checkin || !checkout) return null;

  const start = new Date(checkin);
  const end = new Date(checkout);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  return diffDays > 0 ? diffDays : null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InboxView({ integrationDocId, activeProperty }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Reply input state ───────────────────────────────────────────────────────
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Subscribe to threads (scoped to active property's subcollection) ──────────
  useEffect(() => {
    if (!integrationDocId || !activeProperty?.channex_property_id) {
      setThreads([]);
      setActiveThreadId(null);
      setLoadingThreads(false);
      return;
    }

    setLoadingThreads(true);
    setError(null);

    // 1:1 model path: channex_integrations/{docId}/properties/{propertyId}/threads
    const q = query(
      collection(
        db,
        'channex_integrations',
        integrationDocId,
        'properties',
        activeProperty.channex_property_id,
        'threads',
      ),
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
              guestCount: (data.guestCount as number | null | undefined) ?? null,
              adultCount: (data.adultCount as number | null | undefined) ?? null,
              childCount: (data.childCount as number | null | undefined) ?? null,
              numberOfGuests: (data.numberOfGuests as number | null | undefined) ?? null,
              numberOfAdults: (data.numberOfAdults as number | null | undefined) ?? null,
              numberOfChildren: (data.numberOfChildren as number | null | undefined) ?? null,
              numberOfInfants: (data.numberOfInfants as number | null | undefined) ?? null,
              numberOfPets: (data.numberOfPets as number | null | undefined) ?? null,
              payoutAmount: (data.payoutAmount as number | null | undefined) ?? null,
              currency: (data.currency as string | null | undefined) ?? null,
              bookingDetails:
                (data.bookingDetails as Record<string, unknown> | null | undefined) ?? null,
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
  }, [integrationDocId, activeProperty?.channex_property_id]);

  // ── Subscribe to messages for the active thread ─────────────────────────────
  useEffect(() => {
    if (!integrationDocId || !activeProperty?.channex_property_id || !activeThreadId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);

    const q = query(
      collection(
        db,
        'channex_integrations',
        integrationDocId,
        'properties',
        activeProperty.channex_property_id,
        'threads',
        activeThreadId,
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
  }, [integrationDocId, activeProperty?.channex_property_id, activeThreadId]);

  // ── Scroll to bottom on new messages ────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Reset reply input when switching threads ─────────────────────────────────
  useEffect(() => {
    setReplyText('');
    setSending(false);
    setShowInfoModal(false);
  }, [activeThreadId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowInfoModal(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Send reply ───────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = replyText.trim();

    if (!text || !integrationDocId || !activeThreadId || !activeProperty?.channex_property_id || sending) return;

    setSending(true);
    setReplyText('');

    // ── Optimistic Firestore write ─────────────────────────────────────────
    // Write the message immediately so the host sees it without waiting for
    // the Channex round-trip. A unique client-generated ID is used as the
    // document ID (unlike inbound messages which use ota_message_id).
    const optimisticId = generateId();
    const messageRef = doc(
      db,
      'channex_integrations',
      integrationDocId,
      'properties',
      activeProperty.channex_property_id,
      'threads',
      activeThreadId,
      'messages',
      optimisticId,
    );

    await setDoc(messageRef, {
      text,
      sender: 'host',
      createdAt: serverTimestamp(),
      sendStatus: 'sending',
    });

    // ── Dispatch to backend ────────────────────────────────────────────────
    try {
      await fetch(
        `/api/channex/properties/${encodeURIComponent(activeProperty.channex_property_id)}/threads/${encodeURIComponent(activeThreadId)}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        },
      ).then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`${res.status}: ${body}`);
        }
      });

      // Clear the optimistic sendStatus flag on success — message is delivered.
      await updateDoc(messageRef, { sendStatus: null });
    } catch (err: unknown) {
      // Mark the optimistic doc as failed so the UI can surface an indicator.
      await updateDoc(messageRef, { sendStatus: 'failed' }).catch(() => {
        // Best-effort — if the update itself fails, the 'sending' state stays
        // visible rather than crashing the component.
      });
      setError(
        `Failed to send reply: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter sends; plain Enter inserts a newline.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;
  const threadDetails = activeThread?.bookingDetails ?? null;
  const checkinDate =
    activeThread?.checkinDate ??
    (readBookingDetail(threadDetails, ['checkinDate', 'checkin_date']) as string | undefined) ??
    null;
  const checkoutDate =
    activeThread?.checkoutDate ??
    (readBookingDetail(threadDetails, ['checkoutDate', 'checkout_date']) as string | undefined) ??
    null;

  const adults =
    toNumber(activeThread?.numberOfAdults) ??
    toNumber(activeThread?.adultCount) ??
    toNumber(readBookingDetail(threadDetails, ['adultCount', 'adults', 'adults_count'])) ??
    0;
  const children =
    toNumber(activeThread?.numberOfChildren) ??
    toNumber(activeThread?.childCount) ??
    toNumber(readBookingDetail(threadDetails, ['childCount', 'children', 'children_count'])) ??
    0;
  const infants =
    toNumber(activeThread?.numberOfInfants) ??
    toNumber(readBookingDetail(threadDetails, ['number_of_infants', 'infants', 'infants_count'])) ??
    0;
  const pets =
    toNumber(activeThread?.numberOfPets) ??
    toNumber(readBookingDetail(threadDetails, ['number_of_pets', 'pets', 'pets_count'])) ??
    0;

  const explicitGuestCount =
    toNumber(activeThread?.numberOfGuests) ??
    toNumber(activeThread?.guestCount) ??
    toNumber(readBookingDetail(threadDetails, ['guestCount', 'guest_count', 'guests', 'number_of_guests'])) ??
    null;

  const computedGuestCount = adults + children;
  const guestCount = explicitGuestCount ?? (computedGuestCount > 0 ? computedGuestCount : null);
  const fallbackListingName = activeProperty?.title ?? 'Listing unavailable';
  const fallbackCurrency = activeProperty?.currency ?? 'USD';

  const listingName =
    activeThread?.listingName ??
    (readBookingDetail(threadDetails, ['listingName', 'listing_name']) as string | undefined) ??
    fallbackListingName;

  const resolvedNights =
    toNumber(activeThread?.nights) ??
    toNumber(readBookingDetail(threadDetails, ['nights', 'night_count'])) ??
    getNights(checkinDate, checkoutDate);

  const payoutAmount =
    toNumber(activeThread?.payoutAmount) ??
    toNumber(readBookingDetail(threadDetails, ['payoutAmount', 'payout_amount', 'estimated_payout'])) ??
    null;

  const payoutCurrency =
    activeThread?.currency ??
    (readBookingDetail(threadDetails, ['currency', 'payoutCurrency']) as string | undefined) ??
    fallbackCurrency;

  const payoutLabel =
    payoutAmount === null
      ? 'N/A'
      : new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: payoutCurrency,
          maximumFractionDigits: 2,
        }).format(payoutAmount);

  const guestsLabel =
    guestCount === null
      ? 'N/A'
      : `${guestCount} Total (${adults} Ad, ${children} Ch, ${infants} Inf${pets > 0 ? `, ${pets} Masc` : ''})`;

  const showInquiryInfoButton =
    !!activeThread &&
    (activeThread.isInquiry === true ||
      checkinDate !== null ||
      checkoutDate !== null ||
      threadDetails !== null);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!integrationDocId || !activeProperty) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-edge bg-surface-subtle px-6 py-10 text-center">
        <p className="text-sm font-medium text-content-2">Select a listing to view its inbox</p>
        <p className="text-xs text-content-3">
          Choose a synced Airbnb listing from the sidebar to load guest messages.
        </p>
      </div>
    );
  }

  if (loadingThreads) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface-subtle px-4 py-4 text-sm text-content-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-rose-500" />
        Loading inbox…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-sm">

      {/* ── Error banner ────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center justify-between gap-3 border-b border-danger-text/20 bg-danger-bg px-4 py-2 text-xs text-danger-text">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 font-semibold hover:text-danger-text"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-edge bg-surface-subtle px-6 py-5">
        <h2 className="text-xl font-semibold text-content">Guest Inbox</h2>
        <p className="mt-1 text-sm text-content-2">
          Airbnb messages and pre-booking inquiries, delivered via Channex.
        </p>
      </div>

      {/* ── Two-pane layout ──────────────────────────────────────────────────── */}
      <div className="flex" style={{ height: '520px' }}>

        {/* ── Left pane: thread list ────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-edge">
          {threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-subtle">
                <svg className="h-6 w-6 text-content-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-content-2">No messages yet</p>
              <p className="mt-1 text-xs text-content-3">
                Guest inquiries will appear here once Airbnb delivers them.
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
                      className={[
                        'w-full text-left px-4 py-4 transition-colors',
                        isActive ? 'bg-rose-50' : 'hover:bg-surface-subtle',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={['truncate text-sm font-semibold', isActive ? 'text-rose-700' : 'text-content'].join(' ')}>
                          {thread.guestName}
                        </span>
                        <span className="shrink-0 text-[11px] text-content-3">
                          {formatThreadTime(thread.updatedAt)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-content-2">{thread.lastMessage}</p>
                      {thread.bookingId === null && (
                        <span className="mt-2 inline-flex items-center rounded-full bg-caution-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-caution-text">
                          Inquiry
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ── Right pane: message history + input ───────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Thread header */}
          {activeThread ? (
            <div className="flex items-center justify-between gap-3 border-b border-edge bg-surface-raised px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-600">
                  {activeThread.guestName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-content">{activeThread.guestName}</p>
                  <p className="text-[11px] text-content-3">
                    {activeThread.bookingId ? `Booking · ${activeThread.bookingId}` : 'Pre-booking inquiry'}
                  </p>
                </div>
              </div>

              {showInquiryInfoButton && (
                <button
                  type="button"
                  onClick={() => setShowInfoModal(true)}
                  className="inline-flex shrink-0 items-center rounded-lg border border-edge bg-surface-raised px-3 py-1.5 text-xs font-semibold text-content transition hover:bg-surface-subtle"
                >
                  Informacion
                </button>
              )}
            </div>
          ) : (
            <div className="border-b border-edge bg-surface-raised px-5 py-3.5">
              <p className="text-sm text-content-3">Select a conversation from the left</p>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-surface-subtle/50">
            {!activeThreadId && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-content-3">Choose a thread to view the conversation.</p>
              </div>
            )}
            {activeThreadId && loadingMessages && (
              <div className="flex items-center gap-2 text-sm text-content-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-rose-400" />
                Loading messages…
              </div>
            )}
            {activeThreadId && !loadingMessages && messages.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-content-3">No messages in this thread yet.</p>
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
                        ? 'rounded-tr-sm bg-danger-bg text-danger-text ring-1 ring-danger-text/30'
                        : 'rounded-tr-sm bg-rose-600 text-white',
                  ].join(' ')}>
                    <p>{message.text}</p>
                    <p className={['mt-1 flex items-center justify-end gap-1 text-[10px]', isGuest ? 'text-content-3' : isFailed ? 'text-danger-text' : 'text-rose-200'].join(' ')}>
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

          {/* ── Reply input ─────────────────────────────────────────────────── */}
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
                  className="flex-1 resize-none rounded-xl border border-edge bg-surface-subtle px-3 py-2.5 text-sm text-content placeholder:text-content-3 outline-none transition focus:border-rose-300 focus:bg-surface-raised focus:ring-4 focus:ring-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={!replyText.trim() || sending}
                  onClick={() => void handleSend()}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-content-3"
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

      {showInfoModal && activeThread && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-content/45 px-4"
          onClick={() => setShowInfoModal(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-surface-raised shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Inquiry information"
          >
            <div className="flex items-start justify-between border-b border-edge px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-content">Informacion de la consulta</h3>
                <p className="mt-1 text-sm text-content-2">
                  Contexto previo para responder a {activeThread.guestName}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInfoModal(false)}
                className="rounded-md p-1 text-content-3 transition hover:bg-surface-subtle hover:text-content"
                aria-label="Close inquiry information"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-6 py-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-content-3">Listing</p>
                <p className="mt-1 text-sm font-medium text-content">{listingName}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-content-3">Huesped</p>
                <p className="mt-1 text-sm font-medium text-content">{activeThread.guestName}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-content-3">Check-in</p>
                <p className="mt-1 text-sm text-content">{toDateLabel(checkinDate)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-content-3">Check-out</p>
                <p className="mt-1 text-sm text-content">{toDateLabel(checkoutDate)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-content-3">Noches</p>
                <p className="mt-1 text-sm text-content">{resolvedNights ?? 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-content-3">Huespedes</p>
                <p className="mt-1 text-sm text-content">{guestsLabel}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-content-3">Payout estimado</p>
                <p className="mt-1 text-sm text-content">{payoutLabel}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
