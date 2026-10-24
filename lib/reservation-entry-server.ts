import type { createClient } from '@/lib/supabase/server';
import { OCCUPYING_STATUSES } from '@/components/reservations/constants';
import { hasCustomKeywords, reservationKeywordsFrom, type BookedSpan, type EntryTable } from '@/lib/reservation-entry';
import { reservationTagGroupsFrom, type ReservationTagGroup } from '@/lib/reservation-tags';

/**
 * 予約登録（ハンディ・レジ共通）に使うその日のデータ（2026-10-19 Ronnie「その時間に空いているテーブル・人数にピッタリ」）。
 * 卓・その日の予約の時間と卓・店舗の既定の確保時間・キーワード・担当者（レジの担当名）・コースの所要時間。
 */
export interface ReservationEntryData {
  tables: EntryTable[];
  booked: BookedSpan[];
  defaultStay: number;
  keywords: string[];
  /** 店舗がキーワードを自分で登録したか（false＝初期値を見せている） */
  keywordsCustom: boolean;
  /** お客様・予約のタグ（区分ごと） */
  tagGroups: ReservationTagGroup[];
  clerks: { id: string; name: string }[];
  courseDurations: Record<string, number>;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 座っている（伝票が開いている）卓の状態 */
const IN_USE = new Set(['seated', 'ordering', 'billing']);

export async function loadReservationEntryData(supabase: Supabase, storeId: string, date: string): Promise<ReservationEntryData> {
  const [{ data: tableRows }, { data: floorRows }, { data: resRows }, { data: settings }, { data: clerkRows }, { data: courseRows }] =
    await Promise.all([
      supabase
        .from('restaurant_tables')
        .select('id, name, capacity_min, capacity_max, floor_id, current_status')
        .eq('store_id', storeId)
        .eq('status', 'active')
        .order('sort_order')
        .order('name'),
      supabase.from('floors').select('id, name').eq('store_id', storeId),
      supabase
        .from('reservations')
        .select('id, start_at, end_at, status, reservation_tables(table_id)')
        .eq('store_id', storeId)
        .eq('reserved_date', date)
        .in('status', OCCUPYING_STATUSES),
      supabase.from('store_settings').select('default_stay_minutes, settings').eq('store_id', storeId).maybeSingle(),
      supabase.from('pos_clerks').select('id, name').eq('store_id', storeId).eq('status', 'active').order('sort_order').order('name'),
      supabase.from('menu_items').select('id, duration_minutes').eq('item_type', 'course').eq('status', 'active').not('duration_minutes', 'is', null),
    ]);

  const floorName = new Map((floorRows ?? []).map((f) => [f.id as string, f.name as string]));
  const tables: EntryTable[] = (tableRows ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    capacityMin: Math.max(1, (t.capacity_min as number | null) ?? 1),
    capacityMax: Math.max(1, (t.capacity_max as number | null) ?? 1),
    floorName: floorName.get((t.floor_id as string | null) ?? '') ?? null,
    locked: t.current_status === 'unavailable',
    inUse: IN_USE.has(t.current_status as string),
  }));
  const booked: BookedSpan[] = (resRows ?? []).map((r) => ({
    id: r.id as string,
    start: r.start_at as string,
    end: r.end_at as string,
    tableIds: ((r.reservation_tables ?? []) as { table_id: string }[]).map((l) => l.table_id),
  }));
  const courseDurations: Record<string, number> = {};
  for (const c of courseRows ?? []) {
    if (typeof c.duration_minutes === 'number' && c.duration_minutes > 0) courseDurations[c.id as string] = c.duration_minutes;
  }
  return {
    tables,
    booked,
    defaultStay: (settings?.default_stay_minutes as number | null) ?? 120,
    keywords: reservationKeywordsFrom((settings as { settings?: unknown } | null)?.settings ?? null),
    keywordsCustom: hasCustomKeywords((settings as { settings?: unknown } | null)?.settings ?? null),
    tagGroups: reservationTagGroupsFrom((settings as { settings?: unknown } | null)?.settings ?? null),
    clerks: (clerkRows ?? []).map((c) => ({ id: c.id as string, name: c.name as string })),
    courseDurations,
  };
}
