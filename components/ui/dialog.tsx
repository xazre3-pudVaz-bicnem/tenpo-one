'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  /** 会計モーダル等の広い画面用 */
  wide?: boolean;
  /** 'right' … 画面の右side から出す（レジのテーブル選択など。左のフロアが見えたまま操作できる） */
  side?: 'center' | 'right';
}

export function Dialog({ open, onClose, title, children, className, wide, side = 'center' }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const right = side === 'right';

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        right ? 'items-stretch justify-end' : 'items-end justify-center sm:items-center'
      )}
    >
      <div
        className="absolute inset-0 bg-navy/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 w-full overflow-y-auto bg-white shadow-xl',
          right
            ? 'h-full max-h-none rounded-t-2xl sm:max-w-[420px] sm:rounded-none sm:rounded-l-2xl'
            : cn('max-h-[92vh] rounded-t-2xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'),
          className
        )}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
          <h2 className="text-base font-semibold text-navy">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
