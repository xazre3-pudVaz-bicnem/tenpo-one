import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { toCsv, csvResponse } from '@/lib/csv';
import { todayJst, daysAgoJst, weekdayJa } from '@/lib/format';
import { summarizeItemCosts, type CostableOrderItem } from '@/components/reports/cost';
import { estimateLaborCost, type TimeEntryForLabor, type PayrollRuleForLabor } from '@/components/reports/labor';
import { fetchIngredientLinesByMenuItems } from '@/components/costing/data';
import { computeSalesMetrics, SETTLED_ORDER_STATUSES, type RefundLike, type SettledOrderLike } from '@/lib/metrics';

function dateSequence(fromStr: string, toStr: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${fromStr}T00:00:00Z`);
  const end = new Date(`${toStr}T00:00:00Z`);
  while (cursor <= end && dates.length < 400) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
}

/** 日別サマリCSV（from/to指定、デフォルト過去30日） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  if (!can(ctx.role, 'reports.view')) {
    return new Response('レポートの閲覧権限がありません', { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  let from = searchParams.get('from') || daysAgoJst(29);
  let to = searchParams.get('to') || todayJst();
  if (from > to) [from, to] = [to, from];

  const supabase = await createClient();
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  const { data: orders } = await supabase
    .from('orders')
    .select('total, guest_count, discount_total, status, store_id, business_date')
    .in('store_id', storeIds)
    .gte('business_date', from)
    .lte('business_date', to)
    .in('status', SETTLED_ORDER_STATUSES);

  const { data: refunds } = await supabase
    .from('refunds')
    .select('amount, kind, store_id, business_date')
    .in('store_id', storeIds)
    .gte('business_date', from)
    .lte('business_date', to);

  const allOrders = orders ?? [];
  const allRefunds = refunds ?? [];

  // 正式定義（lib/metrics.ts）に統一: 会計件数・客数・客単価は settled(paid+refunded)基準、
  // 売上は純売上（gross−refunds）。ダッシュボード/レポート画面と同一のクエリ条件・同一の関数を使う。
  const grossByDate = new Map<string, number>();
  const guestsByDate = new Map<string, number>();
  const countByDate = new Map<string, number>();
  const discountByDate = new Map<string, number>();
  for (const o of allOrders) {
    grossByDate.set(o.business_date, (grossByDate.get(o.business_date) ?? 0) + o.total);
    guestsByDate.set(o.business_date, (guestsByDate.get(o.business_date) ?? 0) + o.guest_count);
    countByDate.set(o.business_date, (countByDate.get(o.business_date) ?? 0) + 1);
    discountByDate.set(o.business_date, (discountByDate.get(o.business_date) ?? 0) + o.discount_total);
  }
  const refundByDate = new Map<string, number>();
  for (const r of allRefunds) refundByDate.set(r.business_date, (refundByDate.get(r.business_date) ?? 0) + r.amount);

  const rows = dateSequence(from, to).map((date) => {
    const gross = grossByDate.get(date) ?? 0;
    const refund = refundByDate.get(date) ?? 0;
    const net = gross - refund;
    const guests = guestsByDate.get(date) ?? 0;
    const count = countByDate.get(date) ?? 0;
    const discount = discountByDate.get(date) ?? 0;
    const avgSpend = guests > 0 ? Math.floor(net / guests) : 0;
    return [date, weekdayJa(date), gross, refund, net, count, guests, avgSpend, discount];
  });
  const dailyCsv = toCsv(['日付', '曜日', '総売上', '返金', '純売上', '会計件数', '客数', '客単価', '値引き額'], rows);

  // ---- P/L行（総売上/値引/返金/純売上/原価/粗利/人件費/経費/利益）----
  const mainMetrics = computeSalesMetrics(allOrders as SettledOrderLike[], allRefunds as RefundLike[]);
  const grossSalesTotal = mainMetrics.grossSales;
  const refundsTotal = mainMetrics.refunds;
  const discountTotal = mainMetrics.discounts;
  const salesTotal = mainMetrics.netSales;

  const [{ data: orderItems }, { data: timeEntriesData }, { data: payrollRulesData }, { data: expensesData }] = await Promise.all([
    supabase
      .from('order_items')
      .select('menu_item_id, quantity, line_total, menu_items(cost), orders!inner(status, business_date)')
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
      .select('amount')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('approval_status', 'approved')
      .gte('business_date', from)
      .lte('business_date', to),
  ]);

  const menuItemIds = [...new Set((orderItems ?? []).map((i) => i.menu_item_id).filter((v): v is string => !!v))];
  const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);
  const costSummary = summarizeItemCosts((orderItems ?? []) as unknown as CostableOrderItem[], linesByItem);
  const laborResult = estimateLaborCost((timeEntriesData ?? []) as TimeEntryForLabor[], (payrollRulesData ?? []) as PayrollRuleForLabor[]);
  const expenseTotal = (expensesData ?? []).reduce((a, e) => a + e.amount, 0);
  const grossProfit = salesTotal - costSummary.totalCost;
  const storeProfit = grossProfit - laborResult.total - expenseTotal;

  const plCsvRaw = toCsv(
    ['項目', '金額', '備考'],
    [
      ['総売上', grossSalesTotal, 'paid＋refunded注文のtotal合計（値引後・返金控除前）'],
      ['値引（参考）', discountTotal, '総売上には反映済みの参考値'],
      ['返金', refundsTotal, '返金が発生した営業日で計上'],
      ['純売上', salesTotal, '総売上−返金'],
      ['原価（理論）', costSummary.totalCost, `レシピ原価優先／menu_items.cost。原価未設定${costSummary.excludedCount}件は除外。廃棄・棚卸差異は含まない`],
      ['粗利益', grossProfit, '純売上−原価（理論）'],
      ['人件費（概算）', laborResult.total, '時給ルール×実働時間の概算。割増・手当は含まない'],
      ['経費', expenseTotal, '承認済み経費のみ（請求書は含まない）'],
      ['店舗利益', storeProfit, '粗利益−人件費−経費'],
    ]
  );
  const plCsv = plCsvRaw.replace(/^﻿/, '');

  const csv = `${dailyCsv}\r\n\r\n${plCsv}`;
  return csvResponse(`日別サマリ_${from}_${to}.csv`, csv);
}
