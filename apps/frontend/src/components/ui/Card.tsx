import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: boolean;
}

export default function Card({ padding = true, className = '', children, ...props }: CardProps) {
  return (
    <div
      className={[
        'bg-surface-raised border border-edge rounded-lg shadow-sm',
        'transition-colors duration-200',
        padding ? 'p-5' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  );
}
