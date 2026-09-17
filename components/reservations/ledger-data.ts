/**
 * 店舗台帳（予約）画面の共通データ取得（サーバー専用）。
 * タブ上部の操作ボタン（予約登録・直接来店・空席検索）と集計タイルに必要な値をまとめて取得する。
 * セッションの supabase クライアント（RLS適用）で読み取りのみ行う。
 */
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import type { SessionContext, StoreRef } from '@/lib/auth';
import type { Role } from '@/lib/permissions';
import type { ReservationStatus } from '@/lib/reservations';
import type { TableOption } from './walk-in-dialog';
import type { ReservationSourceOption, ReservationCourseOption, ReservationTableOption } from './manual-reservation-dialog';
import type { FindSeatsTable } from './find-seats-dialog';

type LedgerCtx = SessionContext & { organizationId: string; role: Role };

export interface LedgerSummary {
  /** 有効な予約（キャンセル・無断・キャンセル待ちを除く） */
  count: number;
  guests: number;
  cancelled: number;
  sameDayCount: number;
  sameDayGuests: number;
  inCount: number;
  outCount: number;
  waitingCount: number;
  unconfirmed: number;
  unseated: number;
}

export interface LedgerChrome {
  stores: StoreRef[];
  defaultStoreId: string | null;
  storeId: string;
  sources: ReservationSourceOption[];
  courses: ReservationCourseOption[];
  manualTables: ReservationTableOption[];
  storeTables: Record<string, TableOption[]>;
  seatTables: FindSeatsTable[];
  summary: LedgerSummary;
  /** 集計の対象日 */
  summaryDate: string;
  /** サーバー描画時刻（JST HH:MM） */
  updatedAt: string;
  /** サーバー描画時刻（ms）。クライアントの時計の初期値に使う */
  nowMs: number;
  today: string;
  links: { tables: boolean; customers: boolean; analytics: boolean; settings: boolean };
}

const IN_STATUSES: ReservationStatus[] = ['arrived', 'seated', 'billing'];
const WAIT_STATUSES: ReservationStatus[] = ['pending', 'confirmed', 'waiting'];
const CANCEL_STATUSES: ReservationStatus[] = ['cancelled', 'no_show'];

/** 現在時刻（サーバー）。描画関数の外で読むためのヘルパー */
export function serverNow(): { ms: number; today: string; hm: string } {
  const d = new Date();
  return {
    ms: d.getTime(),
    today: d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
    hm: d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }),
  };
}

function jstDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export async function loadLedgerChrome(ctx: LedgerCtx, store: StoreRef, summaryDate?: string): Promise<LedgerChrome> {
  const now = serverNow();
  const date = summaryDate ?? now.today;
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
  const supabase = await createClient();

  const [{ data: sources }, { data: courseRows }, { data: tablesData }, { data: dayRows }] = await Promise.all([
    supabase
      .from('reservation_sources')
      .select('id, code, name')
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
    supabase
      .from('restaurant_tables')
      .select('id, name, capacity_min, capacity_max, store_id')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .order('sort_order'),
    supabase
      .from('reservations')
      .select('status, party_size, created_at, created_via, reservation_tables(table_id)')
      .eq('store_id', store.id)
      .eq('reserved_date', date),
  ]);

  const storeTables: Record<string, TableOption[]> = {};
  const seatTables: FindSeatsTable[] = [];
  for (const t of tablesData ?? []) {
    (storeTables[t.store_id] ??= []).push({ id: t.id, name: t.name, capacityMax: t.capacity_max });
    if (t.store_id === store.id) {
      seatTables.push({ id: t.id, name: t.name, capacityMin: t.capacity_min, capacityMax: t.capacity_max });
    }
  }

  const dialogStoreId = ctx.currentStore?.id ?? ctx.stores[0]?.id ?? '';

  const summary: LedgerSummary = {
    count: 0,
    guests: 0,
    cancelled: 0,
    sameDayCount: 0,
    sameDayGuests: 0,
    inCount: 0,
    outCount: 0,
    waitingCount: 0,
    unconfirmed: 0,
    unseated: 0,
  };
  for (const r of dayRows ?? []) {
    const status = r.status as ReservationStatus;
    if (CANCEL_STATUSES.includes(status)) {
      summary.cancelled++;
      continue;
    }
    if (status === 'waitlisted') continue;
    summary.count++;
    summary.guests += r.party_size;
    if (r.created_via !== 'walk_in' && jstDateOf(r.created_at) === date) {
      summary.sameDayCount++;
      summary.sameDayGuests += r.party_size;
    }
    if (IN_STATUSES.includes(status)) summary.inCount++;
    else if (status === 'completed') summary.outCount++;
    else if (WAIT_STATUSES.includes(status)) {
      summary.waitingCount++;
      if (status === 'pending') summary.unconfirmed++;
      if (((r.reservation_tables ?? []) as { table_id: string }[]).length === 0) summary.unseated++;
    }
  }

  return {
    stores: ctx.stores,
    defaultStoreId: ctx.currentStore?.id ?? null,
    storeId: store.id,
    sources: (sources ?? [])
      .filter((s) => s.code !== 'web' && s.code !== 'walk_in') // web/ウォークインは自動付与のため手動選択から除外
      .map((s) => ({ code: s.code as string, name: s.name as string })),
    courses: (courseRows ?? [])
      .filter((c) => c.store_id == null || c.store_id === dialogStoreId)
      .map((c) => ({ id: c.id as string, name: c.name as string })),
    manualTables: (storeTables[dialogStoreId] ?? []).map((t) => ({ id: t.id, name: t.name })),
    storeTables,
    seatTables,
    summary,
    summaryDate: date,
    updatedAt: now.hm,
    nowMs: now.ms,
    today: now.today,
    links: {
      tables: !ctx.disabledFeatures.has('pos'),
      customers: can(ctx.role, 'customers.view') && !ctx.disabledFeatures.has('crm'),
      analytics: can(ctx.role, 'reports.view') && !ctx.disabledFeatures.has('reports'),
      settings: can(ctx.role, 'store.settings'),
    },
  };
}
