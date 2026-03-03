import type { Contact } from '../../hooks/useConversations';

interface Props {
  contacts: Contact[];
  activeContact: string | null;
  onSelect: (waId: string) => void;
}

export default function ConversationList({ contacts, activeContact, onSelect }: Props) {
  return (
    <div className="w-52 shrink-0 border-r border-gray-100 flex flex-col">
      <div className="px-3 py-2 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Conversations
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <p className="text-xs text-gray-400 text-center px-3 py-6 leading-relaxed">
            No conversations yet.
            <br />
            Messages will appear here.
          </p>
        ) : (
          contacts.map((contact) => (
            <button
              key={contact.waId}
              onClick={() => onSelect(contact.waId)}
              className={[
                'w-full text-left px-3 py-3 border-l-2 transition-colors hover:bg-gray-50',
                activeContact === contact.waId
                  ? 'border-green-500 bg-green-50'
                  : 'border-transparent',
              ].join(' ')}
            >
              <p className="text-sm font-medium text-gray-800 truncate">
                +{contact.waId}
              </p>
              <p className="text-xs text-gray-400 truncate mt-0.5">
                {contact.lastMessage}
              </p>
              <p className="text-xs text-gray-300 mt-0.5">
                {new Date(contact.lastTimestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
