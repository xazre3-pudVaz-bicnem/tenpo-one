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
  // 入力は「万円」（2026-09-30 Ronnie「金額は万円で入れる。横に万円と書いて、そのまま計算」）。1,500 → 1,500万円 = ¥15,000,000
  const [value, setValue] = useState(current != null && current > 0 ? manFromYen(current) : '');

  const man = parseMan(value);
  const amount = man == null ? null : Math.round(man * 10_000);
  const changed = amount != null && amount !== (current ?? 0);

  const save = () => {
    if (amount == null) return;
    startTransition(async () => {
      const res = await saveMonthlySalesTarget({ storeId, month, amount });
      if (res.error) {
        toast(res.error, 'error');
        return;
      }
      toast(
        res.dailyDistributed
          ? '売上目標を保存しました。曜日ごとの売上に合わせて日別予算も作りました'
          : '売上目標を保存しました'
      );
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
        <span className="sr-only">売上目標（万円）</span>
        <input
          inputMode="decimal"
          autoComplete="off"
          value={formatMan(value)}
          onChange={(e) => setValue(e.target.value)}
          placeholder="例: 1,500"
          disabled={pending}
          className="h-11 w-full min-w-[10rem] rounded-xl border border-line bg-white pr-14 pl-3 text-right text-lg font-bold text-ink tabular-nums focus:border-iris focus:outline-2 focus:outline-iris/30 disabled:bg-gray-100"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm font-bold text-ink-2">万円</span>
        {amount != null && amount > 0 && (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-ink-3 tabular-nums">
            ＝¥{amount.toLocaleString('ja-JP')}
          </span>
        )}
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

/** 入力の文字から万円の数（小数は1桁まで）。空・不正は null */
function parseMan(text: string): number | null {
  const cleaned = text.replace(/[^\d.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const [int, frac = ''] = cleaned.split('.');
  const n = Number(`${int || '0'}.${frac.slice(0, 1) || '0'}`);
  return Number.isFinite(n) ? n : null;
}

/** 入力中の文字を 1,500 / 1,500.5 のように整える（打っている途中の「.」は残す） */
function formatMan(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, '');
  if (cleaned === '') return '';
  const [int, ...rest] = cleaned.split('.');
  const head = int === '' ? '0' : Number(int).toLocaleString('ja-JP');
  return rest.length > 0 ? `${head}.${rest.join('').slice(0, 1)}` : head;
}

/** 保存されている円を万円の文字に（1万円未満の端数は小数1桁まで） */
function manFromYen(yen: number): string {
  const man = Math.round(yen / 1_000) / 10;
  return Number.isInteger(man) ? String(man) : man.toFixed(1);
}
