import { MessageCircle, MessageSquare, Camera, Building2 } from 'lucide-react';

export type Channel = 'whatsapp' | 'messenger' | 'instagram' | 'channex';

interface Props {
  active: Channel;
  onChange: (channel: Channel) => void;
}

interface TabDef {
  channel: Channel;
  label: string;
  icon: React.ReactNode;
  activeColor: string;
  dotColor: string;
  disabled?: boolean;
}

const TABS: TabDef[] = [
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    icon: <MessageCircle size={15} />,
    activeColor: 'border-channel-wa text-channel-wa',
    dotColor: 'bg-channel-wa',
  },
  {
    channel: 'messenger',
    label: 'Messenger',
    icon: <MessageSquare size={15} />,
    activeColor: 'border-channel-ms text-channel-ms',
    dotColor: 'bg-channel-ms',
  },
  {
    channel: 'instagram',
    label: 'Instagram',
    icon: <Camera size={15} />,
    activeColor: 'border-channel-ig text-channel-ig',
    dotColor: 'bg-channel-ig',
  },
  {
    channel: 'channex',
    label: 'Channex',
    icon: <Building2 size={15} />,
    activeColor: 'border-channel-cx text-channel-cx',
    dotColor: 'bg-channel-cx',
    disabled: false,
  },
];

export default function ChannelTabs({ active, onChange }: Props) {
  return (
    <div className="flex border-b border-edge bg-surface-raised">
      {TABS.map(({ channel, label, icon, activeColor, dotColor, disabled }) => {
        const isActive = active === channel;
        return (
          <button
            key={channel}
            disabled={disabled}
            onClick={() => onChange(channel)}
            className={[
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-150',
              isActive
                ? activeColor
                : 'border-transparent text-content-3 hover:text-content-2 hover:border-edge',
              disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${isActive ? 'opacity-100' : 'opacity-40'}`} />
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}
