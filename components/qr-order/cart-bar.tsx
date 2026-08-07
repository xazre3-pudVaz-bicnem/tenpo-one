'use client';

import { yen } from '@/lib/format';

/** 下部固定のカートバー。タップで確認画面へ */
export function CartBar({
  count,
  total,
  onOrder,
}: {
  count: number;
  total: number;
  onOrder: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
      <button
        type="button"
        onClick={onOrder}
        className="flex h-14 w-full items-center justify-between rounded-lg bg-primary px-5 text-white active:scale-[0.98]"
      >
        <span className="text-sm font-semibold">{count}点</span>
        <span className="text-base font-bold tabular-nums">{yen(total)}</span>
        <span className="text-sm font-semibold">注文する</span>
      </button>
    </div>
  );
}
