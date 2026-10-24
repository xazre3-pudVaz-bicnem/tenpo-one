import type { SupabaseClient } from '@supabase/supabase-js';
import { todayJst } from '@/lib/format';
import { SETTLED_ORDER_STATUSES } from '@/lib/metrics';
import { dailyBudgetsFrom, monthDays, shiftMonth, WEEKDAY_WEIGHT_DAYS } from '@/lib/daily-budget';
import { addDaysStr, buildAutoBudget, type AutoBudget, type DailySales } from '@/lib/budget-auto';
import { getStoreForecast } from '@/lib/weather';

/**
 * iPad アプリのネイティブの日別予算登録（GET /api/app/v1/pos?part=budgetDaily / part=budgetAuto）。
 *   budgetDaily … その月の日別予算と「今月の売上目標」（budgets.sales_budget）
 *   budgetAuto  … 履歴（曜日・去年の同じ月・天気予報）から日別予算の案を作る（2026-10-24 Ronnie「日・月・天気で自動予算」）
 */
export interface NativeBudgetDailyPayload {
  store: { id: string; name: string };
  month: string;
  values: Record<string, number>;
  canEdit: boolean;
  /** 今月の売上目標（budgets.sales_budget）。未設定は null */
  target: number | null;
}

export async function loadNativeBudgetDaily(
  supabase: SupabaseClient,
  organizationId: string,
  store: { id: string; name: string },
  month: string,
  canEdit: boolean
): Promise<NativeBudgetDailyPayload> {
  const [{ data: row }, { data: budget }] = await Promise.all([
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
    supabase.from('budgets').select('sales_budget').eq('organization_id', organizationId).eq('store_id', store.id).eq('month', `${month}-01`).maybeSingle(),
  ]);
  const target = budget?.sales_budget != null ? Number(budget.sales_budget) : null;
  return {
    store: { id: store.id, name: store.name },
    month,
    values: dailyBudgetsFrom(row?.settings, month),
    canEdit,
    target: target != null && Number.isFinite(target) && target > 0 ? Math.round(target) : null,
  };
}

/** 期間の日ごとの売上（会計済みの伝票の合計。1000行ずつ読む） */
async function salesByDate(supabase: SupabaseClient, storeId: string, from: string, to: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (from > to) return map;
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await supabase
      .from('orders')
      .select('business_date, total')
      .eq('store_id', storeId)
      .in('status', SETTLED_ORDER_STATUSES)
      .gte('business_date', from)
      .lte('business_date', to)
      .order('business_date')
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    for (const o of data ?? []) map.set(o.business_date, (map.get(o.business_date) ?? 0) + Number(o.total ?? 0));
    if ((data ?? []).length < 1000) break;
  }
  return map;
}

export async function loadNativeBudgetAuto(supabase: SupabaseClient, store: { id: string; address: string | null }, month: string): Promise<AutoBudget> {
  const today = todayJst();
  // 曜日：直近8週（昨日まで）。月：去年の同じ月と、その前の8週
  const lyDays = monthDays(shiftMonth(month, -12));
  const [recent, lastYear, forecast] = await Promise.all([
    salesByDate(supabase, store.id, addDaysStr(today, -WEEKDAY_WEIGHT_DAYS), addDaysStr(today, -1)),
    lyDays.length > 0 ? salesByDate(supabase, store.id, addDaysStr(lyDays[0], -WEEKDAY_WEIGHT_DAYS), lyDays[lyDays.length - 1]) : Promise.resolve(new Map<string, number>()),
    getStoreForecast(store.address),
  ]);
  const daily: DailySales[] = [...lastYear, ...recent].map(([date, sales]) => ({ date, sales }));
  return buildAutoBudget({ month, today, daily, forecast });
}
