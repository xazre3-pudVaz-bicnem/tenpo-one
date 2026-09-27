import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadStoreDay } from '@/lib/register-day-server';
import { dayBannerKind, jstHour, mdLabel } from '@/lib/register-day';

/**
 * 「レジがまだ閉まっていません」（2026-09-28 Ronnie：レジ精算をするまでは前の営業日のまま続ける。
 * 朝10時を過ぎても閉まっていなければ知らせる。2日以上前から開きっぱなしなら、売上は今日の日付に入るので強く知らせる）
 */
export async function RegisterDayBanner({ storeId }: { storeId: string }) {
  const supabase = await createClient();
  const now = new Date();
  const day = await loadStoreDay(supabase, storeId, now);
  const kind = dayBannerKind(day, jstHour(now));
  if (!kind) return null;
  return (
    <div
      role="alert"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-danger/30 bg-danger-soft px-4 py-2.5 text-[13px] font-bold text-danger"
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
