import type { HTMLAttributes } from 'react';

type Variant = 'ok' | 'danger' | 'caution' | 'notice' | 'neutral' | 'brand'
             | 'wa' | 'ms' | 'ig' | 'cx';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  ok:      'bg-ok-bg text-ok-text border-ok/30',
  danger:  'bg-danger-bg text-danger-text border-danger/30',
  caution: 'bg-caution-bg text-caution-text border-caution/30',
  notice:  'bg-notice-bg text-notice-text border-notice/30',
  neutral: 'bg-surface-subtle text-content-2 border-edge',
  brand:   'bg-brand-subtle text-brand-dim border-brand-light',
  wa:      'bg-[#dcfce7] text-[#166534] border-[#bbf7d0] dark:bg-[#052e16] dark:text-[#4ade80] dark:border-[#166534]',
  ms:      'bg-[#dbeafe] text-[#1e40af] border-[#bfdbfe] dark:bg-[#1e3a5f] dark:text-[#93c5fd] dark:border-[#1e40af]',
  ig:      'bg-[#fce7f3] text-[#9d174d] border-[#fbcfe8] dark:bg-[#4a0020] dark:text-[#f9a8d4] dark:border-[#9d174d]',
  cx:      'bg-brand-subtle text-brand-dim border-brand-light',
};

export default function Badge({ variant = 'neutral', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border',
        variantClasses[variant],
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </span>
  );
}
