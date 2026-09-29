'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Target } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { saveMonthlySalesTarget } from './actions';

/**
 * 今月の売上目標（金額を入れて「目標を保存」）。2026-09-30 Ronnie「予算設定の中に 今月の売上目標 のボタンと金額入力」。
 * 保存するのは budgets.sales_budget だけ（原価率などの目標は「編集」から）。
 */
export function MonthlyTargetForm({
  storeId,
  month,
  current,
}: {
  storeId: string | null;
  /** 'YYYY-MM-01' */
  month: string;
  current: number | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current != null && current > 0 ? String(current) : '');

  const digits = value.replace(/[^\d]/g, '');
  const amount = digits === '' ? null : Number(digits);
  const changed = amount != null && amount !== (current ?? 0);

  const save = () => {
    if (amount == null) return;
    startTransition(async () => {
      const res = await saveMonthlySalesTarget({ storeId, month, amount });
      if (res.error) {
        toast(res.error, 'error');
        return;
      }
      toast('売上目標を保存しました');
      router.refresh();
    });
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">売上目標（円）</span>
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm font-bold text-ink-3">¥</span>
        <input
          inputMode="numeric"
          autoComplete="off"
          value={amount == null ? '' : amount.toLocaleString('ja-JP')}
          onChange={(e) => setValue(e.target.value)}
          placeholder="例: 5,000,000"
          disabled={pending}
          className="h-11 w-full min-w-[10rem] rounded-xl border border-line bg-white pr-3 pl-7 text-right text-lg font-bold text-ink tabular-nums focus:border-iris focus:outline-2 focus:outline-iris/30 disabled:bg-gray-100"
        />
      </label>
      <button
        type="submit"
        disabled={pending || !changed}
        className="tap3d inline-flex h-11 items-center gap-1.5 rounded-xl bg-plum px-4 text-[13px] font-bold text-white disabled:opacity-50"
      >
        <Target className="h-4 w-4" aria-hidden />
        {pending ? '保存中…' : '目標を保存'}
        <span className="text-[10px] font-semibold opacity-70">Save</span>
      </button>
    </form>
  );
}
