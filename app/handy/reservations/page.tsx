import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { formatTime, todayJst } from '@/lib/format';
import { requireHandyClerk } from '@/lib/handy-session';
import { handyDayLabel, handyEmptyText, handyReservationsTitle, parseHandyDate } from '@/lib/handy-reservations';
import { HandyReservationDateBar } from '@/components/handy/handy-reservation-date-bar';
import { RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';
import { CREATED_VIA_LABEL } from '@/components/reservations/constants';
import {
  HandyBookingShareButton,
  HandyMain,
  HandyMenuButton,
  HandyOperatorBar,
  HandyRefreshButton,
  HandyTopBar,
} from '@/components/handy/handy-chrome';
import {
  HandyReservationList,
  type HandyReservationRow,
} from '@/components/handy/handy-reservation-list';

export const metadata: Metadata = { title: '予約' };

/** ハンディに出す予約の状態（キャンセル待ちは台帳側の管理なので出さない） */
const LISTED_STATUSES: ReservationStatus[] = [
  'pending',
  'confirmed',
  'waiting',
  'arrived',
  'seated',
  'billing',
  'completed',
  'no_show',
  'cancelled',
];
const UPCOMING: ReadonlySet<string> = new Set(['pending', 'confirmed', 'waiting', 'arrived', 'seated', 'billing']);

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

interface ReservationRow {
  id: string;
  start_at: string;
  end_at: string | null;
  guest_name: string;
  guest_phone: string | null;
  party_size: number;
  status: string;
  created_via: string;
  request_note: string | null;
  memo: string | null;
  course: One<{ name: string }>;
  reservation_sources: One<{ name: string }>;
  reservation_tables: { table_id: string; restaurant_tables: One<{ name: string }> }[] | null;
}

/**
 * 予約（承認済みレイアウトの RESERVATION）。既定は今日。?date=YYYY-MM-DD でほかの日も見られる
 * （2026-10-15 Ronnie「ハンディの予約でほかの日も見られるように。予約の追加もハンディで」）。
 * ウォークイン（ハンディ・フロアで着席させたもの）は予約ではないので出さない。
 */
export default async function HandyReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'reservations.view')) {
    return (
      <>
        <HandyTopBar left={<HandyMenuButton />} title="今日の予約" />
        <HandyMain>
          <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#766b62]">
            {store
              ? '予約を見る権限がありません。店長・管理者に権限の付与を依頼してください。'
              : 'アクセス可能な店舗がありません。管理者に店舗の割り当てを依頼してください。'}
          </p>
        </HandyMain>
      </>
    );
  }
  const clerk = await requireHandyClerk();

  const supabase = await createClient();
  const today = todayJst();
  const date = parseHandyDate((await searchParams).date, today);
  const title = handyReservationsTitle(date, today);
  const [{ data: rows }, { data: openOrders }] = await Promise.all([
    supabase
      .from('reservations')
      .select(
        'id, start_at, end_at, guest_name, guest_phone, party_size, status, created_via, request_note, memo, course:menu_items(name), reservation_sources(name), reservation_tables(table_id, restaurant_tables(name))'
      )
      .eq('store_id', store.id)
      .eq('reserved_date', date)
      .in('status', LISTED_STATUSES)
      .neq('created_via', 'walk_in')
      .order('start_at'),
    supabase
      .from('orders')
      .select('reservation_id, table_id')
      .eq('store_id', store.id)
      .eq('status', 'open')
      .not('reservation_id', 'is', null),
  ]);
  const tableByReservation = new Map<string, string>();
  for (const o of openOrders ?? []) {
    if (o.reservation_id && o.table_id) tableByReservation.set(o.reservation_id, o.table_id);
  }

  const reservations: HandyReservationRow[] = ((rows ?? []) as unknown as ReservationRow[]).map((r) => {
    const names = (r.reservation_tables ?? [])
      .map((l) => one(l.restaurant_tables)?.name)
      .filter((n): n is string => !!n);
    const status = (r.status in RESERVATION_STATUS ? r.status : 'pending') as ReservationStatus;
    return {
      id: r.id,
      time: formatTime(r.start_at),
      endTime: r.end_at ? formatTime(r.end_at) : null,
      name: r.guest_name,
      phone: r.guest_phone?.trim() || null,
      partySize: r.party_size,
      tableLabel: names.length > 0 ? names.join('+') : '席未定',
      sourceLabel: one(r.reservation_sources)?.name ?? CREATED_VIA_LABEL[r.created_via] ?? r.created_via,
      courseName: one(r.course)?.name ?? null,
      status,
      statusLabel: RESERVATION_STATUS[status].label,
      upcoming: UPCOMING.has(status),
      request: r.request_note || null,
      memo: r.memo || null,
      note: r.request_note || r.memo || null,
      tableId: tableByReservation.get(r.id) ?? null,
    };
  });

  return (
    <>
      <HandyTopBar
        left={<HandyMenuButton />}
        storeName={store.name}
        title={title}
        right={<HandyRefreshButton />}
      />
      <HandyOperatorBar label={clerk.name} note={`${handyDayLabel(date)} · ${reservations.length}件`} />
      <HandyMain>
        <HandyReservationDateBar date={date} today={today} canAdd={can(ctx.role, 'reservations.write')} />
        <div className="flex justify-end px-3 pt-2 empty:hidden">
          <HandyBookingShareButton />
        </div>
        <HandyReservationList reservations={reservations} emptyText={handyEmptyText(date, today)} />
        <p className="px-5 pb-5 text-center text-[10px] leading-relaxed text-[#766b62]">
          予約の変更・来店処理はレジ（管理画面）の予約台帳で行います。
        </p>
      </HandyMain>
    </>
  );
}
