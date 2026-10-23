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
  /** 上のボタンの出し分け（Web の LedgerTop と同じ）：退店管理／集計／顧客台帳／台帳設定 */
  links: { tables: boolean; customers: boolean; analytics: boolean; settings: boolean };
  /** 未連絡（仮予約）の数 */
  unconfirmed: number;
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
    links: chrome.links,
    unconfirmed: chrome.summary.unconfirmed,
  };
}

/** 週間（GET ?part=ledgerWeek&date=…）。Web の店舗台帳 view=week と同じ集計（日ごと・1時間ごとの組数・名数、満席率、貸切） */
export interface NativeLedgerWeekPayload {
  today: string;
  date: string;
  weekDates: string[];
  bandLabels: string[];
  days: { date: string; count: number; guests: number; occupancy: number | null; hasPrivate: boolean }[];
  /** `${date}|${bandIdx}` → 組数・名数 */
  cells: { date: string; band: number; count: number; guests: number }[];
  maxCell: number;
  weekCount: number;
  weekGuests: number;
}

function shiftDateStr(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function jstMinutesOfIso(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

export async function loadNativeLedgerWeek(supabase: Supabase, store: { id: string }, requestedDate: string | null, today: string): Promise<NativeLedgerWeekPayload> {
  const date = requestedDate ?? today;
  const weekStart = shiftDateStr(date, -dowOfDateStr(date));
  const weekDates = Array.from({ length: 7 }, (_, i) => shiftDateStr(weekStart, i));
  const [{ data: hours }, { data: tables }, { data: weekData }] = await Promise.all([
    supabase.from('business_hours').select('day_of_week, is_closed, open_time, close_time').eq('store_id', store.id),
    supabase.from('restaurant_tables').select('capacity_max').eq('store_id', store.id).eq('status', 'active'),
    supabase
      .from('reservations')
      .select('reserved_date, start_at, party_size, is_private_hire')
      .eq('store_id', store.id)
      .in('reserved_date', weekDates)
      .in('status', ACTIVE_TIMELINE_STATUSES),
  ]);
  let min = Infinity;
  let max = -Infinity;
  for (const r of hours ?? []) {
    if (r.is_closed) continue;
    const o = parseTimeToMinutes(r.open_time as string | null);
    const c = parseTimeToMinutes(r.close_time as string | null);
    if (o == null || c == null) continue;
    min = Math.min(min, o);
    max = Math.max(max, c > o ? c : c + 24 * 60);
  }
  const startMin = Number.isFinite(min) ? min : DEFAULT_START_MIN;
  const endMin = Number.isFinite(max) ? max : DEFAULT_END_MIN;
  const bandStart = Math.floor(startMin / 60) * 60;
  const bandEnd = Math.max(bandStart + 60, Math.ceil(endMin / 60) * 60);
  const bandCount = (bandEnd - bandStart) / 60;
  const bandLabels = Array.from({ length: bandCount }, (_, i) => `${String(Math.floor((bandStart + i * 60) / 60) % 24).padStart(2, '0')}:00`);
  const totalCapacity = (tables ?? []).reduce((s, t) => s + Number(t.capacity_max ?? 0), 0);

  const dayAgg = new Map<string, { count: number; guests: number; hasPrivate: boolean }>();
  for (const d of weekDates) dayAgg.set(d, { count: 0, guests: 0, hasPrivate: false });
  const cellAgg = new Map<string, { count: number; guests: number }>();
  let maxCell = 0;
  for (const r of weekData ?? []) {
    const agg = dayAgg.get(r.reserved_date as string);
    if (agg) {
      agg.count += 1;
      agg.guests += Number(r.party_size);
      if (r.is_private_hire) agg.hasPrivate = true;
    }
    const startM = jstMinutesOfIso(r.start_at as string);
    const bandIdx = Math.floor((startM - bandStart) / 60);
    if (bandIdx >= 0 && bandIdx < bandCount) {
      const key = `${r.reserved_date}|${bandIdx}`;
      const cur = cellAgg.get(key) ?? { count: 0, guests: 0 };
      cur.count += 1;
      cur.guests += Number(r.party_size);
      cellAgg.set(key, cur);
      maxCell = Math.max(maxCell, cur.guests);
    }
  }
  const rows = weekData ?? [];
  return {
    today,
    date,
    weekDates,
    bandLabels,
    days: weekDates.map((d) => {
      const a = dayAgg.get(d)!;
      return { date: d, count: a.count, guests: a.guests, occupancy: totalCapacity > 0 ? Math.min(100, Math.round((a.guests / totalCapacity) * 100)) : null, hasPrivate: a.hasPrivate };
    }),
    cells: [...cellAgg.entries()].map(([k, v]) => {
      const [d, b] = k.split('|');
      return { date: d, band: Number(b), count: v.count, guests: v.guests };
    }),
    maxCell,
    weekCount: rows.length,
    weekGuests: rows.reduce((s, r) => s + Number(r.party_size), 0),
  };
}
