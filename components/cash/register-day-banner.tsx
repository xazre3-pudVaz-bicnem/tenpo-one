import Link from 'next/link';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadStoreDay } from '@/lib/register-day-server';
import { dayBannerKind, jstHour, mdLabel } from '@/lib/register-day';

/**
 * 「レジがまだ閉まっていません」（2026-09-28 Ronnie：レジ精算をするまでは前の営業日のまま続ける。
 * 朝10時を過ぎても閉まっていなければ知らせる。2日以上前から開きっぱなしなら、売上は今日の日付に入るので強く知らせる）
 *
 * short：パソコンの管理画面向け（2026-10-24 Ronnie「管理画面にはこの長い赤い帯は要らない。レジクローズがまだ、とだけ」
 *   「レジクローズは iPad のレジアプリでしかできないので、ここは知らせるだけ。リンクは要らない」）。
 *   「M/D のレジがまだクローズされていません」を控えめに出すだけ（ボタン無し）。レジ（iPad）はこれまでどおり。
 */
export async function RegisterDayBanner({ storeId, compact, short }: { storeId: string; compact?: boolean; short?: boolean }) {
  const supabase = await createClient();
  const now = new Date();
  const day = await loadStoreDay(supabase, storeId, now);
  const kind = dayBannerKind(day, jstHour(now));
  if (!kind) return null;
  if (short) {
    const openDate = kind === 'continuing' ? day.businessDate : (day.oldestOpen ?? day.clock);
    return (
      <div
        role="status"
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-saffron/40 bg-saffron-soft px-4 py-2 text-[13px] font-bold text-ink"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-saffron" aria-hidden />
        <span className="min-w-0 flex-1">{mdLabel(openDate)} のレジがまだクローズされていません</span>
        <span className="shrink-0 text-[12px] font-medium text-ink-3">レジクローズは iPad のレジで</span>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-danger/30 bg-danger-soft px-4 text-[13px] font-bold text-danger',
        compact ? 'mb-2 py-2' : 'mb-3 py-2.5',
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {kind === 'continuing'
          ? `${mdLabel(day.businessDate)} の営業日のレジがまだ閉まっていません。売上は ${mdLabel(day.businessDate)} の営業日に入っています。レジ精算をしてください`
          : `${mdLabel(day.oldestOpen ?? day.clock)} から開いたままのレジがあります。2日以上前なので、売上は ${mdLabel(day.businessDate)} の日付に入っています。すぐにレジ精算をしてください`}
      </span>
      <Link href="/app/cash/close" className="shrink-0 rounded-lg bg-white px-3 py-1 text-[12.5px] text-danger underline-offset-2 hover:underline">
        レジクローズへ
      </Link>
    </div>
  );
}
