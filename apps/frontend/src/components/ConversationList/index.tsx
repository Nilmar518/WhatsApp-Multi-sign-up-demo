import type { Contact } from '../../hooks/useConversations';
import { useLanguage } from '../../context/LanguageContext';

interface Props {
  contacts: Contact[];
  activeContact: string | null;
  onSelect: (waId: string) => void;
}

export default function ConversationList({ contacts, activeContact, onSelect }: Props) {
  const { t } = useLanguage();
  return (
    <div className="w-52 shrink-0 border-r border-edge flex flex-col">
      <div className="px-3 py-2 border-b border-edge">
        <span className="text-xs font-semibold text-content-2 uppercase tracking-wide">
          {t('convList.title')}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <p className="text-xs text-content-3 text-center px-3 py-6 leading-relaxed">
            {t('convList.empty')}
          </p>
        ) : (
          contacts.map((contact) => (
            <button
              key={contact.waId}
              onClick={() => onSelect(contact.waId)}
              className={[
                'w-full text-left px-3 py-3 border-l-2 transition-colors hover:bg-surface-subtle',
                activeContact === contact.waId
                  ? 'border-green-500 bg-ok-bg'
                  : 'border-transparent',
              ].join(' ')}
            >
              <p className="text-sm font-medium text-content truncate">
                +{contact.waId}
              </p>
              <p className="text-xs text-content-3 truncate mt-0.5">
                {contact.lastMessage}
              </p>
              <p className="text-xs text-content-3 mt-0.5">
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
