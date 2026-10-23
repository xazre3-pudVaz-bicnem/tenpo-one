import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import type { Role } from '@/lib/permissions';
import { can } from '@/lib/permissions';
import { loadLedgerChrome, type LedgerSummary } from '@/components/reservations/ledger-data';
import { ACTIVE_TIMELINE_STATUSES, BOARD_SLOT } from '@/components/reservations/constants';
import { RESERVATION_ROW_SELECT, mapReservationRow, type RawReservationRow } from '@/components/reservations/row-mapper';
import type { ReservationListRow } from '@/components/reservations/list-types';
import { loadReservationTags } from '@/lib/reservation-tags-server';
import { reservationClerkOptions } from '@/lib/reservation-clerks-server';
import { RESERVATION_STATUS, RESERVATION_TRANSITIONS, type ReservationStatus } from '@/lib/reservations';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * iPad アプリのネイティブの店舗台帳（1日のスケジュール）に返すもの（GET /api/app/v1/pos?part=ledger&date=…）。
 * 中身は Web の店舗台帳（app/app/reservations/page.tsx の view=day）と同じ組み立て（2026-10-24 Ronnie「店舗台帳もネイティブ」）
 */
export interface NativeLedgerPayload {
  store: { id: string; name: string };
  date: string;
  today: string;
  isToday: boolean;
  nowMs: number;
  /** 表示の時間帯（分。30分のマスに合わせてある） */
  viewStartMin: number;
  viewEndMin: number;
  openMin: number;
  closeMin: number;
  isClosedDay: boolean;
  bufferMinutes: number;
  slotMinutes: number;
  tables: { id: string; name: string; capacityMin: number; capacityMax: number; statusLabel: string }[];
  reservations: ReservationListRow[];
  summary: LedgerSummary;
  sources: { code: string; name: string }[];
  /** 予約経路（reservation_sources.id。予約の経路を直すとき） */
  sourceRows: { id: string; code: string; name: string }[];
  courses: { id: string; name: string }[];
  staffOptions: { id: string; name: string }[];
  statusLabels: Record<string, string>;
  transitions: Record<string, string[]>;
  canWrite: boolean;
}

const DEFAULT_START_MIN = 11 * 60;
const DEFAULT_END_MIN = 23 * 60;

const TABLE_STATUS_LABEL: Record<string, string> = {
  available: '空席',
  reserved: '予約あり',
  waiting: 'キャンセル待ち',
  seated: '着席中',
  ordering: '注文中',
  billing: '会計中',
  cleaning: '清掃中',
  unavailable: '利用停止',
};

function dowOfDateStr(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function parseTimeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export async function loadNativeLedger(
  ctx: SessionContext,
  supabase: Supabase,
  store: { id: string; name: string; slug: string },
  requestedDate: string | null
): Promise<NativeLedgerPayload> {
  const chrome = await loadLedgerChrome(ctx as SessionContext & { organizationId: string; role: Role }, store, requestedDate ?? undefined);
  const today = chrome.today;
  const date = requestedDate ?? today;

  const [{ data: tablesData }, { data: businessHoursData }, clerksByStore, { data: bookingSettings }, { data: sourceRows }] = await Promise.all([
    supabase
      .from('restaurant_tables')
      .select('id, name, capacity_min, capacity_max, current_status')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .order('sort_order'),
    supabase.from('business_hours').select('day_of_week, is_closed, open_time, close_time').eq('store_id', store.id),
    reservationClerkOptions(supabase, [store.id]),
    supabase.from('store_settings').select('cleaning_buffer_minutes').eq('store_id', store.id).maybeSingle(),
    supabase
      .from('reservation_sources')
      .select('id, code, name')
      .or(`organization_id.is.null,organization_id.eq.${ctx.organizationId}`)
      .eq('status', 'active')
      .order('sort_order'),
  ]);

  const dow = dowOfDateStr(date);
  const bh = (businessHoursData ?? []).find((b) => b.day_of_week === dow) as
    | { day_of_week: number; is_closed: boolean; open_time: string | null; close_time: string | null }
    | undefined;
  let openMin = DEFAULT_START_MIN;
  let closeMin = DEFAULT_END_MIN;
  if (bh && !bh.is_closed) {
    const o = parseTimeToMinutes(bh.open_time);
    const c = parseTimeToMinutes(bh.close_time);
    if (o != null && c != null) {
      openMin = o;
      closeMin = c > o ? c : c + 24 * 60;
    }
  }
  const viewStartMin = Math.max(0, Math.floor(openMin / BOARD_SLOT) * BOARD_SLOT);
  const viewEndMin = Math.min(30 * 60, Math.ceil(closeMin / BOARD_SLOT) * BOARD_SLOT);
  const isClosedDay = !!bh?.is_closed;
  if (isClosedDay) {
    openMin = viewEndMin;
    closeMin = viewEndMin;
  }

  const { data: reservationsData } = await supabase
    .from('reservations')
    .select(RESERVATION_ROW_SELECT)
    .eq('store_id', store.id)
    .eq('reserved_date', date)
    .in('status', ACTIVE_TIMELINE_STATUSES)
    .order('start_at');
  const raw = (reservationsData ?? []) as unknown as RawReservationRow[];
  const tagsById = await loadReservationTags(supabase, raw.map((r) => r.id));
  const reservations = raw.map((r) => ({ ...mapReservationRow(r, null), tags: tagsById.get(r.id) ?? [] }));
  const isToday = date === today;

  const tables = (tablesData ?? []).map((t) => {
    let statusLabel = '';
    if (isToday) {
      const onTable = reservations.filter((r) => r.tableIds.includes(t.id as string));
      const seated = onTable.find((r) => r.status === 'seated' || r.status === 'arrived');
      const billing = onTable.find((r) => r.status === 'billing');
      if (billing) statusLabel = '会計待ち';
      else if (seated) statusLabel = `着席中 ${seated.partySize}名 ・ ${seated.guestName} 様`;
      else statusLabel = TABLE_STATUS_LABEL[t.current_status as string] ?? '';
    }
    return { id: t.id as string, name: t.name as string, capacityMin: t.capacity_min as number, capacityMax: t.capacity_max as number, statusLabel };
  });

  const statusLabels: Record<string, string> = {};
  for (const k of Object.keys(RESERVATION_STATUS) as ReservationStatus[]) statusLabels[k] = RESERVATION_STATUS[k].label;

  return {
    store: { id: store.id, name: store.name },
    date,
    today,
    isToday,
    nowMs: chrome.nowMs,
    viewStartMin,
    viewEndMin,
    openMin,
    closeMin,
    isClosedDay,
    bufferMinutes: bookingSettings?.cleaning_buffer_minutes ?? 0,
    slotMinutes: BOARD_SLOT,
    tables,
    reservations,
    summary: chrome.summary,
    sources: chrome.sources,
    sourceRows: (sourceRows ?? []).map((s) => ({ id: s.id as string, code: s.code as string, name: s.name as string })),
    courses: chrome.courses,
    staffOptions: clerksByStore[store.id] ?? [],
    statusLabels,
    transitions: RESERVATION_TRANSITIONS as unknown as Record<string, string[]>,
    canWrite: can(ctx.role, 'reservations.write'),
  };
}
