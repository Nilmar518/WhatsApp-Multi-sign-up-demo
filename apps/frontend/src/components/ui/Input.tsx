import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

const base =
  'w-full px-3 py-2 text-sm rounded-md border border-edge bg-surface-raised ' +
  'text-content placeholder:text-content-3 ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ' +
  'transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input ref={ref} className={`${base} ${className}`} {...props} />
  ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', children, ...props }, ref) => (
    <select ref={ref} className={`${base} ${className}`} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
