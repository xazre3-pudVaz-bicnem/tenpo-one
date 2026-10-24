import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { todayJst } from '@/lib/format';
import { monthBounds, diffDaysStr, addDaysStr } from '@/components/reports/period';
import {
  bookingForecast,
  seatOnlyUnitPrices,
  SEAT_ONLY_UNIT_DAYS,
  UPCOMING_RESERVATION_STATUSES,
  type ForecastReservation,
  type SeatOnlyUnit,
  type UnitPriceOrder,
} from '@/lib/booking-forecast';
import { linearLandingForecast } from '@/lib/forecast';
import { summarizeItemCosts, type CostableOrderItem } from '@/components/reports/cost';
import { estimateLaborCost, type TimeEntryForLabor, type PayrollRuleForLabor } from '@/components/reports/labor';
import { fetchIngredientLinesByMenuItems } from '@/components/costing/data';
import {
  computeSalesMetrics,
  SETTLED_ORDER_STATUSES,
  type RefundLike,
  type SettledOrderLike,
  type SalesMetricsOptions,
} from '@/lib/metrics';

/**
 * 予算管理（/app/budgets）の読み込みと計算。Web の画面と iPad アプリのネイティブ画面（GET ?part=budgets）で同じものを使う。
 * 中身は app/app/budgets/page.tsx にあったものをそのまま移した（2026-10-24）。店舗が無ければ null。
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export { SEAT_ONLY_UNIT_DAYS };

export async function loadBudgetsData(ctx: SessionContext, supabase: Supabase, month: string | undefined) {
  const canEdit = ['org_owner', 'hq_admin', 'area_manager', 'store_manager'].includes(ctx.role ?? '');
  const today = todayJst();
  const monthParam = /^\d{4}-\d{2}$/.test(month ?? '') ? `${month}-01` : `${today.slice(0, 7)}-01`;
  // monthBounds(0, date) は date の年月を基準に月初・月末を返す（offset=0固定で選択月自体を対象にする）
  const { first: monthFirst, last: monthLast } = monthBounds(0, monthParam);
  const toDate = today < monthLast ? today : monthLast;
  const elapsedDays = Math.max(1, diffDaysStr(monthFirst, toDate) + 1);
  const daysInMonth = diffDaysStr(monthFirst, monthLast) + 1;

  // ヘッダーの店舗選択に従う: 「全店舗」選択時（本社ロールのみ可能）は全店を対象にする
  const targetStores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  const storeIds = targetStores.map((s) => s.id);
  const showAllStoresRow = !ctx.currentStore;

  if (storeIds.length === 0) return null;

  // 客数KPI設定（organizations.kpi_settings.includeTakeoutGuests。省略時true）。lib/metrics.ts参照
  const { data: orgKpiRow } = await supabase
    .from('organizations')
    .select('kpi_settings')
    .eq('id', ctx.organizationId)
    .maybeSingle();
  const metricsOpts: SalesMetricsOptions = {
    includeTakeoutGuests: (orgKpiRow?.kpi_settings as { includeTakeoutGuests?: boolean } | null)?.includeTakeoutGuests ?? true,
  };

  const [budgetsRes, ordersRes, refundsRes, orderItemsRes, timeEntriesRes, payrollRulesRes, expensesRes] = await Promise.all([
    supabase
      .from('budgets')
      .select('*')
      .eq('organization_id', ctx.organizationId)
      .eq('month', monthFirst)
      .or(showAllStoresRow ? `store_id.is.null,store_id.in.(${storeIds.join(',')})` : `store_id.in.(${storeIds.join(',')})`),
    supabase
      .from('orders')
      .select('total, guest_count, status, store_id, order_type')
      .in('store_id', storeIds)
      .gte('business_date', monthFirst)
      .lte('business_date', toDate)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase
      .from('refunds')
      .select('amount, kind, store_id')
      .in('store_id', storeIds)
      .gte('business_date', monthFirst)
      .lte('business_date', toDate),
    supabase
      .from('order_items')
      .select('menu_item_id, quantity, line_total, store_id, menu_items(cost), orders!inner(status, business_date)')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('orders.status', 'paid')
      .gte('orders.business_date', monthFirst)
      .lte('orders.business_date', toDate),
    supabase
      .from('time_entries')
      .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
      .in('store_id', storeIds)
      .gte('work_date', monthFirst)
      .lte('work_date', toDate),
    supabase
      .from('payroll_rules')
      .select('profile_id, store_id, pay_type, base_amount, effective_from, effective_to')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active'),
    supabase
      .from('expenses')
      .select('amount, store_id')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('approval_status', 'approved')
      .gte('business_date', monthFirst)
      .lte('business_date', toDate),
  ]);

  const budgets = budgetsRes.data ?? [];
  const budgetByStore = new Map(budgets.map((b) => [b.store_id ?? '__all__', b]));

  const orders = ordersRes.data ?? [];
  const refunds = refundsRes.data ?? [];
  const orderItems = orderItemsRes.data ?? [];
  const timeEntries = (timeEntriesRes.data ?? []) as TimeEntryForLabor[];
  const payrollRules = (payrollRulesRes.data ?? []) as PayrollRuleForLabor[];
  const expenses = expensesRes.data ?? [];

  const menuItemIds = [...new Set(orderItems.map((i) => i.menu_item_id).filter((v): v is string => !!v))];
  const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);

  interface Actual {
    sales: number;
    guests: number;
    avgSpend: number;
    cost: number;
    costRate: number;
    labor: number;
    laborRate: number;
    expense: number;
    profit: number;
  }

  function computeActual(sId: string | null): Actual {
    // 実績は lib/metrics.ts の正式定義（settled=paid+refunded・net=gross−refunds）に統一。
    // ダッシュボード・レポートと同一の関数・同一のクエリ条件（SETTLED_ORDER_STATUSES）を使う。
    const oList = sId ? orders.filter((o) => o.store_id === sId) : orders;
    const rList = sId ? refunds.filter((r) => r.store_id === sId) : refunds;
    const metrics = computeSalesMetrics(oList as SettledOrderLike[], rList as RefundLike[], metricsOpts);
    const sales = metrics.netSales;
    const guests = metrics.guests;
    const avgSpend = metrics.avgSpend;

    const iList = sId ? orderItems.filter((i) => i.store_id === sId) : orderItems;
    const costSummary = summarizeItemCosts(iList as unknown as CostableOrderItem[], linesByItem);
    const costRate = sales > 0 ? (costSummary.totalCost / sales) * 100 : 0;

    const tList = sId ? timeEntries.filter((t) => t.store_id === sId) : timeEntries;
    const laborResult = estimateLaborCost(tList, payrollRules);
    const laborRate = sales > 0 ? (laborResult.total / sales) * 100 : 0;

    const eList = sId ? expenses.filter((e) => e.store_id === sId) : expenses;
    const expenseTotal = eList.reduce((a, e) => a + e.amount, 0);

    const profit = sales - costSummary.totalCost - laborResult.total - expenseTotal;

    return { sales, guests, avgSpend, cost: costSummary.totalCost, costRate, labor: laborResult.total, laborRate, expense: expenseTotal, profit };
  }

  interface Row {
    storeId: string | null;
    storeName: string;
    budget: (typeof budgets)[number] | undefined;
    actual: Actual;
    achievementPct: number | null;
    forecast: number | null;
    forecastPct: number | null;
  }

  const rows: Row[] = [];
  if (showAllStoresRow) {
    const allActual = computeActual(null);
    const allBudget = budgetByStore.get('__all__');
    rows.push({
      storeId: null,
      storeName: '全社',
      budget: allBudget,
      actual: allActual,
      achievementPct: allBudget && allBudget.sales_budget > 0 ? (allActual.sales / allBudget.sales_budget) * 100 : null,
      forecast: linearLandingForecast(allActual.sales, elapsedDays, daysInMonth),
      forecastPct:
        allBudget && allBudget.sales_budget > 0
          ? ((linearLandingForecast(allActual.sales, elapsedDays, daysInMonth) ?? 0) / allBudget.sales_budget) * 100
          : null,
    });
  }
  for (const s of targetStores) {
    const actual = computeActual(s.id);
    const budget = budgetByStore.get(s.id);
    const forecast = linearLandingForecast(actual.sales, elapsedDays, daysInMonth);
    rows.push({
      storeId: s.id,
      storeName: s.name,
      budget,
      actual,
      achievementPct: budget && budget.sales_budget > 0 ? (actual.sales / budget.sales_budget) * 100 : null,
      forecast,
      forecastPct: budget && budget.sales_budget > 0 ? ((forecast ?? 0) / budget.sales_budget) * 100 : null,
    });
  }

  // ── 今月の売上目標（金額入力）とご予約から見込む売上（2026-09-30 Ronnie） ──
  // 対象：ヘッダーで選んだ店舗（全店舗のときは全社）
  const targetRow = rows.find((r) => r.storeId === (ctx.currentStore?.id ?? null)) ?? rows[0];
  const targetEditable =
    canEdit && (targetRow.storeId === null ? ctx.role === 'org_owner' || ctx.role === 'hq_admin' : true);
  const isThisMonth = monthFirst.slice(0, 7) === today.slice(0, 7);
  const monthLabel = isThisMonth ? '今月' : `${Number(monthFirst.slice(5, 7))}月`;

  // これからのご予約（本日〜月末。来店済み・会計済みは実績に入っているので入れない）
  const showForecast = monthLast >= today;
  const forecastFrom = today > monthFirst ? today : monthFirst;
  const unitFrom = addDaysStr(today, -SEAT_ONLY_UNIT_DAYS);
  const unitTo = addDaysStr(today, -1);
  let forecast: ReturnType<typeof bookingForecast> | null = null;
  let singleUnit: SeatOnlyUnit | null = null;
  if (showForecast) {
    const [upcomingRes, ...unitOrderResults] = await Promise.all([
      supabase
        .from('reservations')
        .select('store_id, party_size, course_id, menu_items:course_id(price)')
        .in('store_id', storeIds)
        .gte('reserved_date', forecastFrom)
        .lte('reserved_date', monthLast)
        .in('status', [...UPCOMING_RESERVATION_STATUSES])
        .neq('created_via', 'walk_in'),
      // 席のみ客単価：直近7日（昨日まで）の会計。店ごとに取る（1回の取得の上限を超えないように）
      ...storeIds.map((sid) =>
        supabase
          .from('orders')
          .select('store_id, total, guest_count, reservations(party_size, course_id)')
          .eq('store_id', sid)
          .in('status', SETTLED_ORDER_STATUSES)
          .gte('business_date', unitFrom)
          .lte('business_date', unitTo)
      ),
    ]);
    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
    const unitOrders: UnitPriceOrder[] = unitOrderResults.flatMap((res) =>
      (res.data ?? []).map((o) => {
        const rsv = one(o.reservations as { party_size: number; course_id: string | null } | { party_size: number; course_id: string | null }[] | null);
        return {
          storeId: o.store_id,
          total: Number(o.total) || 0,
          guests: (o.guest_count ?? 0) > 0 ? (o.guest_count as number) : (rsv?.party_size ?? 0),
          seatOnlyReservation: rsv ? rsv.course_id == null : null,
        };
      })
    );
    const units = seatOnlyUnitPrices(storeIds, unitOrders);
    const upcoming: ForecastReservation[] = (upcomingRes.data ?? []).map((r) => {
      const course = one(r.menu_items as { price: number } | { price: number }[] | null);
      return {
        storeId: r.store_id,
        partySize: r.party_size,
        coursePrice: r.course_id ? (course?.price ?? null) : null,
      };
    });
    forecast = bookingForecast(upcoming, units);
    singleUnit = storeIds.length === 1 ? (units.get(storeIds[0]) ?? null) : null;
  }
  const landing = forecast ? targetRow.actual.sales + forecast.total : null;
  const targetAmount = targetRow.budget?.sales_budget ?? null;


  const rowEditable = (storeId: string | null) => canEdit && (storeId === null ? ctx.role === 'org_owner' || ctx.role === 'hq_admin' : true);

  return {
    canEdit,
    today,
    monthFirst,
    monthLast,
    elapsedDays,
    daysInMonth,
    rows,
    targetRow,
    targetEditable,
    isThisMonth,
    monthLabel,
    forecastFrom,
    forecast,
    singleUnit,
    landing,
    targetAmount,
    metricsOpts,
    rowEditable,
  };
}

export type BudgetsData = NonNullable<Awaited<ReturnType<typeof loadBudgetsData>>>;
