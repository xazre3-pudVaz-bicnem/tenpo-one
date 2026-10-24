import type { createClient } from '@/lib/supabase/server';
import { computeSalesMetrics, SETTLED_ORDER_STATUSES, type RefundLike, type SalesMetricsOptions, type SettledOrderLike } from '@/lib/metrics';
import { dateSequence } from '@/components/reports/period';
import { dailyBudgetFromMonthly } from '@/lib/home-todos';
import { hourlyFromOrders, type HourlyCompare } from '@/lib/home-v2';
import { METHOD_LABELS } from '@/components/cash/labels';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { achievementPct, budgetForRange, repeatWithin, turnoverPerDay, type DateRange, type HomeCard } from '@/lib/home-period';

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
  customer_id?: string | null;
}

export interface PaymentShare {
  method: string;
  label: string;
  amount: number;
  /** 金額の割合（%・整数） */
  pct: number;
}

export interface BestSeller {
  name: string;
  quantity: number;
  sales: number;
}

export interface HomeExtras {
  /** 席数（有効な卓の capacity_max の合計） */
  seats: number;
  days: number;
  /** 客席回転率（1日平均）。席が無ければ null */
  turnover: number | null;
  /** 期間の中で 2 回以上会計した顧客の割合（本日は HomeV2 側で「初回来店が前」の見方に差し替える） */
  repeat: { repeaters: number; newcomers: number; ratePct: number | null };
  /** 支払い方法（card=pay のときだけ） */
  payments: PaymentShare[] | null;
  /** ベストセラー（card=best のときだけ。数量の多い順 10 品） */
  best: BestSeller[] | null;
  /** 明細が多すぎて最初の分だけで数えたとき true */
  bestTruncated: boolean;
}

const BEST_PAGE = 1000;
const BEST_MAX_PAGES = 20;

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
  /** 下のカードのタブ。支払い方法・ベストセラーはそのタブのときだけ読む */
  card?: HomeCard;
}): Promise<{ current: PeriodKpi; previous: PeriodKpi; rows: PeriodStoreRow[]; hourly: HourlyCompare; extras: HomeExtras }> {
  const { supabase, stores, range, compare, today, metricsOpts } = input;
  const card: HomeCard = input.card ?? 'hourly';
  const ids = stores.map((s) => s.id);
  const empty: PeriodKpi = { sales: 0, settled: 0, open: 0, guests: 0, groups: 0, avgSpend: 0, budget: null, achievementPct: null };
  const days = dateSequence(range.from, range.to).length;
  const emptyExtras: HomeExtras = { seats: 0, days, turnover: null, repeat: { repeaters: 0, newcomers: 0, ratePct: null }, payments: null, best: null, bestTruncated: false };
  if (ids.length === 0) return { current: empty, previous: empty, rows: [], hourly: hourlyFromOrders([], []), extras: emptyExtras };

  const includesToday = range.from <= today && today <= range.to;
  const months = [...new Set([...monthsOf(range), ...monthsOf(compare)])];
  const SELECT = 'store_id, total, guest_count, status, order_type, opened_at, customer_id';
  const PREV_SELECT = 'store_id, total, guest_count, status, order_type, opened_at';

  // 月・年は 1,000 行を超えるので、売上まわりは 1,000 行ずつ全部読む（lib/supabase/fetch-all.ts）
  const ordersIn = (select: string, r: DateRange) =>
    fetchAll<OrderRow>((a, b) =>
      supabase.from('orders').select(select).in('store_id', ids).gte('business_date', r.from).lte('business_date', r.to).in('status', SETTLED_ORDER_STATUSES).order('id').range(a, b)
    );
  const refundsIn = (r: DateRange) =>
    fetchAll<RefundRow>((a, b) => supabase.from('refunds').select('store_id, amount, kind').in('store_id', ids).gte('business_date', r.from).lte('business_date', r.to).order('id').range(a, b));

  const [curOrders, curRefunds, prevOrders, prevRefunds, openOrders, budgets, settings, tables, payments, bestRaw] = await Promise.all([
    ordersIn(SELECT, range),
    refundsIn(range),
    ordersIn(PREV_SELECT, compare),
    refundsIn(compare),
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
    supabase.from('restaurant_tables').select('capacity_max').in('store_id', ids).eq('status', 'active'),
    card === 'pay'
      ? fetchAll<{ method: string; amount: number | null }>((a, b) =>
          supabase
            .from('payments')
            .select('method, amount')
            .in('store_id', ids)
            .gte('business_date', range.from)
            .lte('business_date', range.to)
            .eq('status', 'completed')
            .order('id')
            .range(a, b)
        )
      : Promise.resolve(null),
    card === 'best' ? loadBestSellerRows(supabase, ids, range) : Promise.resolve(null),
  ]);

  const cur = curOrders.rows;
  const prev = prevOrders.rows;
  const curRef = curRefunds.rows;
  const prevRef = prevRefunds.rows;
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

  // ---- 回転率・リピート・支払い方法・ベストセラー ----
  const seats = (tables.data ?? []).reduce((a, t) => a + Number((t as { capacity_max: number | null }).capacity_max ?? 0), 0);
  const repeat = repeatWithin(cur.map((o) => o.customer_id));
  let paymentShares: PaymentShare[] | null = null;
  if (payments) {
    const byMethod = new Map<string, number>();
    for (const p of payments.rows) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount ?? 0));
    const total = [...byMethod.values()].reduce((a, v) => a + v, 0);
    paymentShares = [...byMethod.entries()]
      .map(([method, amount]) => ({ method, label: METHOD_LABELS[method] ?? method, amount, pct: total > 0 ? Math.round((amount / total) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }
  let best: BestSeller[] | null = null;
  let bestTruncated = false;
  if (bestRaw) {
    const byName = new Map<string, BestSeller>();
    for (const r of bestRaw.rows) {
      const cur0 = byName.get(r.name) ?? { name: r.name, quantity: 0, sales: 0 };
      cur0.quantity += r.quantity;
      cur0.sales += r.sales;
      byName.set(r.name, cur0);
    }
    best = [...byName.values()].sort((a, b) => b.quantity - a.quantity || b.sales - a.sales).slice(0, 10);
    bestTruncated = bestRaw.truncated;
  }
  const extras: HomeExtras = { seats, days, turnover: turnoverPerDay(curKpi.guests, seats, days), repeat, payments: paymentShares, best, bestTruncated };

  return {
    current: { ...curKpi, budget: curBudget, achievementPct: achievementPct(curKpi.sales, curBudget) },
    previous: { ...prevKpi, budget: prevBudget, achievementPct: achievementPct(prevKpi.sales, prevBudget) },
    rows,
    hourly,
    extras,
  };
}

/** ベストセラー用の明細（会計済み paid の注文の明細）。1,000 行ずつ、最大 20 ページ（2 万明細） */
async function loadBestSellerRows(
  supabase: SupabaseClient,
  ids: string[],
  range: DateRange
): Promise<{ rows: { name: string; quantity: number; sales: number }[]; truncated: boolean }> {
  type Row = { name: string | null; quantity: number | null; line_total: number | null; menu_items: { name: string | null } | null };
  const { rows: list, truncated } = await fetchAll<Row>(
    (a, b) =>
      supabase
        .from('order_items')
        .select('name, quantity, line_total, menu_items(name), orders!inner(status, business_date)')
        .in('store_id', ids)
        .eq('status', 'active')
        .eq('orders.status', 'paid')
        .gte('orders.business_date', range.from)
        .lte('orders.business_date', range.to)
        .order('id')
        .range(a, b),
    { pageSize: BEST_PAGE, maxPages: BEST_MAX_PAGES }
  );
  const rows: { name: string; quantity: number; sales: number }[] = [];
  for (const r of list) {
    const name = (r.menu_items?.name ?? r.name ?? '').trim();
    if (!name) continue;
    rows.push({ name, quantity: Number(r.quantity ?? 0), sales: Number(r.line_total ?? 0) });
  }
  return { rows, truncated };
}
