export type Channel = 'whatsapp' | 'messenger' | 'instagram' | 'airbnb' | 'booking';

interface Props {
  active: Channel;
  onChange: (channel: Channel) => void;
}

interface TabDef {
  channel: Channel;
  label: string;
  icon: string;
  activeClass: string;
  disabled?: boolean;
  tooltip?: string;
}

const TABS: TabDef[] = [
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    icon: '💬',
    activeClass: 'border-green-500 text-green-700',
  },
  {
    channel: 'messenger',
    label: 'Messenger',
    icon: '💙',
    activeClass: 'border-blue-500 text-blue-700',
  },
  {
    channel: 'instagram',
    label: 'Instagram',
    icon: '📸',
    activeClass: 'border-pink-500 text-pink-700',
  },
  {
    channel: 'airbnb',
    label: 'Airbnb',
    icon: '🏠',
    activeClass: 'border-rose-500 text-rose-700',
  },
  {
    channel: 'booking',
    label: 'Booking.com',
    icon: '🏨',
    activeClass: 'border-blue-600 text-blue-600',
  },
];

/**
 * ChannelTabs
 *
 * Horizontal tab strip for switching between WhatsApp, Messenger, and
 * Instagram channels. Instagram is rendered as a disabled "Coming Soon" tab.
 *
 * Sits below the page header and above the channel-specific dashboard content.
 */
export default function ChannelTabs({ active, onChange }: Props) {
  return (
    <div className="flex items-end gap-0 border-b border-gray-200">
      {TABS.map((tab) => {
        const isActive = !tab.disabled && tab.channel === active;
        const isDisabled = tab.disabled;

        return (
          <button
            key={tab.channel}
            onClick={() => {
              if (!isDisabled) {
                onChange(tab.channel);
              }
            }}
            disabled={isDisabled}
            title={tab.tooltip}
            className={[
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              isActive
                ? `${tab.activeClass} bg-white`
                : isDisabled
                  ? 'border-transparent text-gray-300 cursor-not-allowed'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {isDisabled && (
              <span className="text-[10px] font-normal text-gray-400 ml-0.5">(Soon)</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
