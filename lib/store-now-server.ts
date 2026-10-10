import type { createClient } from '@/lib/supabase/server';
import { formatTime, todayJst } from '@/lib/format';
import { groupOfTable, tableGroupsFrom } from '@/lib/table-group';
import { CREATED_VIA_LABEL } from '@/components/reservations/constants';
import { RESERVATION_ROW_SELECT, type RawReservationRow } from '@/components/reservations/row-mapper';
import {
  nextReservationFor,
  nowTableStatus,
  reservationMemo,
  reservationStatusLabel,
  summarizeNow,
  type NowLine,
  type NowOrder,
  type NowReservation,
  type NowTable,
  type StoreNowData,
} from '@/lib/store-now';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** 予約の画面に出す状態（キャンセル・キャンセル待ちは除く。テーブル一覧の右パネルと同じ） */
const PANEL_STATUSES = ['pending', 'confirmed', 'waiting', 'arrived', 'seated', 'billing', 'completed', 'no_show'];

interface Source {
  created_via: string;
  reservation_sources: One<{ name: string }>;
}

/** 来店経路の名前（テーブル一覧と同じ決め方） */
function sourceLabel(r: Source | null): string {
  if (!r) return '直接来店';
  const src = one(r.reservation_sources);
  if (src?.name) return src.name;
  if (r.created_via === 'walk_in') return '直接来店';
  return CREATED_VIA_LABEL[r.created_via] ?? r.created_via;
}

interface OrderRow {
  id: string;
  table_id: string | null;
  opened_at: string;
  guest_count: number;
  total: number;
  clerk_name: string | null;
  customers: One<{ name: string }>;
  reservations: One<
    Source & {
      guest_name: string;
      start_at: string | null;
      end_at: string;
      memo: string | null;
      request_note: string | null;
      allergy_note: string | null;
      menu_items: One<{ name: string; duration_minutes: number | null }>;
    }
  >;
}

/**
 * 店舗ナウのデータ（見るだけ）。RLS のかかったセッションのクライアントで読む。
 * 卓・未会計の伝票・本日の予約は、テーブル一覧（app/app/floor/page.tsx）と同じ決め方。
 */
export async function loadStoreNow(
  supabase: SupabaseClient,
  store: { id: string; name: string },
  now: number
): Promise<StoreNowData> {
  const today = todayJst();
  const [{ data: floors }, { data: tables }, { data: settings }, { data: orderRows }, { data: resvRows }] = await Promise.all([
    supabase.from('floors').select('id, name, sort_order').eq('store_id', store.id).eq('status', 'active').order('sort_order').order('name'),
    supabase
      .from('restaurant_tables')
      .select('id, floor_id, name, capacity_max, current_status')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order'),
    supabase.from('store_settings').select('default_stay_minutes, settings').eq('store_id', store.id).maybeSingle(),
    supabase
      .from('orders')
      .select(
        `id, table_id, opened_at, guest_count, total, clerk_name,
         customers(name),
         reservations(guest_name, created_via, start_at, end_at, memo, request_note, allergy_note, reservation_sources(name),
           menu_items(name, duration_minutes))`
      )
      .eq('store_id', store.id)
      .eq('status', 'open')
      .not('table_id', 'is', null)
      .order('opened_at'),
    supabase
      .from('reservations')
      .select(RESERVATION_ROW_SELECT)
      .eq('store_id', store.id)
      .eq('reserved_date', today)
      .in('status', PANEL_STATUSES)
      .order('start_at'),
  ]);

  const orders = (orderRows ?? []) as unknown as OrderRow[];
  const orderIds = orders.map((o) => o.id);
  const { data: itemRows } = orderIds.length
    ? await supabase
        .from('order_items')
        .select('order_id, name, quantity, line_total, kitchen_sent_at')
        .in('order_id', orderIds)
        .eq('status', 'active')
        .order('created_at')
    : { data: [] };
  const linesByOrder = new Map<string, NowLine[]>();
  for (const it of (itemRows ?? []) as { order_id: string; name: string; quantity: number; line_total: number | null; kitchen_sent_at: string | null }[]) {
    const list = linesByOrder.get(it.order_id) ?? [];
    list.push({ name: it.name, quantity: it.quantity, lineTotal: Number(it.line_total ?? 0), sent: !!it.kitchen_sent_at });
    linesByOrder.set(it.order_id, list);
  }

  const stayDefault = (settings?.default_stay_minutes as number | null) ?? 120;

  // 卓ごとの未会計（同じ卓に何枚もあれば人数・金額を合わせる。テーブル一覧と同じ）
  const orderByTable = new Map<string, NowOrder>();
  for (const o of orders) {
    if (!o.table_id) continue;
    const resv = one(o.reservations);
    const course = resv ? one(resv.menu_items) : null;
    const openedAtMs = new Date(o.opened_at).getTime();
    const resvStartMs = resv?.start_at ? new Date(resv.start_at).getTime() : NaN;
    const resvEndMs = resv ? new Date(resv.end_at).getTime() : NaN;
    const seatTimeSet = Number.isFinite(resvStartMs) && Math.abs(resvStartMs - openedAtMs) < 60_000 && resvEndMs > openedAtMs;
    const courseMinutes = course?.duration_minutes && course.duration_minutes > 0 ? course.duration_minutes : null;
    const endAtMs = seatTimeSet
      ? resvEndMs
      : courseMinutes
        ? openedAtMs + courseMinutes * 60_000
        : resv && resvEndMs > openedAtMs
          ? resvEndMs
          : openedAtMs + stayDefault * 60_000;
    const prev = orderByTable.get(o.table_id);
    const isWalkIn = !resv || resv.guest_name === 'ウォークイン' || resv.created_via === 'walk_in';
    orderByTable.set(o.table_id, {
      id: o.id,
      orderIds: [...(prev?.orderIds ?? []), o.id],
      guestCount: (prev?.guestCount ?? 0) + o.guest_count,
      total: (prev?.total ?? 0) + Number(o.total ?? 0),
      openedAtMs: prev ? Math.min(prev.openedAtMs, openedAtMs) : openedAtMs,
      endAtMs: prev ? Math.max(prev.endAtMs, endAtMs) : endAtMs,
      guestName: !isWalkIn && resv ? resv.guest_name : (prev?.guestName ?? null),
      customerName: one(o.customers)?.name ?? prev?.customerName ?? null,
      sourceLabel: resv ? sourceLabel(resv) : (prev?.sourceLabel ?? '直接来店'),
      clerkName: o.clerk_name ?? prev?.clerkName ?? null,
      courseName: course?.name ?? prev?.courseName ?? null,
      courseMinutes: courseMinutes ?? prev?.courseMinutes ?? null,
      reservationTime: !isWalkIn && resv?.start_at ? formatTime(resv.start_at) : (prev?.reservationTime ?? null),
      memo: (resv ? reservationMemo(resv) : null) ?? prev?.memo ?? null,
      lines: [...(prev?.lines ?? []), ...(linesByOrder.get(o.id) ?? [])],
    });
  }

  // テーブル連携：組のどれかに伝票があれば、組の全部の卓に同じお客様として出す
  const tableRows = (tables ?? []) as { id: string; floor_id: string | null; name: string; capacity_max: number; current_status: string }[];
  const groups = tableGroupsFrom(settings?.settings);
  for (const g of groups) {
    const withOrder = g.tableIds.map((id) => orderByTable.get(id)).find((o) => !!o);
    if (!withOrder) continue;
    for (const id of g.tableIds) if (!orderByTable.has(id)) orderByTable.set(id, withOrder);
  }

  const reservationsToday = ((resvRows ?? []) as unknown as RawReservationRow[]).filter((r) => r.created_via !== 'walk_in');
  const upcomingByTable = new Map<string, { startMs: number; time: string; name: string; partySize: number; status: string }[]>();
  for (const r of reservationsToday) {
    for (const link of r.reservation_tables ?? []) {
      const list = upcomingByTable.get(link.table_id) ?? [];
      list.push({ startMs: new Date(r.start_at).getTime(), time: formatTime(r.start_at), name: r.guest_name, partySize: r.party_size, status: r.status });
      upcomingByTable.set(link.table_id, list);
    }
  }

  const nameById = new Map(tableRows.map((t) => [t.id, t.name]));
  const nowTables: NowTable[] = tableRows.map((t) => {
    const order = orderByTable.get(t.id) ?? null;
    const group = groupOfTable(groups, t.id);
    return {
      id: t.id,
      name: t.name,
      floorId: t.floor_id,
      capacity: t.capacity_max,
      status: nowTableStatus(t.current_status, !!order),
      order,
      groupNames: group ? group.tableIds.map((id) => nameById.get(id)).filter((n): n is string => !!n) : [],
      next: order ? null : nextReservationFor(upcomingByTable.get(t.id) ?? [], now),
    };
  });

  const reservations: NowReservation[] = reservationsToday.map((r) => {
    const tablesLabel = (r.reservation_tables ?? [])
      .map((l) => nameById.get(l.table_id) ?? l.restaurant_tables?.name ?? null)
      .filter((n): n is string => !!n)
      .join(' + ');
    return {
      id: r.id,
      time: formatTime(r.start_at),
      startMs: new Date(r.start_at).getTime(),
      name: r.guest_name,
      partySize: r.party_size,
      tables: tablesLabel || '席未定',
      courseName: r.course?.name ?? null,
      source: sourceLabel(r as unknown as Source),
      status: r.status,
      statusLabel: reservationStatusLabel(r.status),
      memo: reservationMemo(r),
    };
  });

  return {
    store,
    floors: ((floors ?? []) as { id: string; name: string }[]).map((f) => ({ id: f.id, name: f.name })),
    tables: nowTables,
    reservations,
    summary: summarizeNow(nowTables, reservations, now),
  };
}
