import type { createClient } from '@/lib/supabase/server';
import { daysAgoJst } from '@/lib/format';
import { dailyBudgetsFrom } from '@/lib/daily-budget';
import { dailyBudgetFromMonthly } from '@/lib/home-todos';
import { SETTLED_ORDER_STATUSES } from '@/lib/metrics';
import { tableGroupsFrom } from '@/lib/table-group';
import { homeStoreRow, hourlyFromOrders, type HomeStoreRow, type HourlyCompare } from '@/lib/home-v2';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 新しい管理画面のホーム：店舗ごとの「いま」（席・未会計・本日の予約・売上・予算）と、時間帯別の売上（本日と前週の同じ曜日）。
 * RLS のかかったセッションのクライアントで読むだけ。集計は lib/home-v2.ts（純粋な関数）。
 */
export async function loadHomeV2(
  supabase: SupabaseClient,
  stores: { id: string; name: string }[],
  organizationId: string,
  today: string,
  now: number
): Promise<{ rows: HomeStoreRow[]; hourly: HourlyCompare }> {
  const ids = stores.map((s) => s.id);
  if (ids.length === 0) return { rows: [], hourly: hourlyFromOrders([], []) };
  const lastWeek = daysAgoJst(7);
  const month = today.slice(0, 7);

  const [tablesRes, openRes, settledRes, refundsRes, resvRes, budgetsRes, settingsRes, lastWeekRes] = await Promise.all([
    supabase.from('restaurant_tables').select('id, store_id').in('store_id', ids).eq('status', 'active'),
    supabase.from('orders').select('id, store_id, table_id, total, opened_at').in('store_id', ids).eq('status', 'open'),
    supabase
      .from('orders')
      .select('store_id, total, opened_at')
      .in('store_id', ids)
      .eq('business_date', today)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase.from('refunds').select('store_id, amount').in('store_id', ids).eq('business_date', today),
    supabase
      .from('reservations')
      .select('store_id, start_at, party_size, status, created_via')
      .in('store_id', ids)
      .eq('reserved_date', today)
      .not('status', 'in', '(cancelled,no_show,waitlisted)'),
    supabase
      .from('budgets')
      .select('store_id, sales_budget')
      .eq('organization_id', organizationId)
      .eq('month', `${month}-01`)
      .in('store_id', ids),
    supabase.from('store_settings').select('store_id, settings').in('store_id', ids),
    supabase
      .from('orders')
      .select('total, opened_at')
      .in('store_id', ids)
      .eq('business_date', lastWeek)
      .in('status', SETTLED_ORDER_STATUSES),
  ]);

  const settingsByStore = new Map((settingsRes.data ?? []).map((r) => [r.store_id as string, r.settings as unknown]));
  const rows = stores.map((s) => {
    const settings = settingsByStore.get(s.id);
    const monthly = (budgetsRes.data ?? []).find((b) => b.store_id === s.id)?.sales_budget ?? null;
    const daily = dailyBudgetsFrom(settings, month)[today];
    return homeStoreRow({
      store: s,
      tableIds: (tablesRes.data ?? []).filter((t) => t.store_id === s.id).map((t) => t.id as string),
      openOrders: (openRes.data ?? [])
        .filter((o) => o.store_id === s.id)
        .map((o) => ({ tableId: (o.table_id as string | null) ?? null, total: Number(o.total ?? 0) })),
      settledTotal: (settledRes.data ?? []).filter((o) => o.store_id === s.id).reduce((a, o) => a + Number(o.total ?? 0), 0),
      refundTotal: (refundsRes.data ?? []).filter((r) => r.store_id === s.id).reduce((a, r) => a + Number(r.amount ?? 0), 0),
      reservations: (resvRes.data ?? [])
        .filter((r) => r.store_id === s.id && r.created_via !== 'walk_in')
        .map((r) => ({ startAt: r.start_at as string, partySize: r.party_size as number, status: r.status as string })),
      groups: tableGroupsFrom(settings),
      dailyBudget: daily != null && daily > 0 ? daily : dailyBudgetFromMonthly(monthly, today),
      now,
    });
  });

  // 時間帯別（本日は会計済み＋未会計、前週の同じ曜日は会計済み。どちらも伝票を開いた時刻で数える）
  const todayOrders = [
    ...(settledRes.data ?? []).map((o) => ({ total: Number(o.total ?? 0), openedAt: o.opened_at as string })),
    ...(openRes.data ?? []).map((o) => ({ total: Number(o.total ?? 0), openedAt: o.opened_at as string })),
  ];
  const lastWeekOrders = (lastWeekRes.data ?? []).map((o) => ({ total: Number(o.total ?? 0), openedAt: o.opened_at as string }));
  return { rows, hourly: hourlyFromOrders(todayOrders, lastWeekOrders) };
}
