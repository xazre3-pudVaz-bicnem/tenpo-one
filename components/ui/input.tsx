import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400',
        'focus:border-primary focus:outline-2 focus:outline-primary/30 disabled:bg-gray-100 disabled:text-gray-500',
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400',
        'focus:border-primary focus:outline-2 focus:outline-primary/30 disabled:bg-gray-100',
        className
      )}
      rows={3}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900',
        'focus:border-primary focus:outline-2 focus:outline-primary/30 disabled:bg-gray-100',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('mb-1 block text-sm font-medium text-gray-700', className)} {...props}>
      {children}
    </label>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-danger">{message}</p>;
}
