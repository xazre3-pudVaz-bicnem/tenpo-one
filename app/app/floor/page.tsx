import { floorBoardFrom } from '@/lib/floor-nav';
import type { Metadata } from 'next';
import { requireFeature } from '@/lib/auth';
import { storeAccessBlock } from '@/components/pos/store-access-guard';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { todayJst, formatTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { CREATED_VIA_LABEL } from '@/components/reservations/constants';
import { FloorBoard } from '@/components/floor/floor-board';
import { TakeoutButton } from '@/components/floor/takeout-button';
import type {
  FloorTable,
  PanelReservation,
  TableOrderInfo,
  TableView,
  UpcomingReservation,
} from '@/components/floor/types';
import { startWalkIn, goToOrder, completeCleaning, setTableAvailability, releaseFinishedCleaning } from './actions';
import { startTakeout } from '@/app/app/pos/actions';

export const metadata: Metadata = { title: 'テーブル一覧' };

/** 描画の基準時刻（リクエスト時点）。クライアントの時計のハイドレーション初期値にも使う */
function requestTime() {
  return Date.now();
}

function jstDate(iso: string) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

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
  if (!r || r.created_via === 'walk_in') return '直接来店';
  const src = one(r.reservation_sources);
  return src?.name ?? CREATED_VIA_LABEL[r.created_via] ?? r.created_via;
}

function courseLabel(c: { course_includes_drinks: boolean | null; course_includes_ayce: boolean | null }) {
  if (c.course_includes_ayce && c.course_includes_drinks) return '食飲放';
  if (c.course_includes_ayce) return '食放';
  if (c.course_includes_drinks) return '飲放';
  return '時間制';
}

const isWalkInName = (name: string) => name === 'ウォークイン';

interface OrderRow {
  id: string;
  table_id: string | null;
  opened_at: string;
  guest_count: number;
  total: number;
  clerk_name: string | null;
  customers: One<{ name: string; visit_count: number }>;
  reservations: One<
    ReservationSource & {
      guest_name: string;
      start_at: string | null;
      end_at: string;
      menu_items: One<{
        duration_minutes: number | null;
        course_includes_drinks: boolean | null;
        course_includes_ayce: boolean | null;
      }>;
    }
  >;
}

interface ReservationRow extends ReservationSource {
  id: string;
  start_at: string;
  guest_name: string;
  party_size: number;
  status: string;
  created_at: string;
  reservation_tables: { table_id: string }[] | null;
}

export default async function FloorPage() {
  const ctx = await requireFeature('pos');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];

  const accessBlock = store ? await storeAccessBlock(store, { countDevice: false }) : null;
  if (accessBlock) return accessBlock;

  if (!store) {
    return (
      <div>
        <PageHeader title="テーブル一覧" en="Tables" />
        <EmptyState
          title="アクセス可能な店舗がありません"
          description="管理者に店舗の割り当てを依頼してください"
        />
      </div>
    );
  }

  const today = todayJst();
  const [{ data: floors }, { data: tables }, { data: settings }, { data: orderRows }, { data: reservationRows }] =
    await Promise.all([
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
          `id, table_id, opened_at, guest_count, total, clerk_name,
           customers(name, visit_count),
           reservations(guest_name, created_via, start_at, end_at, reservation_sources(name),
             menu_items(duration_minutes, course_includes_drinks, course_includes_ayce))`
        )
        .eq('store_id', store.id)
        .eq('status', 'open')
        .not('table_id', 'is', null)
        .order('opened_at'),
      supabase
        .from('reservations')
        .select(
          'id, start_at, guest_name, party_size, status, created_at, created_via, reservation_sources(name), reservation_tables(table_id)'
        )
        .eq('store_id', store.id)
        .eq('reserved_date', today)
        .in('status', PANEL_STATUSES)
        .order('start_at'),
    ]);

  const serverNow = requestTime();
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
    const courseInfo =
      course?.duration_minutes && course.duration_minutes > 0
        ? { label: courseLabel(course), minutes: course.duration_minutes }
        : null;
    // 予約の開始が伝票の開始と同じ（ウォークイン・レジの「席の時間」で直した伝票）なら、予約の終了予定をそのまま使う。
    // それ以外（予約客が遅れて来た等）は今まで通り: コースの所要時間 → 予約の終了予定 → 店舗の既定滞在時間。
    const resvStartMs = resv?.start_at ? new Date(resv.start_at).getTime() : NaN;
    const resvEndMs = resv ? new Date(resv.end_at).getTime() : NaN;
    const seatTimeSet =
      Number.isFinite(resvStartMs) && Math.abs(resvStartMs - openedAtMs) < 60_000 && resvEndMs > openedAtMs;
    const endAtMs = seatTimeSet
      ? resvEndMs
      : courseInfo
        ? openedAtMs + courseInfo.minutes * 60_000
        : resv && resvEndMs > openedAtMs
          ? resvEndMs
          : openedAtMs + stayMinutes * 60_000;
    const prev = orderByTable.get(o.table_id);
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
    });
  }

  const reservationsToday = (reservationRows ?? []) as unknown as ReservationRow[];

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

  const tableViews: TableView[] = tableRows.map((t) => ({
    ...t,
    order: orderByTable.get(t.id) ?? null,
    upcoming: upcomingByTable.get(t.id) ?? [],
  }));

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

  const canOperate = can(ctx.role, 'tables.operate');

  return (
    <div>
      {/*
        画面名（オーダー・会計）は上部バーに出ているので、ここでは見出し・説明を出さない。
        レジの設定もここには置かない（設定 > デバイス管理 から開く）。2026-09-23 要望。
      */}
      {tableViews.length === 0 ? (
        <EmptyState
          title="テーブルが登録されていません"
          description="設定画面からフロア・テーブルを登録してください"
        />
      ) : (
        <FloorBoard
          storeId={store.id}
          floors={floors ?? []}
          defaultFloorId={floorBoardFrom(settings?.settings).defaultFloorId}
          tables={tableViews}
          reservations={panel}
          serverNow={serverNow}
          canOperate={canOperate}
          startWalkInAction={startWalkIn}
          defaultStayMinutes={stayMinutes}
          goToOrderAction={goToOrder}
          completeCleaningAction={completeCleaning}
          setTableAvailabilityAction={setTableAvailability}
          releaseFinishedCleaningAction={releaseFinishedCleaning}
          topSlot={
            <div className="flex flex-wrap items-center gap-3">
              <Legend />
              {/* 持ち帰りはテーブルを使わないので、テーブル一覧からそのまま始められるようにする */}
              {canOperate && <TakeoutButton startTakeoutAction={startTakeout} />}
            </div>
          }
        />
      )}
    </div>
  );
}

const LEGEND = [
  { label: '着席中', dot: 'bg-iris-soft border border-wisteria' },
  { label: '注文済', dot: 'bg-iris' },
  { label: 'L.O.済', dot: 'bg-[#F7C948]' },
  { label: '時間超過', dot: 'bg-danger' },
  { label: '会計待ち', dot: 'bg-saffron' },
  { label: '空席', dot: 'bg-wisteria' },
];

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-xs font-medium text-ink-2">
      {LEGEND.map((l) => (
        <span key={l.label} className="inline-flex items-center">
          <i className={`mr-[5px] inline-block h-[9px] w-[9px] rounded-full ${l.dot}`} aria-hidden />
          {l.label}
        </span>
      ))}
      <span className="text-ink-3">下の線＝残り時間</span>
    </div>
  );
}
