import { useEffect, useRef, useState } from 'react';
import type { Message } from '../../types/message';
import type { IntegrationStatus } from '../../types/integration';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import { useLanguage } from '../../context/LanguageContext';

type ChatChannel = 'whatsapp' | 'messenger';

interface Props {
  businessId: string;
  messages: Message[];
  status: IntegrationStatus;
  activeChannel: ChatChannel;
  activeContact: string | null; // customer wa_id; null = no conversation selected
}

export default function ChatConsole({
  businessId,
  messages,
  status,
  activeChannel,
  activeContact,
}: Props) {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Messages for the currently selected contact only
  const filteredMessages = activeContact
    ? messages.filter(
        (msg) =>
          (msg.direction === 'inbound' && msg.from === activeContact) ||
          (msg.direction === 'outbound' && msg.to === activeContact),
      )
    : [];

  // Auto-scroll to the bottom whenever the filtered conversation changes
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [filteredMessages]);

  const handleSend = async () => {
    const trimmedText = text.trim();
    if (!trimmedText || !activeContact) return;

    setIsSending(true);
    setSendError(null);

    try {
      const provider = activeChannel === 'whatsapp' ? 'META' : 'META_MESSENGER';

      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          provider,
          recipientId: activeContact,
          text: trimmedText,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? `Server error ${res.status}`);
      }

      setText('');
    } catch (err: unknown) {
      setSendError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSending(false);
    }
  };

  // Show a spinner while the backend is completing the token exchange
  if (status === 'PENDING_TOKEN') {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="w-6 h-6 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
        <p className="text-sm text-blue-600 font-medium">
          {t('chat.pendingToken')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header — shows active contact's number or a prompt */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-content-2 uppercase tracking-wide">
          Chat
        </h2>
        {activeContact ? (
          <span className="text-xs font-mono text-content-2">+{activeContact}</span>
        ) : (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            {t('chat.selectConv')}
          </span>
        )}
      </div>

      {/* Message feed or empty state */}
      {!activeContact ? (
        <div className="flex-1 flex items-center justify-center bg-surface-subtle rounded-xl min-h-[12rem]">
          <p className="text-xs text-content-3 text-center leading-relaxed">
            {t('chat.selectContact')}
          </p>
        </div>
      ) : (
        <div
          ref={feedRef}
          className="flex-1 overflow-y-auto bg-surface-subtle rounded-xl p-3 flex flex-col gap-2 min-h-[12rem]"
        >
          {filteredMessages.length === 0 ? (
            <p className="text-xs text-content-3 text-center m-auto leading-relaxed">
              {t('chat.noMessages')}
            </p>
          ) : (
            filteredMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={[
                    'max-w-[78%] px-3 py-2 rounded-2xl text-sm shadow-sm',
                    msg.direction === 'outbound'
                      ? 'bg-brand text-white rounded-br-sm'
                      : 'bg-surface-raised border border-edge text-content rounded-bl-sm',
                  ].join(' ')}
                >
                  <p className="break-words">{msg.text}</p>
                  <p
                    className={`text-xs mt-1 ${
                      msg.direction === 'outbound' ? 'text-green-100' : 'text-content-3'
                    }`}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Reply input + send button */}
      <div className="flex gap-2">
        <Input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={activeContact ? t('chat.typeReply') : t('chat.selectFirst')}
          disabled={!activeContact}
          className="flex-1 rounded-xl"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSend()}
          disabled={isSending || !text.trim() || !activeContact}
        >
          {isSending ? '…' : t('chat.send')}
        </Button>
      </div>

      {sendError && (
        <p className="text-xs text-danger-text bg-danger-bg border border-red-200 rounded-lg px-3 py-2">
          {sendError}
        </p>
      )}
    </div>
  );
}
