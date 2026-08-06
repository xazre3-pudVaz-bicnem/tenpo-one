import { cn } from '@/lib/utils';

const tones = {
  gray: 'bg-gray-100 text-gray-700',
  primary: 'bg-primary-soft text-primary-deep',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  navy: 'bg-navy text-white',
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({
  tone = 'gray',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
