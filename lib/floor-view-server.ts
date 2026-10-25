import type { SupabaseClient } from '@supabase/supabase-js';
import { groupOfTable, tableGroupsFrom } from '@/lib/table-group';
import { isSeatCourseItem } from '@/lib/menu-book';
import { floorBoardFrom } from '@/lib/floor-nav';
import { todayJst, formatTime } from '@/lib/format';
import { can } from '@/lib/permissions';
import type { SessionContext } from '@/lib/auth';
import { CREATED_VIA_LABEL } from '@/components/reservations/constants';
import { RESERVATION_ROW_SELECT, mapReservationRow, type RawReservationRow } from '@/components/reservations/row-mapper';
import type { ReservationListRow } from '@/components/reservations/list-types';
import { loadReservationTags } from '@/lib/reservation-tags-server';
import { reservationClerkOptions } from '@/lib/reservation-clerks-server';
import type { SeatCourseOption } from '@/lib/seat-time';
import type {
  FloorRow,
  FloorTable,
  PanelReservation,
  TableOrderInfo,
  TableSlipLine,
  TableView,
  TableCall,
  UpcomingReservation,
} from '@/components/floor/types';
import { loadSetupPlanItems } from '@/app/app/handy/setup-data';
import { plansFromMemo, type HandyPlanItem } from '@/lib/handy-visit';
import { courseTotalMinutes, tableEndAtMs } from '@/lib/table-time-limit';

/**
 * フロア（テーブル一覧）画面のデータを組み立てる。
 * Web の /app/floor（app/app/floor/page.tsx）と、iPad アプリのネイティブのフロア画面（/api/app/v1/pos?part=floor）で
 * 同じものを使う（2026-10-24 Ronnie「レジは全部ネイティブに」。画面が2つあっても中身の作り方は1つ）。
 */

/** 未来店として「次の予約」に出すステータス */
const UPCOMING_STATUSES = ['pending', 'confirmed', 'waiting'];
/** 右パネルに出すステータス（キャンセル・キャンセル待ちは除外） */
const PANEL_STATUSES = ['pending', 'confirmed', 'waiting', 'arrived', 'seated', 'billing', 'completed', 'no_show'];

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

interface ReservationSource {
  created_via: string;
  reservation_sources: One<{ name: string }>;
}

function sourceLabel(r: ReservationSource | null): string {
  if (!r) return '直接来店';
  // 来店経路（食べログ・ホットペッパーなど）が入っていれば、ウォークインでもその名前を出す
  const src = one(r.reservation_sources);
  if (src?.name) return src.name;
  if (r.created_via === 'walk_in') return '直接来店';
  return CREATED_VIA_LABEL[r.created_via] ?? r.created_via;
}

function courseLabel(c: { course_includes_drinks: boolean | null; course_includes_ayce: boolean | null }) {
  if (c.course_includes_ayce && c.course_includes_drinks) return '食飲放';
  if (c.course_includes_ayce) return '食放';
  if (c.course_includes_drinks) return '飲放';
  return '時間制';
}

const isWalkInName = (name: string) => name === 'ウォークイン';

function jstDate(iso: string) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

interface OrderRow {
  id: string;
  order_no: number | null;
  table_id: string | null;
  opened_at: string;
  guest_count: number;
  total: number;
  clerk_name: string | null;
  memo: string | null;
  customers: One<{ name: string; visit_count: number }>;
  reservations: One<
    ReservationSource & {
      id?: string;
      guest_name: string;
      start_at: string | null;
      end_at: string;
      course_id: string | null;
      menu_items: One<{
        duration_minutes: number | null;
        course_includes_drinks: boolean | null;
        course_includes_ayce: boolean | null;
      }>;
    }
  >;
}

export interface FloorView {
  /** 描画の基準時刻（リクエスト時点）。クライアントの時計の初期値にも使う */
  serverNow: number;
  /** 店舗の既定滞在時間（分） */
  stayMinutes: number;
  /** 最初に出すフロア（設定 > テーブル・フロア）。無ければ「すべて」 */
  defaultFloorId: string | null;
  floors: FloorRow[];
  /** 卓の素のデータ（配置・定員）。予約の席変更の選択肢にも使う */
  tableRows: FloorTable[];
  tables: TableView[];
  /** 右パネル「本日のご予約」（ウォークインは除く） */
  panel: PanelReservation[];
  /** 予約詳細（ホームから開く）用の行 */
  panelRows: ReservationListRow[];
  /** 予約の担当者の選択肢 */
  staffOptions: { id: string; name: string }[];
  /** 席の時間・コースを卓のポップアップから直すときに選ぶコース */
  seatCourses: SeatCourseOption[];
  /** お客様情報のモードで選ぶプラン商品（飲み放題B・コースなど。2026-10-24） */
  planItems: HandyPlanItem[];
  canOperate: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnySupabase = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function loadFloorView(
  ctx: SessionContext,
  supabase: AnySupabase,
  store: { id: string }
): Promise<FloorView> {
  const today = todayJst();
  // 読み込みは全部まとめて並列に（前は 5 回に分けて順番に待っていた。2026-10-21 Ronnie「Airレジ・USEN より遅い」）
  const [
    { data: floors },
    { data: tables },
    { data: settings },
    { data: orderRows },
    { data: reservationRows },
    clerkOptionsByStore,
    { data: callRows },
    { data: courseRows },
    planItems,
  ] = await Promise.all([
    supabase
      .from('floors')
      .select('id, name, sort_order')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order')
      .order('name'),
    supabase
      .from('restaurant_tables')
      .select(
        'id, floor_id, name, capacity_min, capacity_max, is_private_room, is_counter, current_status, pos_x, pos_y, shape'
      )
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order'),
    supabase.from('store_settings').select('default_stay_minutes, settings').eq('store_id', store.id).maybeSingle(),
    supabase
      .from('orders')
      .select(
        `id, order_no, table_id, opened_at, guest_count, total, clerk_name, memo,
         customers(name, visit_count),
         reservations(id, guest_name, created_via, start_at, end_at, course_id, reservation_sources(name),
           menu_items(duration_minutes, course_includes_drinks, course_includes_ayce))`
      )
      .eq('store_id', store.id)
      .eq('status', 'open')
      .not('table_id', 'is', null)
      .order('opened_at'),
    supabase
      .from('reservations')
      // 予約詳細（お客様情報・変更・キャンセル）をホームから開けるよう、台帳と同じ項目を読む（2026-09-26）
      .select(RESERVATION_ROW_SELECT)
      .eq('store_id', store.id)
      .eq('reserved_date', today)
      .in('status', PANEL_STATUSES)
      .order('start_at'),
    // 予約詳細のテーブル変更・担当者の選択肢。予約の担当者＝レジの担当名（2026-10-15 Ronnie「レジと台帳は同じ」）
    reservationClerkOptions(supabase, [store.id]),
    // お客様QRからの未対応の呼び出し（卓に鈴のマークで出す。2026-09-28 Ronnie）
    supabase
      .from('service_calls')
      .select('id, table_id, kind, created_at, note')
      .eq('store_id', store.id)
      .eq('status', 'open')
      .order('created_at'),
    // 席の時間・コースを卓のポップアップから直すときに選ぶコース（2026-09-25 店舗要望）。
    // 種別コースに加えて、名前が コース／course の商品（dinii 取込の種別フードのコース）も（isSeatCourseItem）
    supabase
      .from('menu_items')
      .select('id, name, item_type, duration_minutes')
      .eq('organization_id', ctx.organizationId)
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .eq('status', 'active')
      .neq('item_type', 'option')
      .order('sort_order'),
    ctx.organizationId ? loadSetupPlanItems(ctx.organizationId, store.id) : Promise.resolve([] as HandyPlanItem[]),
  ]);

  const staffOptions = clerkOptionsByStore[store.id] ?? [];

  // 2回目（1回目の結果が要るもの）：未会計伝票の品（選択印刷用。2026-09-25 店舗要望）と予約のキーワード。この2つも同時に
  const openOrderIds = ((orderRows ?? []) as { id: string }[]).map((o) => o.id);
  const reservationsToday = (reservationRows ?? []) as unknown as RawReservationRow[];
  const panelSource = reservationsToday.filter((r) => r.created_via !== 'walk_in');
  const [{ data: itemRows }, panelTags] = await Promise.all([
    openOrderIds.length
      ? supabase
          .from('order_items')
          .select('id, order_id, name, quantity, menu_item_id, created_at')
          .in('order_id', openOrderIds)
          .eq('status', 'active')
          .order('created_at')
      : Promise.resolve({ data: [] }),
    // 席に着いた予約のタグ（誕生日・飲み放題…。卓の箱に印で出す。2026-10-24 21:18 Ronnie）も同じ読み込みで
    loadReservationTags(supabase, [
      ...panelSource.map((r) => r.id),
      ...((orderRows ?? []) as unknown as OrderRow[]).map((o) => one(o.reservations)?.id ?? '').filter(Boolean),
    ]),
  ]);
  const linesByOrder = new Map<string, TableSlipLine[]>();
  // 伝票ごとの最後の注文の時刻（卓の箱に「最終注文から N 分」。2026-10-24 22:00 Ronnie「卓へ行く目安に」）
  const lastOrderAtByOrder = new Map<string, number>();
  for (const it of (itemRows ?? []) as { id: string; order_id: string; name: string; quantity: number; menu_item_id: string | null; created_at?: string | null }[]) {
    const list = linesByOrder.get(it.order_id) ?? [];
    list.push({ id: it.id, name: it.name, quantity: it.quantity, menuItemId: it.menu_item_id ?? null });
    linesByOrder.set(it.order_id, list);
    const at = it.created_at ? new Date(it.created_at).getTime() : NaN;
    if (Number.isFinite(at) && at > (lastOrderAtByOrder.get(it.order_id) ?? 0)) lastOrderAtByOrder.set(it.order_id, at);
  }

  const serverNow = Date.now();
  const stayMinutes = settings?.default_stay_minutes ?? 120;
  const tableRows = (tables ?? []) as FloorTable[];
  const tableName = new Map(tableRows.map((t) => [t.id, t.name]));

  // テーブルごとの未会計注文（同一テーブルに複数あれば最も新しいものを代表にし、金額・人数は合算）
  const orderByTable = new Map<string, TableOrderInfo>();
  for (const o of (orderRows ?? []) as unknown as OrderRow[]) {
    if (!o.table_id) continue;
    const customer = one(o.customers);
    const resv = one(o.reservations);
    const course = resv ? one(resv.menu_items) : null;
    const openedAtMs = new Date(o.opened_at).getTime();
    // 卓の箱の「時間制 N分」は席の時間の合計（コースの時間＝L.O.＋30 分。lib/table-time-limit.ts。2026-10-25 Ronnie）
    const courseInfo =
      course?.duration_minutes && course.duration_minutes > 0
        ? { label: courseLabel(course), minutes: courseTotalMinutes(course.duration_minutes) }
        : null;
    // 席の終わり：時間制（来店登録・レジの「席の時間」・コース）は決めた時間（＝L.O.）＋30 分。
    // それ以外（予約客が遅れて来た等）は今まで通り：予約の終了予定 → 店舗の既定滞在時間（lib/table-time-limit.ts）
    const resvStartMs = resv?.start_at ? new Date(resv.start_at).getTime() : NaN;
    const resvEndMs = resv ? new Date(resv.end_at).getTime() : NaN;
    const endAtMs = tableEndAtMs({
      openedAtMs,
      courseMinutes: course?.duration_minutes ?? null,
      resvStartMs,
      resvEndMs,
      stayMinutes,
    });
    const prev = orderByTable.get(o.table_id);
    const slip = {
      id: o.id,
      orderNo: o.order_no ?? 0,
      openedAtMs,
      guestCount: o.guest_count,
      total: Number(o.total ?? 0),
      lines: linesByOrder.get(o.id) ?? [],
    };
    orderByTable.set(o.table_id, {
      id: o.id,
      // 経過時間は最初の注文の開始時刻から数える
      openedAtMs: prev ? Math.min(prev.openedAtMs, openedAtMs) : openedAtMs,
      guestCount: (prev?.guestCount ?? 0) + o.guest_count,
      total: (prev?.total ?? 0) + Number(o.total ?? 0),
      customerName: customer?.name ?? prev?.customerName ?? null,
      visitCount: customer?.visit_count ?? prev?.visitCount ?? null,
      guestName: resv && !isWalkInName(resv.guest_name) ? resv.guest_name : (prev?.guestName ?? null),
      sourceLabel: resv ? sourceLabel(resv) : (prev?.sourceLabel ?? '直接来店'),
      clerkName: o.clerk_name ?? prev?.clerkName ?? null,
      course: courseInfo ?? prev?.course ?? null,
      endAtMs: prev ? Math.max(prev.endAtMs, endAtMs) : endAtMs,
      courseId: resv?.course_id ?? prev?.courseId ?? null,
      plans: plansFromMemo(o.memo) ?? prev?.plans ?? null,
      // 最後の注文の時刻（この卓のすべての伝票で一番新しいもの）。注文がまだなら null
      lastOrderAtMs: Math.max(prev?.lastOrderAtMs ?? 0, lastOrderAtByOrder.get(o.id) ?? 0) || null,
      // 予約のタグ（誕生日・記念日・飲み放題…）。卓の箱に小さな印で出す
      tags: [...new Set([...(prev?.tags ?? []), ...((resv?.id && panelTags.get(resv.id)) || [])])],
      // 会計できない伝票が卓に残らないよう、卓のポップアップからすべての伝票を開けるようにする
      slips: [...(prev?.slips ?? []), slip],
    });
  }

  const panelRows = panelSource.map((r) => ({ ...mapReservationRow(r, null), tags: panelTags.get(r.id) ?? [] }));

  // テーブルごとの未来店予約（開始時刻順）
  const upcomingByTable = new Map<string, UpcomingReservation[]>();
  for (const r of reservationsToday) {
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

  // テーブルグループ（2026-09-25 店舗要望）。まとめた卓のどれかに伝票があれば、同じ組として全部に出す
  const tableGroups = tableGroupsFrom(settings?.settings);
  for (const g of tableGroups) {
    const withOrder = g.tableIds.map((id) => orderByTable.get(id)).find((o) => !!o);
    if (!withOrder) continue;
    for (const id of g.tableIds) if (!orderByTable.has(id)) orderByTable.set(id, withOrder);
  }

  const callsByTable = new Map<string, TableCall[]>();
  for (const c of (callRows ?? []) as { id: string; table_id: string; kind: string; created_at: string; note: string | null }[]) {
    const list = callsByTable.get(c.table_id) ?? [];
    list.push({
      id: c.id,
      kind: c.kind as TableCall['kind'],
      createdAt: c.created_at,
      note: c.note ?? null,
    });
    callsByTable.set(c.table_id, list);
  }

  const tableViews: TableView[] = tableRows.map((t) => ({
    ...t,
    order: orderByTable.get(t.id) ?? null,
    upcoming: upcomingByTable.get(t.id) ?? [],
    groupTableIds: groupOfTable(tableGroups, t.id)?.tableIds ?? [],
    groupTableNames: tableRows
      .filter((x) => (groupOfTable(tableGroups, t.id)?.tableIds ?? []).includes(x.id))
      .map((x) => x.name),
    calls: callsByTable.get(t.id) ?? [],
  }));

  const seatCourses = (
    (courseRows ?? []) as { id: string; name: string; item_type: string | null; duration_minutes: number | null }[]
  )
    .filter((m) => isSeatCourseItem(m.item_type, m.name))
    .map((m) => ({ id: m.id, name: m.name, durationMinutes: m.duration_minutes ?? null }));

  // 右パネル: ウォークイン（直接来店）は予約ではないので除外
  const panel: PanelReservation[] = reservationsToday
    .filter((r) => r.created_via !== 'walk_in')
    .map((r) => {
      const names = (r.reservation_tables ?? [])
        .map((l) => tableName.get(l.table_id))
        .filter((n): n is string => !!n);
      return {
        id: r.id,
        startMs: new Date(r.start_at).getTime(),
        time: formatTime(r.start_at),
        name: r.guest_name,
        partySize: r.party_size,
        tableLabel: names.length > 0 ? names.join(' + ') : '席未定',
        status: r.status,
        createdToday: jstDate(r.created_at) === today,
      };
    });

  return {
    serverNow,
    stayMinutes,
    defaultFloorId: floorBoardFrom(settings?.settings).defaultFloorId,
    floors: (floors ?? []) as FloorRow[],
    tableRows,
    tables: tableViews,
    panel,
    panelRows,
    staffOptions,
    seatCourses,
    planItems,
    canOperate: can(ctx.role, 'tables.operate'),
  };
}
