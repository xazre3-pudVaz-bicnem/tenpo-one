import type { SessionContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { monthBounds } from '@/components/reports/period';
import { resolveUnitCost } from '@/components/reports/cost';
import { estimateLaborCost, type PayrollRuleForLabor, type TimeEntryForLabor } from '@/components/reports/labor';
import { fetchIngredientLinesByMenuItems } from '@/components/costing/data';
import { dailyBudgetsFrom } from '@/lib/daily-budget';
import { dailyBudgetFromMonthly } from '@/lib/home-todos';
import { fixedCostTotal, monthlyCostsFrom, perDayCost } from '@/lib/monthly-settlement';
import { isGuestCountedOrder, SETTLED_ORDER_STATUSES, type SalesMetricsOptions } from '@/lib/metrics';
import { summarizeManagement, type BudgetRow, type DayFact, type ManagementSummary } from '@/lib/management-dashboard';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;

/** 1,000 行ずつ全部読む（明細は月で 1,000 行を超える） */
async function fetchAllPages(make: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data } = await make(from, from + PAGE - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface OrderItemRow {
  store_id: string;
  menu_item_id: string | null;
  quantity: number;
  line_total: number;
  menu_items: { cost: number | null } | null;
  orders: { status: string; business_date: string } | null;
}

/**
 * 経営ダッシュボードの月の数字（lib/management-dashboard.ts に渡す実績を集める）。
 * 店舗は上の切り替え（全店舗 or 1店舗）。sp.store で全店舗から 1 店舗に絞れる（レポートと同じ）。
 * RLS のかかったセッションのクライアントで読むだけ。
 */
export async function loadManagementDashboard(
  ctx: SessionContext,
  input: { month: string; today: string; store?: string }
): Promise<{ summary: ManagementSummary; scopeLabel: string; storeOverrideId: string | null; costNote: { excludedCount: number; missingRuleCount: number } } | null> {
  const supabase: SupabaseClient = await createClient();
  let stores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  let scopeLabel = ctx.currentStore ? ctx.currentStore.name : '全店舗';
  let storeOverrideId: string | null = null;
  if (!ctx.currentStore && input.store) {
    const match = ctx.stores.find((s) => s.id === input.store);
    if (match) {
      stores = [match];
      scopeLabel = `${match.name}（全店舗から絞込中）`;
      storeOverrideId = match.id;
    }
  }
  const ids = stores.map((s) => s.id);
  if (ids.length === 0) return null;

  const { first, last } = monthBounds(0, `${input.month}-01`);
  const monthFirst = first;

  const [{ data: orgRow }, { data: orders }, { data: refunds }, { data: timeEntries }, { data: payrollRules }, { data: expenses }, { data: settings }, { data: budgets }, orderItemsRaw] =
    await Promise.all([
      supabase.from('organizations').select('kpi_settings').eq('id', ctx.organizationId).maybeSingle(),
      supabase
        .from('orders')
        .select('store_id, business_date, total, guest_count, status, order_type')
        .in('store_id', ids)
        .gte('business_date', first)
        .lte('business_date', last)
        .in('status', SETTLED_ORDER_STATUSES),
      supabase.from('refunds').select('store_id, business_date, amount').in('store_id', ids).gte('business_date', first).lte('business_date', last),
      supabase
        .from('time_entries')
        .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
        .in('store_id', ids)
        .gte('work_date', first)
        .lte('work_date', last),
      supabase
        .from('payroll_rules')
        .select('profile_id, store_id, pay_type, base_amount, effective_from, effective_to')
        .eq('organization_id', ctx.organizationId)
        .eq('status', 'active'),
      supabase
        .from('expenses')
        .select('store_id, business_date, amount')
        .in('store_id', ids)
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .gte('business_date', first)
        .lte('business_date', last),
      supabase.from('store_settings').select('store_id, settings').in('store_id', ids),
      supabase
        .from('budgets')
        .select('store_id, sales_budget, cost_rate_target, labor_rate_target, profit_target')
        .eq('organization_id', ctx.organizationId)
        .eq('month', monthFirst)
        .or(`store_id.is.null,store_id.in.(${ids.join(',')})`),
      fetchAllPages((a, b) =>
        supabase
          .from('order_items')
          .select('store_id, menu_item_id, quantity, line_total, menu_items(cost), orders!inner(status, business_date)')
          .in('store_id', ids)
          .eq('status', 'active')
          .eq('orders.status', 'paid')
          .gte('orders.business_date', first)
          .lte('orders.business_date', last)
          .order('id')
          .range(a, b)
      ),
    ]);

  // 結合（menu_items / orders）は 1 件だが、型は配列で推論されるので読み替える（レポートと同じ扱い）
  const orderItems = orderItemsRaw as unknown as OrderItemRow[];
  const metricsOpts: SalesMetricsOptions = {
    includeTakeoutGuests: (orgRow?.kpi_settings as { includeTakeoutGuests?: boolean } | null)?.includeTakeoutGuests ?? true,
  };

  // ---- 店舗 × 日 に積む ----
  const facts = new Map<string, DayFact>();
  const at = (storeId: string, date: string): DayFact => {
    const k = `${storeId}|${date}`;
    let f = facts.get(k);
    if (!f) {
      f = { storeId, date, sales: 0, guests: 0, groups: 0, cost: 0, labor: 0, expenses: 0 };
      facts.set(k, f);
    }
    return f;
  };
  for (const o of orders ?? []) {
    const f = at(o.store_id as string, o.business_date as string);
    f.sales += Number(o.total ?? 0);
    f.groups += 1;
    if (isGuestCountedOrder({ total: 0, order_type: (o.order_type as string | null) ?? undefined }, metricsOpts)) f.guests += Number(o.guest_count ?? 0);
  }
  for (const r of refunds ?? []) at(r.store_id as string, r.business_date as string).sales -= Number(r.amount ?? 0);
  for (const e of expenses ?? []) at(e.store_id as string, e.business_date as string).expenses += Number(e.amount ?? 0);

  // 原価（レシピ原価 → 商品の原価。どちらも無い明細は数えない）
  const menuItemIds = [...new Set(orderItems.map((i) => i.menu_item_id).filter((v): v is string => !!v))];
  const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);
  let excludedCount = 0;
  for (const oi of orderItems) {
    const date = oi.orders?.business_date;
    if (!date) continue;
    const unit = resolveUnitCost(oi.menu_item_id, oi.menu_items?.cost ?? null, linesByItem);
    if (unit == null) {
      excludedCount += 1;
      continue;
    }
    at(oi.store_id, date).cost += unit * Number(oi.quantity ?? 0);
  }

  // 人件費（店舗 × 日 ごとに概算）
  const rules = (payrollRules ?? []) as PayrollRuleForLabor[];
  const entriesByKey = new Map<string, TimeEntryForLabor[]>();
  for (const e of (timeEntries ?? []) as TimeEntryForLabor[]) {
    const k = `${e.store_id}|${e.work_date}`;
    const list = entriesByKey.get(k);
    if (list) list.push(e);
    else entriesByKey.set(k, [e]);
  }
  let missingRuleCount = 0;
  for (const [k, list] of entriesByKey) {
    const [storeId, date] = k.split('|');
    const r = estimateLaborCost(list, rules);
    at(storeId, date).labor += r.total;
    missingRuleCount += r.missingRuleCount;
  }

  // ---- 予算・固定費 ----
  const settingsByStore = new Map((settings ?? []).map((r) => [r.store_id as string, r.settings as unknown]));
  const budgetRows: BudgetRow[] = (budgets ?? []).map((b) => ({
    storeId: (b.store_id as string | null) ?? null,
    salesBudget: Number(b.sales_budget ?? 0),
    costRateTarget: b.cost_rate_target != null ? Number(b.cost_rate_target) : null,
    laborRateTarget: b.labor_rate_target != null ? Number(b.labor_rate_target) : null,
    profitTarget: b.profit_target != null ? Number(b.profit_target) : null,
  }));
  const dailyMaps = new Map(ids.map((id) => [id, dailyBudgetsFrom(settingsByStore.get(id), input.month)]));
  const monthlyByStore = new Map(budgetRows.filter((b) => b.storeId).map((b) => [b.storeId as string, b.salesBudget]));
  const dailyBudget = (storeId: string, date: string): number | null => {
    const d = dailyMaps.get(storeId)?.[date];
    if (d != null && d > 0) return d;
    return dailyBudgetFromMonthly(monthlyByStore.get(storeId) ?? null, date);
  };
  const fixedPerDay = (storeId: string): number => perDayCost(fixedCostTotal(monthlyCostsFrom(settingsByStore.get(storeId), input.month)), input.month);

  const summary = summarizeManagement({
    month: input.month,
    today: input.today,
    stores,
    facts: [...facts.values()],
    budgets: budgetRows,
    dailyBudget,
    fixedPerDay,
    useOrgBudget: !ctx.currentStore && !storeOverrideId,
  });

  return { summary, scopeLabel, storeOverrideId, costNote: { excludedCount, missingRuleCount } };
}
