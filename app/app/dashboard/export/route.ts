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

  const [ordersRes, orderItemsRes, timeEntriesRes, payrollRulesRes, expensesRes, prevOrdersRes] = await Promise.all([
    supabase
      .from('orders')
      .select('total, guest_count, status, store_id')
      .in('store_id', storeIds)
      .gte('business_date', from)
      .lte('business_date', to)
      .in('status', ['paid', 'refunded']),
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
      .select('total, store_id')
      .in('store_id', storeIds)
      .gte('business_date', prev.from)
      .lte('business_date', prev.to)
      .eq('status', 'paid'),
  ]);

  const orders = ordersRes.data ?? [];
  const orderItems = orderItemsRes.data ?? [];
  const timeEntries = (timeEntriesRes.data ?? []) as TimeEntryForLabor[];
  const payrollRules = (payrollRulesRes.data ?? []) as PayrollRuleForLabor[];
  const expenses = expensesRes.data ?? [];
  const prevOrders = prevOrdersRes.data ?? [];

  const menuItemIds = [...new Set(orderItems.map((i) => i.menu_item_id).filter((v): v is string => !!v))];
  const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);

  const rows = stores
    .map((s) => {
      const storeOrders = orders.filter((o) => o.store_id === s.id);
      const storePaid = storeOrders.filter((o) => o.status === 'paid');
      const sales = storePaid.reduce((a, o) => a + o.total, 0);
      const guests = storeOrders.reduce((a, o) => a + o.guest_count, 0);
      const avgSpend = guests > 0 ? Math.floor(sales / guests) : 0;

      const storeItems = orderItems.filter((i) => i.store_id === s.id);
      const costSummary = summarizeItemCosts(storeItems as unknown as CostableOrderItem[], linesByItem);
      const grossProfit = sales - costSummary.totalCost;

      const storeEntries = timeEntries.filter((e) => e.store_id === s.id);
      const laborResult = estimateLaborCost(storeEntries, payrollRules);

      const expenseTotal = expenses.filter((e) => e.store_id === s.id).reduce((a, e) => a + e.amount, 0);
      const profit = grossProfit - laborResult.total - expenseTotal;

      const prevSales = prevOrders.filter((o) => o.store_id === s.id).reduce((a, o) => a + o.total, 0);
      const changePct = prevSales > 0 ? ((sales - prevSales) / prevSales) * 100 : null;

      return { name: s.name, sales, guests, avgSpend, grossProfit, labor: laborResult.total, expense: expenseTotal, profit, changePct };
    })
    .sort((a, b) => b.sales - a.sales);

  const csv = toCsv(
    ['店舗', '売上', '客数', '客単価', '粗利益', '人件費（概算）', '経費', '利益', '前期間比(%)'],
    rows.map((r) => [r.name, r.sales, r.guests, r.avgSpend, r.grossProfit, r.labor, r.expense, r.profit, r.changePct != null ? r.changePct.toFixed(1) : ''])
  );

  return csvResponse(`店舗ランキング_${from}_${to}.csv`, csv);
}
