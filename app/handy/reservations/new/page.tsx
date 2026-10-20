import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { todayJst } from '@/lib/format';
import { requireHandyClerk } from '@/lib/handy-session';
import { handyReservationsHref, parseHandyDate } from '@/lib/handy-reservations';
import { HandyBackButton, HandyMain, HandyTopBar } from '@/components/handy/handy-chrome';
import { HandyReservationForm } from '@/components/handy/handy-reservation-form';
import { loadReservationEntryData } from '@/lib/reservation-entry-server';

export const metadata: Metadata = { title: '予約を追加' };

/**
 * ハンディで予約を追加する（2026-10-15 Ronnie「予約の追加もハンディでできるように」）。
 * 登録はレジの予約台帳の「電話予約を登録」と同じ（createManualReservation・予約の登録の権限）。
 * 2026-10-19 Ronnie「レストランボードのように」→ 2ステップ（日時・人数・空いているテーブル → 詳細）。
 */
export default async function HandyNewReservationPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];
  const today = todayJst();
  const date = parseHandyDate((await searchParams).date, today);
  const back = <HandyBackButton href={handyReservationsHref(date, today)} label="予約" />;

  if (!store || !can(ctx.role, 'reservations.write')) {
    return (
      <>
        <HandyTopBar left={back} title="予約を追加" />
        <HandyMain>
          <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#766b62]">
            {store
              ? '予約を追加する権限がありません。店長・管理者に権限の付与を依頼してください。'
              : 'アクセス可能な店舗がありません。管理者に店舗の割り当てを依頼してください。'}
          </p>
        </HandyMain>
      </>
    );
  }
  const clerk = await requireHandyClerk();

  const supabase = await createClient();
  const [{ data: sources }, { data: courseRows }, entry] = await Promise.all([
    supabase
      .from('reservation_sources')
      .select('code, name')
      .or(`organization_id.is.null,organization_id.eq.${ctx.organizationId}`)
      .eq('status', 'active')
      .order('sort_order'),
    supabase
      .from('menu_items')
      .select('id, name, store_id')
      .eq('organization_id', ctx.organizationId)
      .eq('item_type', 'course')
      .eq('status', 'active')
      .order('sort_order'),
    // 卓・その日の予約・確保時間・キーワード・担当者（予約可能なテーブル・ピッタリの卓。2026-10-19 Ronnie）
    loadReservationEntryData(supabase, store.id, date),
  ]);

  return (
    <>
      <HandyTopBar left={back} storeName={store.name} title="予約登録" />
      <HandyMain>
        <HandyReservationForm
          storeId={store.id}
          date={date}
          today={today}
          // web・ウォークインは自動で付くので選ばない（予約台帳と同じ）
          sources={(sources ?? [])
            .filter((s) => s.code !== 'web' && s.code !== 'walk_in')
            .map((s) => ({ value: s.code as string, label: s.name as string }))}
          courses={(courseRows ?? [])
            .filter((c) => c.store_id == null || c.store_id === store.id)
            .map((c) => ({ value: c.id as string, label: c.name as string }))}
          clerk={clerk.id ? { id: clerk.id, name: clerk.name } : null}
          initialEntry={entry}
        />
      </HandyMain>
    </>
  );
}
