import type { SessionContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { yen, todayJst, daysAgoJst, formatTime, weekdayJa } from '@/lib/format';
import { METHOD_LABELS } from '@/components/cash/labels';
import type { PeriodPreset } from '@/components/reports/period-links';
import type { PlStep } from '@/components/reports/pl-cascade';
import {
  addDaysStr,
  dateSequence,
  diffDaysStr,
  monthBounds,
  mondayOfStr,
  previousPeriod,
  comparisonLabel,
} from '@/components/reports/period';
import { resolveUnitCost, summarizeItemCosts, type CostableOrderItem } from '@/components/reports/cost';
import { estimateLaborCost, type TimeEntryForLabor, type PayrollRuleForLabor } from '@/components/reports/labor';
import { fetchIngredientLinesByMenuItems } from '@/components/costing/data';
import { calcWasteAmount } from '@/lib/costing';
import {
  computeSalesMetrics,
  computeCostVariance,
  computePurchasePriceVariance,
  SETTLED_ORDER_STATUSES,
  type RefundLike,
  type SettledOrderLike,
  type SalesMetricsOptions,
} from '@/lib/metrics';

const WEEKDAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];

/**
 * レポート・経営分析の数字（Web の /app/reports と iPad アプリのネイティブの店舗分析で共通。2026-10-24）。
 * 中身は app/app/reports/page.tsx にあった集計をそのまま移したもの（数字の定義は変えていない）。
 * 見られる店舗が無いときは null。
 */
export async function loadReportData(ctx: SessionContext, sp: { from?: string; to?: string; store?: string }) {
  const today = todayJst();
  let from = sp.from || daysAgoJst(29);
  let to = sp.to || today;
  if (from > to) [from, to] = [to, from];
  const spanDays = diffDaysStr(from, to);
  if (spanDays > 366) from = addDaysStr(to, -366);

  const supabase = await createClient();

  // 店舗スコープ。HQロールが store= を指定した場合は一時的にその店舗へ絞り込む
  // （本社ダッシュボードの店舗ランキングからのドリルダウン用。cookieの店舗選択自体は変更しない）
  let storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
  let scopeLabel = ctx.currentStore ? ctx.currentStore.name : '全店舗';
  let storeOverrideId: string | null = null;
  if (!ctx.currentStore && sp.store) {
    const match = ctx.stores.find((s) => s.id === sp.store);
    if (match) {
      storeIds = [match.id];
      scopeLabel = `${match.name}（全店舗から絞込中）`;
      storeOverrideId = match.id;
    }
  }
  const extraQ = storeOverrideId ? `&store=${storeOverrideId}` : '';

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

  // ---- 期間プリセット ----
  const thisMonth = monthBounds(0, today);
  const lastMonth = monthBounds(-1, today);
  const yesterday = daysAgoJst(1);
  const thisWeekMonday = mondayOfStr(today);
  const lastWeekMonday = addDaysStr(thisWeekMonday, -7);
  const presets: PeriodPreset[] = [
    { label: '今日', from: today, to: today },
    { label: '昨日', from: yesterday, to: yesterday },
    { label: '今週', from: thisWeekMonday, to: today },
    { label: '先週', from: lastWeekMonday, to: addDaysStr(lastWeekMonday, 6) },
    { label: '今月', from: thisMonth.first, to: today },
    { label: '先月', from: lastMonth.first, to: lastMonth.last },
    { label: '過去7日', from: daysAgoJst(6), to: today },
    { label: '過去30日', from: daysAgoJst(29), to: today },
  ];

  // 比較期間（前日比/前週比/前月比を選択期間の長さから自動選択）
  const prev = previousPeriod(from, to);
  const compareLabel = comparisonLabel(prev.days);

  // ---- データ取得（当期間） ----
  const [
    { data: orders },
    { data: refunds },
    { data: reservations },
    { data: payments },
    { data: orderItems },
    { data: menuCategories },
    { data: timeEntriesData },
    { data: payrollRulesData },
    { data: expensesData },
    { data: tablesData },
    { data: wasteMovements },
    { data: countAdjustMovements },
    { data: customersData },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('id, total, guest_count, status, store_id, staff_id, customer_id, table_id, discount_total, business_date, opened_at, order_type')
      .in('store_id', storeIds)
      .gte('business_date', from)
      .lte('business_date', to)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase
      .from('refunds')
      .select('amount, kind, store_id, business_date')
      .in('store_id', storeIds)
      .gte('business_date', from)
      .lte('business_date', to),
    supabase
      .from('reservations')
      .select('id, status, created_via, store_id, reservation_sources(id, name)')
      .in('store_id', storeIds)
      .gte('reserved_date', from)
      .lte('reserved_date', to),
    supabase
      .from('payments')
      .select('method, amount, store_id, business_date, status')
      .in('store_id', storeIds)
      .gte('business_date', from)
      .lte('business_date', to)
      .eq('status', 'completed'),
    supabase
      .from('order_items')
      .select('menu_item_id, name, quantity, line_total, menu_items(name, cost, category_id), orders!inner(status, business_date)')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('orders.status', 'paid')
      .gte('orders.business_date', from)
      .lte('orders.business_date', to),
    supabase.from('menu_categories').select('id, name').eq('organization_id', ctx.organizationId),
    supabase
      .from('time_entries')
      .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
      .in('store_id', storeIds)
      .gte('work_date', from)
      .lte('work_date', to),
    supabase
      .from('payroll_rules')
      .select('profile_id, store_id, pay_type, base_amount, effective_from, effective_to')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active'),
    supabase
      .from('expenses')
      .select('amount')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('approval_status', 'approved')
      .gte('business_date', from)
      .lte('business_date', to),
    supabase.from('restaurant_tables').select('id, capacity_max').in('store_id', storeIds).eq('status', 'active'),
    supabase
      .from('stock_movements')
      .select('quantity, unit_cost')
      .in('store_id', storeIds)
      .eq('movement_type', 'waste')
      .gte('business_date', from)
      .lte('business_date', to),
    supabase
      .from('stock_movements')
      .select('quantity, unit_cost, inventory_items(avg_cost)')
      .in('store_id', storeIds)
      .eq('movement_type', 'count_adjust')
      .gte('business_date', from)
      .lte('business_date', to),
    storeOverrideId
      ? supabase.from('customers').select('total_spent').eq('primary_store_id', storeOverrideId).eq('status', 'active')
      : ctx.currentStore
        ? supabase.from('customers').select('total_spent').eq('primary_store_id', ctx.currentStore.id).eq('status', 'active')
        : supabase.from('customers').select('total_spent').eq('organization_id', ctx.organizationId).eq('status', 'active'),
  ]);

  // ---- データ取得（比較期間） ----
  const [{ data: prevOrders }, { data: prevRefunds }, { data: prevOrderItems }, { data: prevTimeEntriesData }, { data: prevExpensesData }] = await Promise.all([
    supabase
      .from('orders')
      .select('total, guest_count, status, order_type')
      .in('store_id', storeIds)
      .gte('business_date', prev.from)
      .lte('business_date', prev.to)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase
      .from('refunds')
      .select('amount, kind, business_date')
      .in('store_id', storeIds)
      .gte('business_date', prev.from)
      .lte('business_date', prev.to),
    supabase
      .from('order_items')
      .select('menu_item_id, quantity, line_total, menu_items(cost), orders!inner(status, business_date)')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('orders.status', 'paid')
      .gte('orders.business_date', prev.from)
      .lte('orders.business_date', prev.to),
    supabase
      .from('time_entries')
      .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
      .in('store_id', storeIds)
      .gte('work_date', prev.from)
      .lte('work_date', prev.to),
    supabase
      .from('expenses')
      .select('amount')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('approval_status', 'approved')
      .gte('business_date', prev.from)
      .lte('business_date', prev.to),
  ]);

  const allOrders = orders ?? [];
  // paidOrders は商品/カテゴリ/スタッフ別集計・時間帯/曜日別売上等、明細単位の内訳表示で使う（既存仕様を維持）。
  // 全体売上KPI・P/Lカスケード・客数系はすべて allOrders（settled=paid+refunded）+ refunds から算出する（lib/metrics.ts）。
  const paidOrders = allOrders.filter((o) => o.status === 'paid');
  const allRefunds = refunds ?? [];
  const allReservations = reservations ?? [];
  const allOrderItems = orderItems ?? [];
  const categoryNameById = new Map((menuCategories ?? []).map((c) => [c.id, c.name]));
  const timeEntries = (timeEntriesData ?? []) as TimeEntryForLabor[];
  const payrollRules = (payrollRulesData ?? []) as PayrollRuleForLabor[];
  const prevTimeEntries = (prevTimeEntriesData ?? []) as TimeEntryForLabor[];

  // ---- 原価（レシピ原価優先、なければ menu_items.cost）----
  const menuItemIds = [
    ...new Set(
      [...allOrderItems, ...(prevOrderItems ?? [])].map((i) => i.menu_item_id).filter((v): v is string => !!v)
    ),
  ];
  const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);
  const costSummary = summarizeItemCosts(allOrderItems as unknown as CostableOrderItem[], linesByItem);
  const prevCostSummary = summarizeItemCosts((prevOrderItems ?? []) as unknown as CostableOrderItem[], linesByItem);

  // ---- 人件費（概算）----
  const laborResult = estimateLaborCost(timeEntries, payrollRules);
  const prevLaborResult = estimateLaborCost(prevTimeEntries, payrollRules);

  // ---- 経費 ----
  const expenseTotal = (expensesData ?? []).reduce((a, e) => a + e.amount, 0);
  const prevExpenseTotal = (prevExpensesData ?? []).reduce((a, e) => a + e.amount, 0);

  // ---- KPI（基本。lib/metrics.ts の正式定義に統一）----
  // gross_sales=settled(paid+refunded)のtotal合計・refunds=返金営業日基準・net_sales=gross−refunds・
  // 会計件数/客数=settled件数・客単価=net÷客数。ダッシュボード/予算/日報と同一の関数・同一のクエリ条件を使う。
  const mainMetrics = computeSalesMetrics(allOrders as SettledOrderLike[], allRefunds as RefundLike[], metricsOpts);
  const grossSalesTotal = mainMetrics.grossSales;
  const refundsTotal = mainMetrics.refunds;
  const salesTotal = mainMetrics.netSales; // 純売上。以降「売上」と呼ぶ値はすべてこれ
  const transactionCount = mainMetrics.transactionCount;
  const guestCount = mainMetrics.guests;
  const avgSpend = mainMetrics.avgSpend;
  const discountTotal = mainMetrics.discounts;

  const prevAllOrders = prevOrders ?? [];
  const prevAllRefunds = prevRefunds ?? [];
  const prevMetrics = computeSalesMetrics(prevAllOrders as SettledOrderLike[], prevAllRefunds as RefundLike[], metricsOpts);
  const prevSalesTotal = prevMetrics.netSales;
  const prevGuestCount = prevMetrics.guests;
  const prevAvgSpend = prevMetrics.avgSpend;

  // ---- P/L カスケード ----
  const grossProfit = salesTotal - costSummary.totalCost;
  const storeProfit = grossProfit - laborResult.total - expenseTotal;
  const prevGrossProfit = prevSalesTotal - prevCostSummary.totalCost;
  const prevStoreProfit = prevGrossProfit - prevLaborResult.total - prevExpenseTotal;

  const costRatePct = salesTotal > 0 ? (costSummary.totalCost / salesTotal) * 100 : 0;
  const laborRatePct = salesTotal > 0 ? (laborResult.total / salesTotal) * 100 : 0;
  const prevCostRatePct = prevSalesTotal > 0 ? (prevCostSummary.totalCost / prevSalesTotal) * 100 : 0;
  const prevLaborRatePct = prevSalesTotal > 0 ? (prevLaborResult.total / prevSalesTotal) * 100 : 0;
  const flCost = costSummary.totalCost + laborResult.total;
  const flRatePct = salesTotal > 0 ? (flCost / salesTotal) * 100 : 0;

  // ---- 客数・売上関連の指標 ----
  const tables = tablesData ?? [];
  const totalSeats = tables.reduce((a, t) => a + t.capacity_max, 0);
  const totalTableCount = tables.length;
  const turnoverRate = totalSeats > 0 ? guestCount / totalSeats : 0;

  const tablesByDate = new Map<string, Set<string>>();
  for (const o of paidOrders) {
    if (!o.table_id) continue;
    const set = tablesByDate.get(o.business_date) ?? new Set<string>();
    set.add(o.table_id);
    tablesByDate.set(o.business_date, set);
  }
  const periodDates = dateSequence(from, to);
  const tableUtilizationPct =
    totalTableCount > 0 && periodDates.length > 0
      ? (periodDates.reduce((a, d) => a + (tablesByDate.get(d)?.size ?? 0) / totalTableCount, 0) / periodDates.length) * 100
      : 0;

  // ---- 予約系KPI ----
  const reservationCount = allReservations.length;
  const reservationCompleted = allReservations.filter((r) => r.status === 'completed').length;
  const reservationCancelled = allReservations.filter((r) => r.status === 'cancelled').length;
  const reservationNoShow = allReservations.filter((r) => r.status === 'no_show').length;
  const reservationWaitlisted = allReservations.filter((r) => r.status === 'waitlisted').length;
  const reservationCompletionBase = reservationCount - reservationWaitlisted;
  const reservationCompletionRate = reservationCompletionBase > 0 ? (reservationCompleted / reservationCompletionBase) * 100 : 0;
  const cancelRatePct = reservationCount > 0 ? (reservationCancelled / reservationCount) * 100 : 0;
  const noShowRatePct = reservationCount > 0 ? (reservationNoShow / reservationCount) * 100 : 0;
  const walkInCount = allReservations.filter((r) => r.created_via === 'walk_in').length;

  // ---- 再来店率（期間内に2回以上来店した顧客 ÷ 来店顧客）----
  const customerOrderCounts = new Map<string, number>();
  for (const o of paidOrders) {
    if (!o.customer_id) continue;
    customerOrderCounts.set(o.customer_id, (customerOrderCounts.get(o.customer_id) ?? 0) + 1);
  }
  const visitedCustomerCount = customerOrderCounts.size;
  const repeatCustomerCount = [...customerOrderCounts.values()].filter((c) => c >= 2).length;
  const repeatRatePct = visitedCustomerCount > 0 ? (repeatCustomerCount / visitedCustomerCount) * 100 : 0;

  // ---- LTV平均 ----
  const customerRows = customersData ?? [];
  const ltvAverage = customerRows.length > 0 ? Math.floor(customerRows.reduce((a, c) => a + c.total_spent, 0) / customerRows.length) : 0;

  // ---- 廃棄率 ----
  const wasteAmount = calcWasteAmount((wasteMovements ?? []).map((m) => ({ quantity: m.quantity, unitCost: m.unit_cost })));
  const wasteRatePct = salesTotal > 0 ? (wasteAmount / salesTotal) * 100 : 0;

  // ---- 原価差異分析: 理論原価（レシピ×平均仕入単価）と実原価（理論原価＋廃棄＋棚卸差異）----
  // 棚卸差異額: stock_movements(count_adjust).quantity は「実棚卸数 − 期待数」（棚卸確定時にfinalizeCountが記録）。
  // マイナス（実数不足）を正の費用として計上するため -quantity×単価で符号反転する。
  // unit_cost は棚卸確定時に記録されないため inventory_items.avg_cost を確定額の代替として使う。
  const countAdjustmentAmount = (countAdjustMovements ?? []).reduce((acc, m) => {
    const inv = m.inventory_items as unknown as { avg_cost: number | null } | null;
    const unitCost = m.unit_cost ?? inv?.avg_cost ?? null;
    if (unitCost == null) return acc;
    return acc + Math.round(-m.quantity * unitCost);
  }, 0);
  const costVariance = computeCostVariance({
    theoreticalCost: costSummary.totalCost,
    wasteAmount,
    countAdjustmentAmount,
  });

  // ---- 仕入価格変動（参考指標。差異内訳とは独立・二重計上しない）----
  // 期間内の入荷（stock_movements 'in'）を、期首時点の平均仕入単価（期間開始前の'in'実績を数量加重平均した近似値）と比較する。
  const { data: periodReceiptMovements } = await supabase
    .from('stock_movements')
    .select('inventory_item_id, quantity, unit_cost')
    .in('store_id', storeIds)
    .eq('movement_type', 'in')
    .gte('business_date', from)
    .lte('business_date', to)
    .limit(5000);
  const receiptItemIds = [...new Set((periodReceiptMovements ?? []).map((m) => m.inventory_item_id as string))];
  const { data: priorReceiptMovements } =
    receiptItemIds.length > 0
      ? await supabase
          .from('stock_movements')
          .select('inventory_item_id, quantity, unit_cost')
          .in('store_id', storeIds)
          .eq('movement_type', 'in')
          .in('inventory_item_id', receiptItemIds)
          .lt('business_date', from)
          .limit(5000)
      : { data: [] as { inventory_item_id: string; quantity: number; unit_cost: number | null }[] };
  const baselineUnitCostByItem = new Map<string, number>();
  {
    const sums = new Map<string, { qty: number; amount: number }>();
    for (const m of priorReceiptMovements ?? []) {
      if (m.unit_cost == null) continue;
      const key = m.inventory_item_id as string;
      const cur = sums.get(key) ?? { qty: 0, amount: 0 };
      cur.qty += Number(m.quantity);
      cur.amount += Number(m.quantity) * (m.unit_cost as number);
      sums.set(key, cur);
    }
    for (const [key, s] of sums) {
      if (s.qty > 0) baselineUnitCostByItem.set(key, s.amount / s.qty);
    }
  }
  const purchasePriceVariance = computePurchasePriceVariance(
    (periodReceiptMovements ?? [])
      .filter((m) => m.unit_cost != null)
      .map((m) => ({
        quantity: Number(m.quantity),
        unitCost: m.unit_cost as number,
        baselineUnitCost: baselineUnitCostByItem.get(m.inventory_item_id as string) ?? null,
      }))
  );

  // ---- 日別売上（総売上・返金・純売上）----
  const grossByDate = new Map<string, number>();
  for (const o of allOrders) grossByDate.set(o.business_date, (grossByDate.get(o.business_date) ?? 0) + o.total);
  const refundByDate = new Map<string, number>();
  for (const r of allRefunds) refundByDate.set(r.business_date, (refundByDate.get(r.business_date) ?? 0) + r.amount);
  const dailyRows = periodDates.map((date) => {
    const gross = grossByDate.get(date) ?? 0;
    const refund = refundByDate.get(date) ?? 0;
    return { date, gross, refund, net: gross - refund };
  });
  const dailyChartData = dailyRows.map((r) => ({ date: `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`, sales: r.net }));

  // ---- 時間帯別売上 ----
  const salesByHour = new Map<number, number>();
  for (const o of paidOrders) {
    const hour = Number(formatTime(o.opened_at).split(':')[0]) % 24;
    salesByHour.set(hour, (salesByHour.get(hour) ?? 0) + o.total);
  }
  const hourlyChartData = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}時`, sales: salesByHour.get(h) ?? 0 }));

  // ---- 曜日別売上 ----
  const salesByWeekday = new Map<string, number>();
  for (const o of paidOrders) {
    const wd = weekdayJa(o.business_date);
    salesByWeekday.set(wd, (salesByWeekday.get(wd) ?? 0) + o.total);
  }
  const weekdayChartData = WEEKDAY_ORDER.map((w) => ({ weekday: w, sales: salesByWeekday.get(w) ?? 0 }));

  // ---- 支払方法別 ----
  const amountByMethod = new Map<string, number>();
  for (const p of payments ?? []) amountByMethod.set(p.method, (amountByMethod.get(p.method) ?? 0) + p.amount);
  const paymentChartData = [...amountByMethod.entries()]
    .map(([method, amount]) => ({ label: METHOD_LABELS[method] ?? method, amount }))
    .sort((a, b) => b.amount - a.amount);

  // ---- 商品別・カテゴリ別 ----
  interface ProductAgg {
    key: string;
    name: string;
    quantity: number;
    revenue: number;
    cost: number | null;
  }
  const productMap = new Map<string, ProductAgg>();
  const categoryTotals = new Map<string, number>();
  for (const oi of allOrderItems) {
    const mi = oi.menu_items as unknown as { name: string; cost: number | null; category_id: string | null } | null;
    const key = oi.menu_item_id ?? `custom:${oi.name}`;
    const unitCost = resolveUnitCost(oi.menu_item_id, mi?.cost ?? null, linesByItem);
    const existing = productMap.get(key);
    const lineCost = unitCost != null ? unitCost * oi.quantity : null;
    if (existing) {
      existing.quantity += oi.quantity;
      existing.revenue += oi.line_total;
      if (lineCost != null) existing.cost = (existing.cost ?? 0) + lineCost;
    } else {
      productMap.set(key, { key, name: mi?.name ?? oi.name, quantity: oi.quantity, revenue: oi.line_total, cost: lineCost });
    }
    const catName = mi?.category_id ? (categoryNameById.get(mi.category_id) ?? '未分類') : '未分類';
    categoryTotals.set(catName, (categoryTotals.get(catName) ?? 0) + oi.line_total);
  }
  const productRows = [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  const categoryChartData = [...categoryTotals.entries()]
    .map(([category, sales]) => ({ category, sales }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 8);

  // ---- スタッフ別 ----
  const staffIds = [...new Set(paidOrders.map((o) => o.staff_id).filter((v): v is string => !!v))];
  const { data: staffProfiles } =
    staffIds.length > 0
      ? await supabase.from('profiles').select('id, display_name').in('id', staffIds)
      : { data: [] as { id: string; display_name: string }[] };
  const staffNameById = new Map((staffProfiles ?? []).map((p) => [p.id, p.display_name]));
  const staffAgg = new Map<string, { count: number; sales: number; guests: number }>();
  for (const o of paidOrders) {
    const key = o.staff_id ?? '__unassigned__';
    const cur = staffAgg.get(key) ?? { count: 0, sales: 0, guests: 0 };
    cur.count += 1;
    cur.sales += o.total;
    cur.guests += o.guest_count;
    staffAgg.set(key, cur);
  }
  const staffRows = [...staffAgg.entries()]
    .map(([staffId, v]) => ({
      name: staffId === '__unassigned__' ? '未設定' : (staffNameById.get(staffId) ?? '不明なスタッフ'),
      count: v.count,
      sales: v.sales,
      avgSpend: v.guests > 0 ? Math.floor(v.sales / v.guests) : 0,
    }))
    .sort((a, b) => b.sales - a.sales);

  // ---- 予約経路別 ----
  const sourceAgg = new Map<string, { id: string | null; total: number; completed: number; cancelled: number }>();
  for (const r of allReservations) {
    const src = r.reservation_sources as unknown as { id: string; name: string } | null;
    const key = src?.name ?? '未設定';
    const cur = sourceAgg.get(key) ?? { id: src?.id ?? null, total: 0, completed: 0, cancelled: 0 };
    cur.total += 1;
    if (r.status === 'completed') cur.completed += 1;
    if (r.status === 'cancelled' || r.status === 'no_show') cur.cancelled += 1;
    sourceAgg.set(key, cur);
  }
  const sourceRows = [...sourceAgg.entries()]
    .map(([name, v]) => ({
      name,
      ...v,
      completionRate: v.total > 0 ? (v.completed / v.total) * 100 : 0,
      cancelRate: v.total > 0 ? (v.cancelled / v.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // ---- 店舗別比較（全店舗表示かつ絞込なしの場合のみ。売上は純売上=gross−refunds）----
  let storeComparison: { id: string; name: string; sales: number; count: number; guests: number }[] = [];
  if (!ctx.currentStore && !storeOverrideId && ctx.stores.length > 1) {
    storeComparison = ctx.stores.map((s) => {
      const storeOrders = allOrders.filter((o) => o.store_id === s.id);
      const storeRefunds = allRefunds.filter((r) => r.store_id === s.id);
      const storeMetrics = computeSalesMetrics(storeOrders as SettledOrderLike[], storeRefunds as RefundLike[], metricsOpts);
      return {
        id: s.id,
        name: s.name,
        sales: storeMetrics.netSales,
        count: storeMetrics.transactionCount,
        guests: storeMetrics.guests,
      };
    });
  }

  // ---- 月別損益推移（当月/前月/前々月の3ヶ月比較）+ 予算対比 ----
  // 本社共通費の配賦は将来機能: 現状は店舗（または選択スコープ）に紐づく経費のみを集計しており、
  // 本社の間接費（家賃・システム利用料等）は各店舗のP/Lに配賦されていない点に留意。
  async function computeMonthPl(offset: number) {
    const { first, last } = monthBounds(offset, today);
    const monthTo = today < last ? today : last;
    const [oRes, rRes, oiRes, teRes, exRes, budgetRes] = await Promise.all([
      supabase
        .from('orders')
        .select('total, guest_count, status, store_id, order_type')
        .in('store_id', storeIds)
        .gte('business_date', first)
        .lte('business_date', monthTo)
        .in('status', SETTLED_ORDER_STATUSES),
      supabase
        .from('refunds')
        .select('amount, kind')
        .in('store_id', storeIds)
        .gte('business_date', first)
        .lte('business_date', monthTo),
      supabase
        .from('order_items')
        .select('menu_item_id, quantity, line_total, menu_items(cost), orders!inner(status, business_date)')
        .in('store_id', storeIds)
        .eq('status', 'active')
        .eq('orders.status', 'paid')
        .gte('orders.business_date', first)
        .lte('orders.business_date', monthTo),
      supabase
        .from('time_entries')
        .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
        .in('store_id', storeIds)
        .gte('work_date', first)
        .lte('work_date', monthTo),
      supabase
        .from('expenses')
        .select('amount')
        .in('store_id', storeIds)
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .gte('business_date', first)
        .lte('business_date', monthTo),
      storeOverrideId || ctx.currentStore
        ? supabase.from('budgets').select('sales_budget, profit_target').eq('organization_id', ctx.organizationId).eq('month', first).eq('store_id', storeOverrideId ?? ctx.currentStore!.id).maybeSingle()
        : supabase.from('budgets').select('sales_budget, profit_target').eq('organization_id', ctx.organizationId).eq('month', first).is('store_id', null).maybeSingle(),
    ]);
    const mOrders = oRes.data ?? [];
    const mRefunds = rRes.data ?? [];
    const mMetrics = computeSalesMetrics(mOrders as SettledOrderLike[], mRefunds as RefundLike[], metricsOpts);
    const mSales = mMetrics.netSales;
    const mItems = oiRes.data ?? [];
    const mMenuItemIds = [...new Set(mItems.map((i) => i.menu_item_id).filter((v): v is string => !!v))];
    const mLines = await fetchIngredientLinesByMenuItems(supabase, mMenuItemIds);
    const mCost = summarizeItemCosts(mItems as unknown as CostableOrderItem[], mLines);
    const mLabor = estimateLaborCost((teRes.data ?? []) as TimeEntryForLabor[], payrollRules);
    const mExpense = (exRes.data ?? []).reduce((a, e) => a + e.amount, 0);
    const mGrossProfit = mSales - mCost.totalCost;
    const mStoreProfit = mGrossProfit - mLabor.total - mExpense;
    return {
      label: `${Number(first.slice(5, 7))}月`,
      sales: mSales,
      cost: mCost.totalCost,
      grossProfit: mGrossProfit,
      labor: mLabor.total,
      expense: mExpense,
      profit: mStoreProfit,
      budgetSales: budgetRes.data?.sales_budget ?? null,
      budgetProfit: budgetRes.data?.profit_target ?? null,
    };
  }
  const monthlyPl = await Promise.all([-2, -1, 0].map((offset) => computeMonthPl(offset)));

  const ordersHref = `/app/orders?from=${from}&to=${to}`;
  const reservationsHref = `/app/reservations/list?from=${from}&to=${to}`;

  const plSteps: PlStep[] = [
    { label: '総売上', amount: grossSalesTotal, href: ordersHref, note: 'paid＋refunded注文のtotal合計（値引後・返金控除前）' },
    { label: '値引（参考）', amount: discountTotal, isDeduction: true, note: '総売上には反映済みの参考表示（差引計算には使いません）' },
    { label: '返金', amount: refundsTotal, isDeduction: true, href: ordersHref, note: '返金が発生した営業日で計上' },
    { label: '純売上', amount: salesTotal, href: ordersHref, emphasis: true },
    {
      label: '原価（理論）',
      amount: costSummary.totalCost,
      isDeduction: true,
      href: '/app/costing?tab=items',
      note:
        (costSummary.excludedCount > 0 ? `原価未設定の品目${costSummary.excludedCount}件（売上${yen(costSummary.excludedRevenue)}）は計算から除外。` : '') +
        '販売数量×レシピ×平均仕入単価。実際の廃棄・棚卸差異は含みません（原価差異分析セクション参照）',
    },
    { label: '粗利益', amount: grossProfit, href: '/app/reports', emphasis: true },
    { label: '人件費（概算）', amount: laborResult.total, isDeduction: true, href: '/app/payroll', note: '時給ルール×実働時間の概算（月給者は月給÷21日で日割り）。割増・手当は含みません' },
    { label: '経費', amount: expenseTotal, isDeduction: true, href: `/app/expenses?from=${from}&to=${to}`, note: '承認済み経費のみ（請求書・支払管理は含みません）' },
    { label: '店舗利益', amount: storeProfit, href: '/app/reports', emphasis: true },
  ];

  return {
    from,
    to,
    scopeLabel,
    storeOverrideId,
    extraQ,
    presets,
    compareLabel,
    plSteps,
    salesTotal,
    prevSalesTotal,
    grossProfit,
    prevGrossProfit,
    storeProfit,
    prevStoreProfit,
    costVariance,
    purchasePriceVariance,
    monthlyPl,
    avgSpend,
    prevAvgSpend,
    guestCount,
    prevGuestCount,
    flCost,
    flRatePct,
    costRatePct,
    prevCostRatePct,
    laborRatePct,
    prevLaborRatePct,
    turnoverRate,
    totalSeats,
    tableUtilizationPct,
    reservationCompletionRate,
    reservationCompleted,
    reservationCompletionBase,
    cancelRatePct,
    noShowRatePct,
    repeatRatePct,
    repeatCustomerCount,
    visitedCustomerCount,
    ltvAverage,
    wasteRatePct,
    wasteAmount,
    transactionCount,
    reservationCount,
    walkInCount,
    discountTotal,
    dailyChartData,
    paymentChartData,
    hourlyChartData,
    weekdayChartData,
    categoryChartData,
    storeComparison,
    productRows,
    staffRows,
    sourceRows,
    dailyRows,
    ordersHref,
    reservationsHref,
    customerCount: customerRows.length,
    includeTakeoutGuests: metricsOpts.includeTakeoutGuests !== false,
  };
}

export type ReportData = NonNullable<Awaited<ReturnType<typeof loadReportData>>>;
