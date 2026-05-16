import { useState, useEffect, useRef, useCallback } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { useThreadMessages } from '../../hooks/useChannexMessages';
import { replyToThread } from '../../api/channexHubApi';
import type { ChannexThread } from '../../hooks/useChannexThreads';

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
}

function ConversationPane({ tenantId, thread }: ConversationPaneProps) {
  const { messages, loading } = useThreadMessages(tenantId, thread.propertyId, thread.id);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      setSendError(err instanceof Error ? err.message : 'Send failed.');
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
        <p className="text-sm font-semibold text-content">{thread.guestName}</p>
        {thread.isInquiry ? (
          <p className="text-xs text-notice-text mt-0.5">
            Inquiry · {thread.checkinDate ?? '—'} → {thread.checkoutDate ?? '—'}
          </p>
        ) : null}
        {thread.listingName && (
          <p className="text-xs text-content-3 mt-0.5">{thread.listingName}</p>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0">
        {loading && (
          <p className="text-xs text-content-3">Loading messages…</p>
        )}
        {!loading && messages.length === 0 && (
          <p className="text-xs text-content-3">No messages in this thread yet.</p>
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
            placeholder="Reply… (Enter to send, Shift+Enter for new line)"
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
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main inbox component ─────────────────────────────────────────────────────

interface Props {
  tenantId: string;
  threads: ChannexThread[];
  loading: boolean;
}

export default function MessagesInbox({ tenantId, threads, loading }: Props) {
  const [selectedThread, setSelectedThread] = useState<ChannexThread | null>(null);

  // Clear selection if the thread disappears from the list
  useEffect(() => {
    if (selectedThread && !threads.find((t) => t.id === selectedThread.id)) {
      setSelectedThread(null);
    }
  }, [threads, selectedThread]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-edge bg-surface-raised">
        <p className="text-sm text-content-2">Loading messages…</p>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-edge bg-surface-raised">
        <p className="text-sm text-content-3">No messages yet.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[480px] overflow-hidden rounded-2xl border border-edge bg-surface-raised">
      {/* Thread list */}
      <div className="w-64 shrink-0 overflow-y-auto border-r border-edge">
        {threads.map((thread) => {
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
              {thread.isInquiry && (
                <span className="mt-1 inline-block rounded-full bg-notice-bg px-1.5 py-0.5 text-[10px] font-medium text-notice-text">
                  Inquiry
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Conversation pane */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedThread ? (
          <ConversationPane
            key={`${selectedThread.propertyId}-${selectedThread.id}`}
            tenantId={tenantId}
            thread={selectedThread}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-content-3">Select a conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}
