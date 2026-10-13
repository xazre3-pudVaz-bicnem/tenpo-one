import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { formatTime, todayJst } from '@/lib/format';
import { floorBoardFrom } from '@/lib/floor-nav';
import { groupOfTable, tableGroupsFrom } from '@/lib/table-group';
import { CREATED_VIA_LABEL } from '@/components/reservations/constants';
import {
  floorCourseLabel,
  floorEndAtMs,
  type NativeFloorOrder,
  type NativeFloorPayload,
  type NativeFloorTable,
} from '@/lib/native-floor';

/**
 * ネイティブの「テーブル一覧」の中身。Web のフロア（app/app/floor/page.tsx）と同じ読み方・同じ決まり
 * （卓ごとの未会計伝票の合算・終了予定・今日のこれからの予約・テーブル連携・お客様の呼び出し）。
 * Web のページは変えない。
 */

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** 未来店として「次の予約」に出すステータス（Web のフロアと同じ） */
const UPCOMING_STATUSES = ['pending', 'confirmed', 'waiting'];
/** 右の一覧に出すステータス（キャンセル・キャンセル待ちは除く） */
const PANEL_STATUSES = ['pending', 'confirmed', 'waiting', 'arrived', 'seated', 'billing', 'completed', 'no_show'];

interface SourceRow {
  created_via: string;
  reservation_sources: One<{ name: string }>;
}

function sourceLabel(r: SourceRow | null): string {
  if (!r) return '直接来店';
  const src = one(r.reservation_sources);
  if (src?.name) return src.name;
  if (r.created_via === 'walk_in') return '直接来店';
  return CREATED_VIA_LABEL[r.created_via] ?? r.created_via;
}

interface OrderRow {
  id: string;
  order_no: number | null;
  table_id: string | null;
  opened_at: string;
  guest_count: number;
  total: number;
  clerk_name: string | null;
  customers: One<{ name: string }>;
  reservations: One<
    SourceRow & {
      guest_name: string;
      start_at: string | null;
      end_at: string;
      menu_items: One<{ duration_minutes: number | null; course_includes_drinks: boolean | null; course_includes_ayce: boolean | null }>;
    }
  >;
}

interface ReservationRow extends SourceRow {
  id: string;
  start_at: string;
  guest_name: string;
  party_size: number;
  status: string;
  reservation_tables: { table_id: string }[] | null;
}

export async function loadNativeFloor(ctx: SessionContext): Promise<NativeFloorPayload | { ok: false; status: number; error: string }> {
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) return { ok: false, status: 404, error: 'アクセスできる店舗がありません' };
  const supabase = await createClient();
  const today = todayJst();

  const [{ data: floors }, { data: tables }, { data: settings }, { data: orderRows }, { data: reservationRows }, { data: callRows }] =
    await Promise.all([
      supabase.from('floors').select('id, name, sort_order').eq('store_id', store.id).eq('status', 'active').order('sort_order').order('name'),
      supabase
        .from('restaurant_tables')
        .select('id, floor_id, name, capacity_min, capacity_max, is_private_room, is_counter, current_status')
        .eq('store_id', store.id)
        .eq('status', 'active')
        .order('sort_order'),
      supabase.from('store_settings').select('default_stay_minutes, settings').eq('store_id', store.id).maybeSingle(),
      supabase
        .from('orders')
        .select(
          `id, order_no, table_id, opened_at, guest_count, total, clerk_name,
           customers(name),
           reservations(guest_name, created_via, start_at, end_at, reservation_sources(name),
             menu_items(duration_minutes, course_includes_drinks, course_includes_ayce))`
        )
        .eq('store_id', store.id)
        .eq('status', 'open')
        .not('table_id', 'is', null)
        .order('opened_at'),
      supabase
        .from('reservations')
        .select('id, start_at, guest_name, party_size, status, created_via, reservation_sources(name), reservation_tables(table_id)')
        .eq('store_id', store.id)
        .eq('reserved_date', today)
        .in('status', PANEL_STATUSES)
        .order('start_at'),
      supabase.from('service_calls').select('table_id, kind').eq('store_id', store.id).eq('status', 'open'),
    ]);

  const stayMinutes = (settings as { default_stay_minutes?: number | null } | null)?.default_stay_minutes ?? 120;
  const tableRows = (tables ?? []) as {
    id: string;
    floor_id: string | null;
    name: string;
    capacity_min: number | null;
    capacity_max: number | null;
    is_private_room: boolean | null;
    is_counter: boolean | null;
    current_status: string;
  }[];
  const tableName = new Map(tableRows.map((t) => [t.id, t.name]));

  // 卓ごとの未会計伝票（同じ卓に複数あれば、いちばん新しいものを代表にし、金額・人数は合算）
  const orderByTable = new Map<string, NativeFloorOrder>();
  for (const o of (orderRows ?? []) as unknown as OrderRow[]) {
    if (!o.table_id) continue;
    const resv = one(o.reservations);
    const course = resv ? one(resv.menu_items) : null;
    const openedAtMs = new Date(o.opened_at).getTime();
    const courseMinutes = course?.duration_minutes && course.duration_minutes > 0 ? course.duration_minutes : null;
    const endAtMs = floorEndAtMs({
      openedAtMs,
      resvStartMs: resv?.start_at ? new Date(resv.start_at).getTime() : null,
      resvEndMs: resv ? new Date(resv.end_at).getTime() : null,
      courseMinutes,
      stayMinutes,
    });
    const prev = orderByTable.get(o.table_id);
    orderByTable.set(o.table_id, {
      id: o.id,
      orderNo: o.order_no ?? 0,
      openedAtMs: prev ? Math.min(prev.openedAtMs, openedAtMs) : openedAtMs,
      endAtMs: prev ? Math.max(prev.endAtMs, endAtMs) : endAtMs,
      guestCount: (prev?.guestCount ?? 0) + o.guest_count,
      total: (prev?.total ?? 0) + Number(o.total ?? 0),
      clerkName: o.clerk_name ?? prev?.clerkName ?? null,
      guestName: resv && resv.guest_name !== 'ウォークイン' ? resv.guest_name : (one(o.customers)?.name ?? prev?.guestName ?? null),
      sourceLabel: resv ? sourceLabel(resv) : (prev?.sourceLabel ?? '直接来店'),
      courseLabel: course && courseMinutes ? floorCourseLabel(course) : (prev?.courseLabel ?? null),
      slips: [...(prev?.slips ?? []), { id: o.id, orderNo: o.order_no ?? 0 }],
    });
  }

  // テーブル連携（グループ）：まとめた卓のどれかに伝票があれば、全部の卓に同じ伝票を出す
  const groups = tableGroupsFrom((settings as { settings?: unknown } | null)?.settings);
  for (const g of groups) {
    const withOrder = g.tableIds.map((id) => orderByTable.get(id)).find((o) => !!o);
    if (!withOrder) continue;
    for (const id of g.tableIds) if (!orderByTable.has(id)) orderByTable.set(id, withOrder);
  }

  const reservations = (reservationRows ?? []) as unknown as ReservationRow[];
  const upcomingByTable = new Map<string, NativeFloorTable['upcoming']>();
  for (const r of reservations) {
    if (!UPCOMING_STATUSES.includes(r.status)) continue;
    for (const link of r.reservation_tables ?? []) {
      const list = upcomingByTable.get(link.table_id) ?? [];
      list.push({
        id: r.id,
        startMs: new Date(r.start_at).getTime(),
        time: formatTime(r.start_at),
        name: r.guest_name,
        partySize: r.party_size,
        sourceLabel: sourceLabel(r),
      });
      upcomingByTable.set(link.table_id, list);
    }
  }

  const callsByTable = new Map<string, { kind: string }[]>();
  for (const c of (callRows ?? []) as { table_id: string; kind: string }[]) {
    const list = callsByTable.get(c.table_id) ?? [];
    list.push({ kind: c.kind });
    callsByTable.set(c.table_id, list);
  }

  return {
    ok: true,
    store: { id: store.id, name: store.name },
    floors: ((floors ?? []) as { id: string; name: string }[]).map((f) => ({ id: f.id, name: f.name })),
    defaultFloorId: floorBoardFrom((settings as { settings?: unknown } | null)?.settings).defaultFloorId,
    tables: tableRows.map((t) => {
      const groupIds = groupOfTable(groups, t.id)?.tableIds ?? [];
      return {
        id: t.id,
        floorId: t.floor_id,
        name: t.name,
        capacityMin: Number(t.capacity_min ?? 1),
        capacityMax: Number(t.capacity_max ?? t.capacity_min ?? 1),
        status: t.current_status,
        isCounter: !!t.is_counter,
        isPrivateRoom: !!t.is_private_room,
        order: orderByTable.get(t.id) ?? null,
        upcoming: upcomingByTable.get(t.id) ?? [],
        groupNames: groupIds.length > 1 ? tableRows.filter((x) => groupIds.includes(x.id)).map((x) => x.name) : [],
        calls: callsByTable.get(t.id) ?? [],
      };
    }),
    reservations: reservations
      .filter((r) => r.created_via !== 'walk_in')
      .map((r) => {
        const names = (r.reservation_tables ?? []).map((l) => tableName.get(l.table_id)).filter((n): n is string => !!n);
        return {
          id: r.id,
          startMs: new Date(r.start_at).getTime(),
          time: formatTime(r.start_at),
          name: r.guest_name,
          partySize: r.party_size,
          tableLabel: names.length > 0 ? names.join(' + ') : '席未定',
          status: r.status,
        };
      }),
    canOperate: !!ctx.role && can(ctx.role, 'tables.operate'),
    serverNow: Date.now(),
  };
}
