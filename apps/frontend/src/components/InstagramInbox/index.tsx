import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { Message } from '../../types/message';

// ─── Types ────────────────────────────────────────────────────────────────────

type IgInteractionType = 'DIRECT_MESSAGE' | 'STORY_MENTION' | 'COMMENT';
type AccordionSection = 'conversations' | 'mentions' | 'comments';

interface ActiveSelection {
  igsid: string;
  type: IgInteractionType;
  /** Only set when type === 'COMMENT' */
  commentId?: string;
  mediaId?: string;
  commentText?: string;
}

interface Props {
  igMessages: Message[];
  igIntegrationId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Shows the last 8 chars of an IGSID — avoids exposing raw IDs in full */
const shortId = (igsid: string) => `…${igsid.slice(-8)}`;

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** Derive deduplicated contact list from a filtered set of inbound messages */
function deriveContacts(messages: Message[]) {
  const map = new Map<string, { lastMessage: string; lastTimestamp: string }>();
  for (const msg of messages) {
    if (msg.direction !== 'inbound') continue;
    const existing = map.get(msg.from);
    if (!existing || msg.timestamp > existing.lastTimestamp) {
      map.set(msg.from, { lastMessage: msg.text, lastTimestamp: msg.timestamp });
    }
  }
  return Array.from(map.entries())
    .map(([igsid, { lastMessage, lastTimestamp }]) => ({ igsid, lastMessage, lastTimestamp }))
    .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface AccordionHeaderProps {
  label: string;
  icon: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}
function AccordionHeader({ label, icon, count, isOpen, onToggle }: AccordionHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-subtle transition-colors"
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold text-content-2 uppercase tracking-wide">
        <span>{icon}</span>
        <span>{label}</span>
        {count > 0 && (
          <span className="bg-pink-100 text-pink-700 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
            {count}
          </span>
        )}
      </span>
      <span className={`text-content-3 text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>
        ▾
      </span>
    </button>
  );
}

interface ContactRowProps {
  igsid: string;
  preview: string;
  timestamp: string;
  isActive: boolean;
  typeIcon: string;
  onClick: () => void;
}
function ContactRow({ igsid, preview, timestamp, isActive, typeIcon, onClick }: ContactRowProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-2.5 border-l-2 transition-colors hover:bg-surface-subtle',
        isActive ? 'border-pink-500 bg-pink-50' : 'border-transparent',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-medium text-content truncate">
          {typeIcon} {shortId(igsid)}
        </span>
        <span className="text-[10px] text-content-3 shrink-0">{formatTime(timestamp)}</span>
      </div>
      <p className="text-xs text-content-3 truncate mt-0.5">{preview || '—'}</p>
    </button>
  );
}

interface CommentRowProps {
  commentId: string;
  igsid: string;
  text: string;
  mediaId: string;
  timestamp: string;
  isActive: boolean;
  onClick: () => void;
}
function CommentRow({ commentId: _commentId, igsid, text, mediaId, timestamp, isActive, onClick }: CommentRowProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-2.5 border-l-2 transition-colors hover:bg-surface-subtle',
        isActive ? 'border-orange-400 bg-orange-50' : 'border-transparent',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-medium text-content truncate">
          💬 {shortId(igsid)}
        </span>
        <span className="text-[10px] text-content-3 shrink-0">{formatDate(timestamp)}</span>
      </div>
      <p className="text-xs text-content-2 truncate mt-0.5">{text || '—'}</p>
      <p className="text-[10px] text-content-3 truncate mt-0.5">Post: {mediaId || 'unknown'}</p>
    </button>
  );
}

// ─── Right panel: DM / Story Mention thread ───────────────────────────────────

interface ChatThreadProps {
  igsid: string;
  type: 'DIRECT_MESSAGE' | 'STORY_MENTION';
  messages: Message[];
  integrationId: string;
}
function ChatThread({ igsid, type, messages, integrationId }: ChatThreadProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [text, setText]         = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const thread = useMemo(
    () =>
      messages
        .filter(
          (m) =>
            (m.direction === 'inbound' && m.from === igsid) ||
            (m.direction === 'outbound' && m.to === igsid),
        )
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [messages, igsid],
  );

  // Auto-scroll to bottom when thread updates
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [thread]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setSendError(null);

    try {
      const res = await fetch(
        `/api/integrations/instagram/${integrationId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientId: igsid, text: trimmed }),
        },
      );

      if (res.ok) {
        setText('');
      } else {
        const body = await res.json().catch(() => ({}));
        const msg: string = (body as { message?: string }).message ?? `HTTP ${res.status}`;
        setSendError(
          res.status === 403
            ? '24-hour window closed — user must message first to reopen it.'
            : msg,
        );
      }
    } catch {
      setSendError('Network error — please try again.');
    } finally {
      setIsSending(false);
    }
  }, [text, isSending, integrationId, igsid]);

  const headerLabel = type === 'STORY_MENTION' ? '📸 Story Mention' : '💬 Direct Message';

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="px-4 py-3 border-b border-edge flex items-center gap-2">
        <span className="text-sm font-semibold text-content">{headerLabel}</span>
        <span className="text-xs text-content-3">{shortId(igsid)}</span>
      </div>

      {/* Messages */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {thread.length === 0 ? (
          <p className="text-xs text-content-3 text-center py-6">No messages yet.</p>
        ) : (
          thread.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={[
                  'max-w-[75%] px-3 py-2 rounded-2xl text-sm',
                  msg.direction === 'outbound'
                    ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-br-sm'
                    : 'bg-surface-subtle text-content rounded-bl-sm',
                ].join(' ')}
              >
                <p className="leading-snug">{msg.text || <em className="opacity-60">[media]</em>}</p>
                <p
                  className={[
                    'text-[10px] mt-1',
                    msg.direction === 'outbound' ? 'text-white/60 text-right' : 'text-content-3',
                  ].join(' ')}
                >
                  {formatTime(msg.timestamp)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <div className="px-4 py-3 border-t border-edge space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Type a reply…"
            disabled={isSending}
            className="flex-1 text-sm border border-edge rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-300 disabled:opacity-50 disabled:bg-surface-subtle"
          />
          <button
            onClick={() => void handleSend()}
            disabled={isSending || !text.trim()}
            className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isSending ? '…' : 'Send'}
          </button>
        </div>
        {sendError && (
          <p className="text-xs text-danger-text bg-danger-bg border border-danger/40 rounded-lg px-3 py-1.5">
            {sendError}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Right panel: Comment detail view ─────────────────────────────────────────

type FeedbackState =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | null;

interface CommentDetailProps {
  selection: ActiveSelection;
  integrationId: string;
}
function CommentDetail({ selection, integrationId }: CommentDetailProps) {
  const [replyText, setReplyText]               = useState('');
  const [isSending, setIsSending]               = useState(false);
  const [feedback, setFeedback]                 = useState<FeedbackState>(null);
  const [privateReplySent, setPrivateReplySent] = useState(false);

  const sendReply = useCallback(
    async (type: 'PUBLIC' | 'PRIVATE') => {
      const text = replyText.trim();
      if (!text || isSending) return;

      setIsSending(true);
      setFeedback(null);

      try {
        const res = await fetch(
          `/api/integrations/instagram/${integrationId}/reply`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type,
              commentId: selection.commentId,
              igsid:     selection.igsid,
              text,
            }),
          },
        );

        if (res.ok) {
          setFeedback({
            kind: 'success',
            message:
              type === 'PUBLIC'
                ? 'Public reply posted under the comment.'
                : 'Private Reply sent as a Direct Message.',
          });
          setReplyText('');
          if (type === 'PRIVATE') setPrivateReplySent(true);
        } else {
          const body = await res.json().catch(() => ({}));
          const msg: string =
            (body as { message?: string }).message ?? `HTTP ${res.status}`;

          if (res.status === 403) {
            setFeedback({
              kind: 'error',
              message:
                type === 'PRIVATE' &&
                msg.toLowerCase().includes('single reply rule')
                  ? 'A Private Reply was already sent for this comment (Single Reply Rule).'
                  : msg,
            });
          } else {
            setFeedback({ kind: 'error', message: msg });
          }
        }
      } catch {
        setFeedback({ kind: 'error', message: 'Network error — please try again.' });
      } finally {
        setIsSending(false);
      }
    },
    [replyText, isSending, integrationId, selection],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-edge flex items-center gap-2">
        <span className="text-sm font-semibold text-content">💬 Comment</span>
        <span className="text-xs text-content-3">{shortId(selection.igsid)}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Comment context badge */}
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 space-y-1">
          <p className="text-[10px] font-semibold text-orange-600 uppercase tracking-wide">
            Comment on Post
          </p>
          <p className="text-xs text-orange-700 font-mono break-all">
            {selection.mediaId || 'Media ID unavailable'}
          </p>
          <p className="text-[10px] text-orange-500">
            Comment ID: {selection.commentId || '—'}
          </p>
        </div>

        {/* Comment text */}
        <div className="bg-surface-subtle rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-content-2 uppercase tracking-wide mb-1">
            Comment text
          </p>
          <p className="text-sm text-content leading-relaxed">
            {selection.commentText || <em className="text-content-3">No text</em>}
          </p>
        </div>

        {/* Reply composer */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-content-2 uppercase tracking-wide">
            Reply
          </p>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            disabled={isSending}
            rows={3}
            placeholder="Type your reply…"
            className="w-full text-sm border border-edge rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-pink-300 disabled:opacity-50 disabled:bg-surface-subtle"
          />
        </div>

        {/* Feedback banner */}
        {feedback && (
          <div
            className={[
              'rounded-xl px-3 py-2.5 text-xs leading-relaxed',
              feedback.kind === 'success'
                ? 'bg-ok-bg border border-ok/40 text-ok-text'
                : 'bg-danger-bg border border-danger/40 text-danger-text',
            ].join(' ')}
          >
            {feedback.message}
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-content-2 uppercase tracking-wide">
            Send as
          </p>

          <button
            onClick={() => sendReply('PUBLIC')}
            disabled={isSending || !replyText.trim()}
            className="w-full flex items-center justify-between px-4 py-3 bg-surface-raised border border-edge rounded-xl hover:bg-surface-subtle hover:border-edge transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-content">Public Reply</p>
              <p className="text-xs text-content-2 mt-0.5">
                Visible under the post — replies publicly to this comment
              </p>
            </div>
            <span className="text-content-3 group-hover:text-content-2 transition-colors">
              {isSending ? '…' : '→'}
            </span>
          </button>

          <button
            onClick={() => sendReply('PRIVATE')}
            disabled={isSending || !replyText.trim() || privateReplySent}
            className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl hover:from-purple-100 hover:to-pink-100 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-purple-800">
                Private Reply (DM)
                {privateReplySent && (
                  <span className="ml-2 text-[10px] font-normal bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">
                    Sent
                  </span>
                )}
              </p>
              <p className="text-xs text-purple-600 mt-0.5">
                {privateReplySent
                  ? 'One Private Reply per comment is permitted (Single Reply Rule)'
                  : 'Sends a Direct Message · subject to 7-day window & Single Reply Rule'}
              </p>
            </div>
            <span className="text-purple-400 group-hover:text-purple-700 transition-colors">
              {isSending ? '…' : '→'}
            </span>
          </button>
        </div>

        {/* Compliance notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-amber-700 leading-relaxed">
            <strong>Compliance:</strong> Private Replies must be sent within 7 days of the
            comment. Only <strong>one</strong> Private Reply per comment is permitted by Meta.
            The 24-hour DM window opens only after the user replies.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center text-3xl">
        📸
      </div>
      <p className="text-sm font-medium text-content-2">Select a conversation</p>
      <p className="text-xs text-content-3 max-w-xs leading-relaxed">
        Choose a Direct Message, Story Mention, or Comment from the left sidebar to view the
        conversation and take action.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * InstagramInbox
 *
 * Three-section accordion sidebar + contextual right panel for the Instagram
 * channel. Replaces the generic ConversationList + ChatConsole layout used by
 * WhatsApp and Messenger.
 *
 * Sections:
 *   Conversations — inbound DIRECT_MESSAGE events grouped by IGSID
 *   Mentions      — inbound STORY_MENTION events grouped by IGSID
 *   Comments      — inbound COMMENT events listed individually (per commentId)
 *
 * Right panel:
 *   DM / Mention selected → IgChatThread (message thread)
 *   Comment selected      → IgCommentDetail (media context + reply actions)
 */
export default function InstagramInbox({ igMessages, igIntegrationId }: Props) {
  const [openSection, setOpenSection] = useState<AccordionSection>('conversations');
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);

  const toggle = (section: AccordionSection) =>
    setOpenSection((prev) => (prev === section ? 'conversations' : section));

  // ── Derive section data from messages ──────────────────────────────────────
  const dmMessages      = useMemo(() => igMessages.filter((m) => m.interactionType === 'DIRECT_MESSAGE'), [igMessages]);
  const mentionMessages = useMemo(() => igMessages.filter((m) => m.interactionType === 'STORY_MENTION'), [igMessages]);
  const commentMessages = useMemo(
    () => igMessages.filter((m) => m.interactionType === 'COMMENT' && m.direction === 'inbound'),
    [igMessages],
  );

  const dmContacts      = useMemo(() => deriveContacts(dmMessages),      [dmMessages]);
  const mentionContacts = useMemo(() => deriveContacts(mentionMessages),  [mentionMessages]);

  // Comments are listed individually, not grouped by sender
  const commentItems = useMemo(
    () =>
      commentMessages
        .slice()
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [commentMessages],
  );

  // ── Handlers ───────────────────────────────────────────────────────────────
  const selectDm = (igsid: string) => {
    setActiveSelection({ igsid, type: 'DIRECT_MESSAGE' });
    setOpenSection('conversations');
  };

  const selectMention = (igsid: string) => {
    setActiveSelection({ igsid, type: 'STORY_MENTION' });
    setOpenSection('mentions');
  };

  const selectComment = (msg: Message) => {
    setActiveSelection({
      igsid:       msg.from,
      type:        'COMMENT',
      commentId:   msg.commentId,
      mediaId:     msg.mediaId,
      commentText: msg.text,
    });
    setOpenSection('comments');
  };


  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex border border-edge rounded-xl overflow-hidden h-[600px]">

      {/* ── Left Sidebar: Accordion ──────────────────────────────────────── */}
      <div className="w-60 shrink-0 border-r border-edge flex flex-col overflow-hidden">

        {/* ── Section 1: Conversations (DMs) ───────────────────────────── */}
        <div className="border-b border-edge">
          <AccordionHeader
            label="Conversations"
            icon="💬"
            count={dmContacts.length}
            isOpen={openSection === 'conversations'}
            onToggle={() => toggle('conversations')}
          />
          {openSection === 'conversations' && (
            <div className="overflow-y-auto max-h-[160px]">
              {dmContacts.length === 0 ? (
                <p className="text-xs text-content-3 text-center px-3 py-4 leading-relaxed">
                  No DMs yet.
                </p>
              ) : (
                dmContacts.map((c) => (
                  <ContactRow
                    key={c.igsid}
                    igsid={c.igsid}
                    preview={c.lastMessage}
                    timestamp={c.lastTimestamp}
                    isActive={activeSelection?.igsid === c.igsid && activeSelection?.type === 'DIRECT_MESSAGE'}
                    typeIcon="💬"
                    onClick={() => selectDm(c.igsid)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Section 2: Mentions (Story Mentions) ─────────────────────── */}
        <div className="border-b border-edge">
          <AccordionHeader
            label="Mentions"
            icon="📸"
            count={mentionContacts.length}
            isOpen={openSection === 'mentions'}
            onToggle={() => toggle('mentions')}
          />
          {openSection === 'mentions' && (
            <div className="overflow-y-auto max-h-[160px]">
              {mentionContacts.length === 0 ? (
                <p className="text-xs text-content-3 text-center px-3 py-4 leading-relaxed">
                  No Story Mentions yet.
                </p>
              ) : (
                mentionContacts.map((c) => (
                  <ContactRow
                    key={c.igsid}
                    igsid={c.igsid}
                    preview={c.lastMessage}
                    timestamp={c.lastTimestamp}
                    isActive={activeSelection?.igsid === c.igsid && activeSelection?.type === 'STORY_MENTION'}
                    typeIcon="📸"
                    onClick={() => selectMention(c.igsid)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Section 3: Comments ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0">
          <AccordionHeader
            label="Comments"
            icon="💭"
            count={commentItems.length}
            isOpen={openSection === 'comments'}
            onToggle={() => toggle('comments')}
          />
          {openSection === 'comments' && (
            <div className="flex-1 overflow-y-auto">
              {commentItems.length === 0 ? (
                <p className="text-xs text-content-3 text-center px-3 py-4 leading-relaxed">
                  No comments yet.
                  <br />
                  Subscribe to Posts/Reels to receive them.
                </p>
              ) : (
                commentItems.map((msg) => (
                  <CommentRow
                    key={msg.commentId ?? msg.id}
                    commentId={msg.commentId ?? msg.id}
                    igsid={msg.from}
                    text={msg.text}
                    mediaId={msg.mediaId ?? ''}
                    timestamp={msg.timestamp}
                    isActive={
                      activeSelection?.type === 'COMMENT' &&
                      activeSelection?.commentId === (msg.commentId ?? msg.id)
                    }
                    onClick={() => selectComment(msg)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {!activeSelection && <EmptyState />}

        {activeSelection?.type === 'DIRECT_MESSAGE' && (
          <ChatThread
            igsid={activeSelection.igsid}
            type="DIRECT_MESSAGE"
            messages={igMessages}
            integrationId={igIntegrationId}
          />
        )}

        {activeSelection?.type === 'STORY_MENTION' && (
          <ChatThread
            igsid={activeSelection.igsid}
            type="STORY_MENTION"
            messages={igMessages}
            integrationId={igIntegrationId}
          />
        )}

        {activeSelection?.type === 'COMMENT' && (
          <CommentDetail
            selection={activeSelection}
            integrationId={igIntegrationId}
          />
        )}
      </div>
    </div>
  );
}
