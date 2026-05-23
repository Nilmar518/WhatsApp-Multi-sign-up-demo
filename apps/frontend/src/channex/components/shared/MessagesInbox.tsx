import { useState, useEffect, useRef, useCallback } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { useThreadMessages } from '../../hooks/useChannexMessages';
import { replyToThread, getBookingById } from '../../api/channexHubApi';
import type { Reservation } from '../../api/channexHubApi';
import type { ChannexThread } from '../../hooks/useChannexThreads';
import { useLanguage } from '../../../context/LanguageContext';
import ReservationDetailModal from './ReservationDetailModal';

// ─── Time helpers ─────────────────────────────────────────────────────────────

function formatTimestamp(ts: Timestamp | null): string {
  if (!ts) return '';
  const d = ts.toDate();
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMessageTime(ts: Timestamp | null): string {
  if (!ts) return '';
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Conversation pane ────────────────────────────────────────────────────────

interface ConversationPaneProps {
  tenantId: string;
  thread: ChannexThread;
  onBack: () => void;
}

function ConversationPane({ tenantId, thread, onBack }: ConversationPaneProps) {
  const { t } = useLanguage();
  const { messages, loading } = useThreadMessages(tenantId, thread.propertyId, thread.id);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [reservationStatus, setReservationStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [propertyChannelCode, setPropertyChannelCode] = useState<string | null>(null);
  const [reservationError, setReservationError] = useState<string | null>(null);

  const handleOpenBooking = useCallback(async () => {
    if (!thread.bookingId) return;
    setReservationStatus('loading');
    setReservationError(null);
    try {
      const result = await getBookingById(thread.propertyId, thread.bookingId, tenantId);
      setReservation(result.reservation);
      setPropertyChannelCode(result.propertyChannelCode);
      setReservationStatus('loaded');
    } catch (err) {
      setReservationError(err instanceof Error ? err.message : t('channex.messages.err.send'));
      setReservationStatus('error');
    }
  }, [thread.bookingId, thread.propertyId, tenantId, t]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      await replyToThread(thread.propertyId, thread.id, text);
      setReply('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t('channex.messages.err.send'));
    } finally {
      setSending(false);
    }
  }, [reply, thread.propertyId, thread.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Thread header */}
      <div className="shrink-0 border-b border-edge px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-start gap-2">
            <button
              type="button"
              onClick={onBack}
              className="md:hidden shrink-0 mt-0.5 text-sm text-content-2 hover:text-content"
            >
              ←
            </button>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-content truncate">{thread.guestName}</p>
              {thread.isInquiry ? (
                <p className="text-xs text-notice-text mt-0.5">
                  {t('channex.messages.inquiry')} · {thread.checkinDate ?? '—'} → {thread.checkoutDate ?? '—'}
                </p>
              ) : null}
              {thread.listingName && (
                <p className="text-xs text-content-3 mt-0.5 truncate">{thread.listingName}</p>
              )}
            </div>
          </div>
          {thread.bookingId && (
            <button
              type="button"
              disabled={reservationStatus === 'loading'}
              onClick={() => void handleOpenBooking()}
              className="shrink-0 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-content-2 hover:border-brand-light hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reservationStatus === 'loading' ? '…' : 'Ver Reserva'}
            </button>
          )}
        </div>
        {reservationStatus === 'error' && reservationError && (
          <p className="mt-1 text-xs text-danger-text">{reservationError}</p>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0">
        {loading && (
          <p className="text-xs text-content-3">{t('channex.messages.loading')}</p>
        )}
        {!loading && messages.length === 0 && (
          <p className="text-xs text-content-3">{t('channex.messages.empty')}</p>
        )}
        {messages.map((msg) => {
          const isHost = msg.sender === 'host';
          return (
            <div
              key={msg.id}
              className={`flex ${isHost ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={[
                  'max-w-[78%] rounded-2xl px-3.5 py-2',
                  isHost
                    ? 'bg-brand text-white rounded-br-sm'
                    : 'bg-surface-subtle text-content border border-edge rounded-bl-sm',
                ].join(' ')}
              >
                <p className="text-sm leading-snug whitespace-pre-wrap">{msg.text}</p>
                <p
                  className={`text-[10px] mt-1 text-right ${
                    isHost ? 'text-white/60' : 'text-content-3'
                  }`}
                >
                  {formatMessageTime(msg.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply composer */}
      <div className="shrink-0 border-t border-edge px-4 py-3">
        {sendError && (
          <p className="mb-2 text-xs text-danger-text">{sendError}</p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('channex.messages.replyPh')}
            rows={2}
            className="flex-1 resize-none rounded-xl border border-edge bg-surface px-3 py-2 text-sm text-content placeholder:text-content-3 focus:border-brand-light focus:outline-none"
          />
          <button
            type="button"
            disabled={sending || !reply.trim()}
            onClick={() => void handleSend()}
            className={[
              'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
              sending || !reply.trim()
                ? 'bg-surface-subtle text-content-3 cursor-not-allowed'
                : 'bg-brand text-white hover:opacity-80',
            ].join(' ')}
          >
            {sending ? t('channex.messages.sending') : t('channex.messages.send')}
          </button>
        </div>
      </div>

      {reservationStatus === 'loaded' && reservation && (
        <ReservationDetailModal
          reservation={reservation}
          tenantId={tenantId}
          propertyChannelCode={propertyChannelCode}
          onClose={() => {
            setReservationStatus('idle');
            setReservation(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Main inbox component ─────────────────────────────────────────────────────

interface Props {
  tenantId: string;
  threads: ChannexThread[];
  loading: boolean;
  initialThreadId?: string;
  /** When provided, shows a property name badge on each thread row (for multi-property views). */
  propertyTitleById?: Record<string, string>;
}

export default function MessagesInbox({ tenantId, threads, loading, initialThreadId, propertyTitleById }: Props) {
  const { t } = useLanguage();
  const [selectedThread, setSelectedThread] = useState<ChannexThread | null>(null);

  // Clear selection if the thread disappears from the list
  useEffect(() => {
    if (selectedThread && !threads.find((t) => t.id === selectedThread.id)) {
      setSelectedThread(null);
    }
  }, [threads, selectedThread]);

  const hasAutoOpenedThreadRef = useRef(false);
  // Pre-select thread when navigating from global view
  useEffect(() => {
    if (!initialThreadId || threads.length === 0) return;
    if (hasAutoOpenedThreadRef.current) return;
    const target = threads.find((t) => t.id === initialThreadId);
    if (target) {
      hasAutoOpenedThreadRef.current = true;
      setSelectedThread(target);
    }
  }, [initialThreadId, threads]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-edge bg-surface-raised">
        <p className="text-sm text-content-2">{t('channex.messages.loading')}</p>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-edge bg-surface-raised">
        <p className="text-sm text-content-3">{t('channex.messages.noThreads')}</p>
      </div>
    );
  }

  // Group by property when propertyTitleById is provided
  const groupEntries = propertyTitleById
    ? Object.entries(
        threads.reduce<Record<string, ChannexThread[]>>((acc, th) => {
          (acc[th.propertyId] ??= []).push(th);
          return acc;
        }, {}),
      ).sort(([a], [b]) =>
        (propertyTitleById[a] ?? a).localeCompare(propertyTitleById[b] ?? b),
      )
    : null;

  function renderThreadItem(thread: ChannexThread, showPropertyBadge: boolean) {
    const isSelected = selectedThread?.id === thread.id && selectedThread.propertyId === thread.propertyId;
    return (
      <button
        key={`${thread.propertyId}-${thread.id}`}
        type="button"
        onClick={() => setSelectedThread(thread)}
        className={[
          'w-full border-b border-edge px-4 py-3 text-left transition-colors border-l-2',
          isSelected
            ? 'bg-brand/10 border-l-brand'
            : 'hover:bg-surface-subtle border-l-transparent',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-1">
          <p className="truncate text-sm font-medium text-content">{thread.guestName}</p>
          <p className="shrink-0 text-[10px] text-content-3">
            {formatTimestamp(thread.updatedAt)}
          </p>
        </div>
        {thread.lastMessage && (
          <p className="mt-0.5 truncate text-xs text-content-2">{thread.lastMessage}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {showPropertyBadge && propertyTitleById?.[thread.propertyId] && (
            <span className="inline-block rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand truncate max-w-[120px]">
              {propertyTitleById[thread.propertyId]}
            </span>
          )}
          {thread.isInquiry && (
            <span className="inline-block rounded-full bg-notice-bg px-1.5 py-0.5 text-[10px] font-medium text-notice-text">
              {t('channex.messages.inquiry')}
            </span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="flex flex-col md:flex-row md:h-[480px] overflow-hidden rounded-2xl border border-edge bg-surface-raised">
      {/* Thread list */}
      <div className={[
        'shrink-0 overflow-y-auto border-b border-edge md:border-b-0 md:border-r',
        'w-full md:w-64',
        selectedThread ? 'hidden md:block' : 'block',
      ].join(' ')}>
        {groupEntries
          ? groupEntries.map(([propId, propThreads]) => (
              <div key={propId}>
                <div className="flex items-center gap-2 px-4 py-2 bg-surface-subtle border-b border-edge sticky top-0 z-10">
                  <span className="text-xs font-semibold text-content uppercase tracking-wider truncate">
                    {propertyTitleById![propId] ?? propId}
                  </span>
                  <span className="shrink-0 text-xs text-content-2">({propThreads.length})</span>
                </div>
                {propThreads.map((thread) => renderThreadItem(thread, true))}
              </div>
            ))
          : threads.map((thread) => renderThreadItem(thread, !!propertyTitleById))
        }
      </div>

      {/* Conversation pane */}
      <div className={[
        'flex-1 min-w-0 overflow-hidden',
        selectedThread ? 'flex flex-col h-[480px] md:h-auto' : 'hidden md:flex',
      ].join(' ')}>
        {selectedThread ? (
          <ConversationPane
            key={`${selectedThread.propertyId}-${selectedThread.id}`}
            tenantId={tenantId}
            thread={selectedThread}
            onBack={() => setSelectedThread(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-content-3">{t('channex.messages.selectConv')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
