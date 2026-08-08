import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { toCsv, csvResponse } from '@/lib/csv';
import { todayJst, daysAgoJst, weekdayJa } from '@/lib/format';
import { summarizeItemCosts, type CostableOrderItem } from '@/components/reports/cost';
import { estimateLaborCost, type TimeEntryForLabor, type PayrollRuleForLabor } from '@/components/reports/labor';
import { fetchIngredientLinesByMenuItems } from '@/components/costing/data';

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
    .in('status', ['paid', 'refunded']);

  // KPI母集団の統一定義: 売上・件数・客数・客単価は paid のみ（画面側と同一）
  const byDate = new Map<string, { sales: number; count: number; guests: number; discount: number }>();
  for (const o of orders ?? []) {
    if (o.status !== 'paid') continue;
    const cur = byDate.get(o.business_date) ?? { sales: 0, count: 0, guests: 0, discount: 0 };
    cur.count += 1;
    cur.guests += o.guest_count;
    cur.sales += o.total;
    cur.discount += o.discount_total;
    byDate.set(o.business_date, cur);
  }

  const rows = dateSequence(from, to).map((date) => {
    const v = byDate.get(date) ?? { sales: 0, count: 0, guests: 0, discount: 0 };
    const avgSpend = v.guests > 0 ? Math.floor(v.sales / v.guests) : 0;
    return [date, weekdayJa(date), v.sales, v.count, v.guests, avgSpend, v.discount];
  });
  const dailyCsv = toCsv(['日付', '曜日', '売上', '会計件数', '客数', '客単価', '値引き額'], rows);

  // ---- P/L行（売上/原価/粗利/人件費/経費/利益）----
  const salesTotal = (orders ?? []).filter((o) => o.status === 'paid').reduce((a, o) => a + o.total, 0);

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
      ['売上', salesTotal, ''],
      ['原価', costSummary.totalCost, `レシピ原価優先／menu_items.cost。原価未設定${costSummary.excludedCount}件は除外`],
      ['粗利益', grossProfit, '売上−原価'],
      ['人件費（概算）', laborResult.total, '時給ルール×実働時間の概算。割増・手当は含まない'],
      ['経費', expenseTotal, '承認済み経費のみ（請求書は含まない）'],
      ['店舗利益', storeProfit, '粗利益−人件費−経費'],
    ]
  );
  const plCsv = plCsvRaw.replace(/^﻿/, '');

  const csv = `${dailyCsv}\r\n\r\n${plCsv}`;
  return csvResponse(`日別サマリ_${from}_${to}.csv`, csv);
}
