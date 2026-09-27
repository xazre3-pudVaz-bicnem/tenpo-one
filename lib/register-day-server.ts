/**
 * レジの1営業日の流れ（サーバー側の読み込み）。計算は lib/register-day.ts。
 * migration 00087 がまだ無い DB でも画面が止まらないよう、読めなければ「比べない・続けない」に倒す。
 */

import type { createClient } from './supabase/server';
import { clockBusinessDate, nextFloatSettingFrom, openDayState, type OpenDayState } from './register-day';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface StoreDay extends OpenDayState {
  /** 時計の営業日（深夜営業の区切り時刻を引いた日付） */
  clock: string;
  /** 翌準備金の目標（店舗設定）。無ければ null＝その日の釣銭準備金 */
  nextFloatSetting: number | null;
  /** 開いているレジの数 */
  openCount: number;
}

/** この店舗のいまの営業日（開いたままのレジがあれば前日まで続ける）と、翌準備金の設定 */
export async function loadStoreDay(supabase: Supabase, storeId: string, now: Date = new Date()): Promise<StoreDay> {
  const [{ data: open }, { data: settingsRow }] = await Promise.all([
    supabase.from('register_sessions').select('business_date').eq('store_id', storeId).eq('status', 'open'),
    supabase.from('store_settings').select('business_day_start_hour, settings').eq('store_id', storeId).maybeSingle(),
  ]);
  const startHour = Number((settingsRow as { business_day_start_hour?: number } | null)?.business_day_start_hour ?? 0) || 0;
  const clock = clockBusinessDate(now, startHour);
  const dates = (open ?? []).map((r) => r.business_date as string);
  return {
    ...openDayState(dates, clock),
    clock,
    nextFloatSetting: nextFloatSettingFrom((settingsRow as { settings?: unknown } | null)?.settings ?? null),
    openCount: dates.length,
  };
}

/**
 * 開局の比べる相手：前回のレジクローズ（この店舗で一番新しい締め）で残した翌準備金。
 * 前回に記録が無い（migration 00087 より前の締め）なら null＝比べない
 */
export async function loadExpectedOpening(
  supabase: Supabase,
  storeId: string
): Promise<{ expected: number | null; closedAt: string | null; businessDate: string | null }> {
  const { data, error } = await supabase
    .from('register_sessions')
    .select('next_float, closed_at, business_date')
    .eq('store_id', storeId)
    .in('status', ['closed', 'approved'])
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return { expected: null, closedAt: null, businessDate: null };
  return {
    expected: data.next_float == null ? null : Number(data.next_float),
    closedAt: (data.closed_at as string | null) ?? null,
    businessDate: (data.business_date as string | null) ?? null,
  };
}
