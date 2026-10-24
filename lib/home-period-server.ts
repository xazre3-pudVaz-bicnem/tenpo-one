import type { createClient } from '@/lib/supabase/server';
import { computeSalesMetrics, SETTLED_ORDER_STATUSES, type RefundLike, type SalesMetricsOptions, type SettledOrderLike } from '@/lib/metrics';
import { dateSequence } from '@/components/reports/period';
import { dailyBudgetFromMonthly } from '@/lib/home-todos';
import { hourlyFromOrders, type HourlyCompare } from '@/lib/home-v2';
import { achievementPct, budgetForRange, type DateRange } from '@/lib/home-period';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface PeriodKpi {
  /** 売上（税込・純売上。本日は未会計も足す） */
  sales: number;
  settled: number;
  open: number;
  guests: number;
  /** 会計の件数 */
  groups: number;
  avgSpend: number;
  budget: number | null;
  achievementPct: number | null;
}

export interface PeriodStoreRow {
  id: string;
  name: string;
  sales: number;
  guests: number;
  groups: number;
  avgSpend: number;
  budget: number | null;
  budgetPct: number | null;
}

interface OrderRow {
  store_id: string;
  total: number | null;
  guest_count: number | null;
  status: string;
  order_type: string | null;
  opened_at: string | null;
}

interface RefundRow {
  store_id: string;
  amount: number | null;
  kind: string | null;
}

function kpiOf(orders: OrderRow[], refunds: RefundRow[], open: number, opts: SalesMetricsOptions): Omit<PeriodKpi, 'budget' | 'achievementPct'> {
  const m = computeSalesMetrics(
    orders.map((o) => ({ total: Number(o.total ?? 0), guest_count: o.guest_count ?? 0, status: o.status, order_type: o.order_type ?? undefined })) as SettledOrderLike[],
    refunds.map((r) => ({ amount: Number(r.amount ?? 0), kind: r.kind ?? undefined })) as RefundLike[],
    opts
  );
  return { sales: m.netSales + open, settled: m.netSales, open, guests: m.guests, groups: m.transactionCount, avgSpend: m.avgSpend };
}

function monthsOf(range: DateRange): string[] {
  const out = new Set<string>();
  for (const d of dateSequence(range.from, range.to)) out.add(d.slice(0, 7));
  return [...out];
}

/**
 * 新しい管理画面のホーム：選んだ期間と比較する期間の数字（2026-10-24）。
 *   - 売上・客数・会計件数・客単価は lib/metrics.ts の正式定義（会計済み＝paid/refunded、返金を引く）
 *   - 期間に今日が入るときだけ「未会計」（開いている伝票）も売上に足す（本日のホームと同じ見方）
 *   - 予算は日ごとに「日別予算 → 無ければ月予算÷日数」。全店舗で会社の月予算（store_id null）があればそれを日割り
 *   - 時間帯別は伝票を開いた時刻で、選んだ期間（棒）と比較する期間（点線）
 * RLS のかかったセッションのクライアントで読むだけ。
 */
export async function loadHomePeriod(input: {
  supabase: SupabaseClient;
  organizationId: string;
  stores: { id: string; name: string }[];
  isAllStores: boolean;
  range: DateRange;
  compare: DateRange;
  today: string;
  metricsOpts: SalesMetricsOptions;
}): Promise<{ current: PeriodKpi; previous: PeriodKpi; rows: PeriodStoreRow[]; hourly: HourlyCompare }> {
  const { supabase, stores, range, compare, today, metricsOpts } = input;
  const ids = stores.map((s) => s.id);
  const empty: PeriodKpi = { sales: 0, settled: 0, open: 0, guests: 0, groups: 0, avgSpend: 0, budget: null, achievementPct: null };
  if (ids.length === 0) return { current: empty, previous: empty, rows: [], hourly: hourlyFromOrders([], []) };

  const includesToday = range.from <= today && today <= range.to;
  const months = [...new Set([...monthsOf(range), ...monthsOf(compare)])];
  const SELECT = 'store_id, total, guest_count, status, order_type, opened_at';

  const [curOrders, curRefunds, prevOrders, prevRefunds, openOrders, budgets, settings] = await Promise.all([
    supabase.from('orders').select(SELECT).in('store_id', ids).gte('business_date', range.from).lte('business_date', range.to).in('status', SETTLED_ORDER_STATUSES),
    supabase.from('refunds').select('store_id, amount, kind').in('store_id', ids).gte('business_date', range.from).lte('business_date', range.to),
    supabase.from('orders').select(SELECT).in('store_id', ids).gte('business_date', compare.from).lte('business_date', compare.to).in('status', SETTLED_ORDER_STATUSES),
    supabase.from('refunds').select('store_id, amount, kind').in('store_id', ids).gte('business_date', compare.from).lte('business_date', compare.to),
    includesToday
      ? supabase.from('orders').select('store_id, total, opened_at').in('store_id', ids).eq('status', 'open')
      : Promise.resolve({ data: [] as { store_id: string; total: number | null; opened_at: string | null }[] }),
    supabase
      .from('budgets')
      .select('store_id, month, sales_budget')
      .eq('organization_id', input.organizationId)
      .in('month', months.map((m) => `${m}-01`))
      .or(`store_id.is.null,store_id.in.(${ids.join(',')})`),
    supabase.from('store_settings').select('store_id, settings').in('store_id', ids),
  ]);

  const cur = (curOrders.data ?? []) as OrderRow[];
  const prev = (prevOrders.data ?? []) as OrderRow[];
  const curRef = (curRefunds.data ?? []) as RefundRow[];
  const prevRef = (prevRefunds.data ?? []) as RefundRow[];
  const open = (openOrders.data ?? []) as { store_id: string; total: number | null; opened_at: string | null }[];

  // ---- 予算 ----
  const budgetRows = (budgets.data ?? []) as { store_id: string | null; month: string; sales_budget: number }[];
  const monthKey = (m: string) => m.slice(0, 7);
  const orgMonthly = new Map<string, number>();
  const storeMonthly = new Map<string, number>();
  for (const b of budgetRows) {
    if (!b.sales_budget || b.sales_budget <= 0) continue;
    if (b.store_id === null) orgMonthly.set(monthKey(b.month), b.sales_budget);
    else storeMonthly.set(`${b.store_id}|${monthKey(b.month)}`, b.sales_budget);
  }
  const settingsByStore = new Map((settings.data ?? []).map((r) => [r.store_id as string, r.settings as unknown]));
  const budgetOf = (r: DateRange, storeIds: string[], allowOrg: boolean): number | null => {
    if (allowOrg && input.isAllStores && orgMonthly.size > 0) {
      let total = 0;
      let any = false;
      for (const d of dateSequence(r.from, r.to)) {
        const v = dailyBudgetFromMonthly(orgMonthly.get(d.slice(0, 7)) ?? null, d);
        if (v != null && v > 0) {
          total += v;
          any = true;
        }
      }
      if (any) return total;
    }
    return budgetForRange({ range: r, storeIds, settingsByStore, monthlyByStoreMonth: storeMonthly });
  };

  const openTotal = open.reduce((a, o) => a + Number(o.total ?? 0), 0);
  const curKpi = kpiOf(cur, curRef, openTotal, metricsOpts);
  const prevKpi = kpiOf(prev, prevRef, 0, metricsOpts);
  const curBudget = budgetOf(range, ids, true);
  const prevBudget = budgetOf(compare, ids, true);

  const rows: PeriodStoreRow[] = stores.map((s) => {
    const k = kpiOf(
      cur.filter((o) => o.store_id === s.id),
      curRef.filter((r) => r.store_id === s.id),
      open.filter((o) => o.store_id === s.id).reduce((a, o) => a + Number(o.total ?? 0), 0),
      metricsOpts
    );
    const budget = budgetOf(range, [s.id], false);
    return { id: s.id, name: s.name, sales: k.sales, guests: k.guests, groups: k.groups, avgSpend: k.avgSpend, budget, budgetPct: achievementPct(k.sales, budget) };
  });

  const hourly = hourlyFromOrders(
    [...cur, ...open].filter((o) => o.opened_at).map((o) => ({ total: Number(o.total ?? 0), openedAt: o.opened_at as string })),
    prev.filter((o) => o.opened_at).map((o) => ({ total: Number(o.total ?? 0), openedAt: o.opened_at as string }))
  );

  return {
    current: { ...curKpi, budget: curBudget, achievementPct: achievementPct(curKpi.sales, curBudget) },
    previous: { ...prevKpi, budget: prevBudget, achievementPct: achievementPct(prevKpi.sales, prevBudget) },
    rows,
    hourly,
  };
}
