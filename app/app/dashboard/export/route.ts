import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { toCsv, csvResponse } from '@/lib/csv';
import { todayJst } from '@/lib/format';
import { monthBounds, previousPeriod } from '@/components/reports/period';
import { summarizeItemCosts, type CostableOrderItem } from '@/components/reports/cost';
import { estimateLaborCost, type TimeEntryForLabor, type PayrollRuleForLabor } from '@/components/reports/labor';
import { fetchIngredientLinesByMenuItems } from '@/components/costing/data';
import { computeSalesMetrics, SETTLED_ORDER_STATUSES, type RefundLike, type SettledOrderLike } from '@/lib/metrics';

/** 本社ダッシュボードの店舗別ランキングCSV（既定: 今月〜本日） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  if (!can(ctx.role, 'dashboard.view')) {
    return new Response('ダッシュボードの閲覧権限がありません', { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const today = todayJst();
  const thisMonth = monthBounds(0, today);
  let from = searchParams.get('from') || thisMonth.first;
  let to = searchParams.get('to') || today;
  if (from > to) [from, to] = [to, from];

  const supabase = await createClient();
  const stores = ctx.stores;
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) {
    return csvResponse('店舗ランキング.csv', toCsv(['店舗', '売上'], []));
  }

  const prev = previousPeriod(from, to);

  const [ordersRes, refundsRes, orderItemsRes, timeEntriesRes, payrollRulesRes, expensesRes, prevOrdersRes, prevRefundsRes] = await Promise.all([
    supabase
      .from('orders')
      .select('total, guest_count, status, store_id')
      .in('store_id', storeIds)
      .gte('business_date', from)
      .lte('business_date', to)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase
      .from('refunds')
      .select('amount, kind, store_id')
      .in('store_id', storeIds)
      .gte('business_date', from)
      .lte('business_date', to),
    supabase
      .from('order_items')
      .select('menu_item_id, quantity, line_total, store_id, menu_items(cost), orders!inner(status, business_date)')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('orders.status', 'paid')
      .gte('orders.business_date', from)
      .lte('orders.business_date', to),
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
      .select('amount, store_id')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('approval_status', 'approved')
      .gte('business_date', from)
      .lte('business_date', to),
    supabase
      .from('orders')
      .select('total, guest_count, store_id')
      .in('store_id', storeIds)
      .gte('business_date', prev.from)
      .lte('business_date', prev.to)
      .in('status', SETTLED_ORDER_STATUSES),
    supabase
      .from('refunds')
      .select('amount, kind, store_id')
      .in('store_id', storeIds)
      .gte('business_date', prev.from)
      .lte('business_date', prev.to),
  ]);

  const orders = ordersRes.data ?? [];
  const refunds = refundsRes.data ?? [];
  const orderItems = orderItemsRes.data ?? [];
  const timeEntries = (timeEntriesRes.data ?? []) as TimeEntryForLabor[];
  const payrollRules = (payrollRulesRes.data ?? []) as PayrollRuleForLabor[];
  const expenses = expensesRes.data ?? [];
  const prevOrders = prevOrdersRes.data ?? [];
  const prevRefunds = prevRefundsRes.data ?? [];

  const menuItemIds = [...new Set(orderItems.map((i) => i.menu_item_id).filter((v): v is string => !!v))];
  const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);

  // 売上・客数・返金はダッシュボード画面と同一の lib/metrics.ts (computeSalesMetrics) で算出する
  const rows = stores
    .map((s) => {
      const storeOrders = orders.filter((o) => o.store_id === s.id);
      const storeRefunds = refunds.filter((r) => r.store_id === s.id);
      const metrics = computeSalesMetrics(storeOrders as SettledOrderLike[], storeRefunds as RefundLike[]);
      const grossSales = metrics.grossSales;
      const refundTotal = metrics.refunds;
      const sales = metrics.netSales;
      const guests = metrics.guests;
      const avgSpend = metrics.avgSpend;

      // 原価はpaid（会計成立で返金されていない）注文の明細のみを対象とする既存仕様を維持
      const storeItems = orderItems.filter((i) => i.store_id === s.id);
      const costSummary = summarizeItemCosts(storeItems as unknown as CostableOrderItem[], linesByItem);
      const grossProfit = sales - costSummary.totalCost;

      const storeEntries = timeEntries.filter((e) => e.store_id === s.id);
      const laborResult = estimateLaborCost(storeEntries, payrollRules);

      const expenseTotal = expenses.filter((e) => e.store_id === s.id).reduce((a, e) => a + e.amount, 0);
      const profit = grossProfit - laborResult.total - expenseTotal;

      const prevMetrics = computeSalesMetrics(
        prevOrders.filter((o) => o.store_id === s.id) as SettledOrderLike[],
        prevRefunds.filter((r) => r.store_id === s.id) as RefundLike[]
      );
      const changePct = prevMetrics.netSales > 0 ? ((sales - prevMetrics.netSales) / prevMetrics.netSales) * 100 : null;

      return { name: s.name, grossSales, refundTotal, sales, guests, avgSpend, grossProfit, labor: laborResult.total, expense: expenseTotal, profit, changePct };
    })
    .sort((a, b) => b.sales - a.sales);

  const csv = toCsv(
    ['店舗', '総売上', '返金', '純売上', '客数', '客単価', '粗利益', '人件費（概算）', '経費', '利益', '前期間比(%)'],
    rows.map((r) => [
      r.name,
      r.grossSales,
      r.refundTotal,
      r.sales,
      r.guests,
      r.avgSpend,
      r.grossProfit,
      r.labor,
      r.expense,
      r.profit,
      r.changePct != null ? r.changePct.toFixed(1) : '',
    ])
  );

  return csvResponse(`店舗ランキング_${from}_${to}.csv`, csv);
}
