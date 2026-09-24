'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * 店舗台帳の「…」（そのほか）。
 * 上のタブは ホーム／予約リスト／スケジュール／グルメ別／顧客台帳 の5つだけにして、
 * 週間・月間・ウェイティング・印刷などは全部ここに入れる（2026-09-24 レイアウト要望）。
 *
 * 中の項目はリンクでもダイアログの開くボタンでもよい（見た目はここで揃える）。
 */
export function LedgerMoreMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative print:hidden">
      <button
        type="button"
        aria-label="そのほか"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-[9px] border border-line bg-white text-ink-2 transition-colors hover:border-iris hover:text-iris"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-line bg-white p-1.5 shadow-card [&>*]:flex [&>*]:h-11 [&>*]:w-full [&>*]:items-center [&>*]:justify-start [&>*]:gap-2 [&>*]:rounded-lg [&>*]:px-3 [&>*]:text-left [&>*]:text-[14px] [&>*]:font-semibold [&>*]:text-ink [&>*:hover]:bg-lilac-soft"
        >
          {children}
        </div>
      )}
    </div>
  );
}
