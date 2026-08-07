import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { yen, todayJst, daysAgoJst, formatTime, weekdayJa } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { SalesChart, type DailyPoint } from '@/components/dashboard/sales-chart';
import { SetupProgressCard } from '@/components/dashboard/setup-progress-card';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { LinkStatCard } from '@/components/reports/stat-link';
import { WeekdaySalesChart } from '@/components/reports/weekday-sales-chart';
import { HourlySalesChart } from '@/components/reports/hourly-sales-chart';
import { PaymentMethodChart } from '@/components/reports/payment-method-chart';
import { METHOD_LABELS } from '@/components/cash/labels';
import { monthBounds, previousPeriod } from '@/components/reports/period';
import { summarizeItemCosts, type CostableOrderItem } from '@/components/reports/cost';
import { estimateLaborCost, type TimeEntryForLabor, type PayrollRuleForLabor } from '@/components/reports/labor';
import { fetchIngredientLinesByMenuItems } from '@/components/costing/data';
import { collectDashboardAlerts } from '@/components/dashboard/alerts';
import { AnnouncementBanner } from '@/components/dashboard/announcement-banner';
import { StoreRankingTable } from '@/components/dashboard/store-ranking-table';

export const metadata: Metadata = { title: 'ダッシュボード' };

function dateOnlyJst(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/**
 * オンボーディング完了率（完了済み・かつ100%未満のときのみ数値を返す）。
 * organizations.onboarding.data.completedSteps（実データを保存したステップ）を10ステップに対する割合で算出する。
 */
async function getSetupProgressPercent(organizationId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('onboarding')
    .eq('id', organizationId)
    .maybeSingle();
  const onboarding = (org?.onboarding ?? {}) as { completed?: boolean; data?: { completedSteps?: number[] } };
  if (!onboarding.completed) return null;
  const completedSteps = Array.isArray(onboarding.data?.completedSteps) ? onboarding.data.completedSteps : [];
  const percent = Math.round((new Set(completedSteps).size / 10) * 100);
  return percent < 100 ? percent : null;
}

export default async function DashboardPage() {
  const ctx = await requireMember();
  const today = todayJst();
  const setupPercent = ctx.organizationId && can(ctx.role, 'org.settings') ? await getSetupProgressPercent(ctx.organizationId) : null;

  if (ctx.currentStore) {
    return <StoreDashboard ctx={ctx} today={today} setupPercent={setupPercent} />;
  }
  return <HqDashboard ctx={ctx} today={today} setupPercent={setupPercent} />;
}

// =====================================================================
// 本社ダッシュボード（全店舗）
// =====================================================================

async function HqDashboard({
  ctx,
  today,
  setupPercent,
}: {
  ctx: Awaited<ReturnType<typeof requireMember>>;
  today: string;
  setupPercent: number | null;
}) {
  const supabase = await createClient();
  const stores = ctx.stores;
  const storeIds = stores.map((s) => s.id);

  if (storeIds.length === 0) {
    return (
      <div>
        <PageHeader title="ダッシュボード" />
        <EmptyState title="アクセス可能な店舗がありません" />
      </div>
    );
  }

  const thisMonth = monthBounds(0, today);
  const monthFrom = thisMonth.first;
  const prev = previousPeriod(monthFrom, today);

  const [
    todayOrdersRes,
    monthOrdersRes,
    monthItemsRes,
    paymentsRes,
    timeEntriesRes,
    payrollRulesRes,
    reservationsRes,
    expensesRes,
    prevOrdersRes,
    alerts,
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('total, guest_count, status, store_id')
      .in('store_id', storeIds)
      .eq('business_date', today)
      .in('status', ['paid', 'refunded']),
    supabase
      .from('orders')
      .select('id, total, guest_count, discount_total, staff_id, customer_id, store_id, business_date, opened_at, status')
      .in('store_id', storeIds)
      .gte('business_date', monthFrom)
      .lte('business_date', today)
      .in('status', ['paid', 'refunded']),
    supabase
      .from('order_items')
      .select('menu_item_id, name, quantity, line_total, store_id, menu_items(name, cost), orders!inner(status, business_date)')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('orders.status', 'paid')
      .gte('orders.business_date', monthFrom)
      .lte('orders.business_date', today),
    supabase
      .from('payments')
      .select('method, amount, store_id')
      .in('store_id', storeIds)
      .gte('business_date', monthFrom)
      .lte('business_date', today)
      .eq('status', 'completed'),
    supabase
      .from('time_entries')
      .select('profile_id, store_id, work_date, clock_in_at, clock_out_at, break_minutes, entry_type')
      .in('store_id', storeIds)
      .gte('work_date', monthFrom)
      .lte('work_date', today),
    supabase
      .from('payroll_rules')
      .select('profile_id, store_id, pay_type, base_amount, effective_from, effective_to')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active'),
    supabase
      .from('reservations')
      .select('store_id, status, reserved_date, source_id, reservation_sources(id, name)')
      .in('store_id', storeIds)
      .gte('reserved_date', monthFrom)
      .lte('reserved_date', today),
    supabase
      .from('expenses')
      .select('amount, store_id, business_date')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .eq('approval_status', 'approved')
      .gte('business_date', monthFrom)
      .lte('business_date', today),
    supabase
      .from('orders')
      .select('total, store_id')
      .in('store_id', storeIds)
      .gte('business_date', prev.from)
      .lte('business_date', prev.to)
      .eq('status', 'paid'),
    collectDashboardAlerts(supabase, ctx.organizationId, stores, true),
  ]);

  const todayOrders = todayOrdersRes.data ?? [];
  const monthOrders = monthOrdersRes.data ?? [];
  const monthItems = monthItemsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const timeEntries = (timeEntriesRes.data ?? []) as TimeEntryForLabor[];
  const payrollRules = (payrollRulesRes.data ?? []) as PayrollRuleForLabor[];
  const reservations = reservationsRes.data ?? [];
  const expenses = expensesRes.data ?? [];
  const prevOrders = prevOrdersRes.data ?? [];

  // ---- 本日 ----
  const todaySales = todayOrders.filter((o) => o.status === 'paid').reduce((a, o) => a + o.total, 0);
  const todayCount = todayOrders.filter((o) => o.status === 'paid').length;
  const todayGuests = todayOrders.reduce((a, o) => a + o.guest_count, 0);
  const todayAvgSpend = todayGuests > 0 ? Math.floor(todaySales / todayGuests) : 0;

  // ---- 今月: 原価（レシピ優先） ----
  const menuItemIds = [...new Set(monthItems.map((i) => i.menu_item_id).filter((v): v is string => !!v))];
  const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);
  const costSummary = summarizeItemCosts(monthItems as unknown as CostableOrderItem[], linesByItem);

  // ---- 今月: 人件費概算 ----
  const laborResult = estimateLaborCost(timeEntries, payrollRules);

  // ---- 今月: 売上・粗利・利益率 ----
  const monthPaidOrders = monthOrders.filter((o) => o.status === 'paid');
  const monthSalesTotal = monthPaidOrders.reduce((a, o) => a + o.total, 0);
  const monthGrossProfit = monthSalesTotal - costSummary.totalCost;
  const monthProfitRate = monthSalesTotal > 0 ? (monthGrossProfit / monthSalesTotal) * 100 : 0;
  const laborRate = monthSalesTotal > 0 ? (laborResult.total / monthSalesTotal) * 100 : 0;

  // ---- 店舗別ランキング ----
  const salesByStore = new Map<string, number>();
  const guestsByStore = new Map<string, number>();
  for (const o of monthOrders) {
    guestsByStore.set(o.store_id, (guestsByStore.get(o.store_id) ?? 0) + o.guest_count);
    if (o.status === 'paid') {
      salesByStore.set(o.store_id, (salesByStore.get(o.store_id) ?? 0) + o.total);
    }
  }
  const costByStore = new Map<string, number>();
  for (const oi of monthItems) {
    const mi = oi.menu_items as unknown as { cost: number | null } | null;
    const lines = oi.menu_item_id ? linesByItem.get(oi.menu_item_id) : undefined;
    const unitCost =
      lines && lines.length > 0
        ? lines.reduce((a, l) => (l.avgCost != null ? a + Math.ceil(l.quantity * l.avgCost) : a), 0)
        : (mi?.cost ?? null);
    if (unitCost == null) continue;
    costByStore.set(oi.store_id, (costByStore.get(oi.store_id) ?? 0) + unitCost * oi.quantity);
  }
  const laborByStore = new Map<string, number>();
  for (const s of stores) {
    const entries = timeEntries.filter((e) => e.store_id === s.id);
    laborByStore.set(s.id, estimateLaborCost(entries, payrollRules).total);
  }
  const expensesByStore = new Map<string, number>();
  for (const e of expenses) expensesByStore.set(e.store_id, (expensesByStore.get(e.store_id) ?? 0) + e.amount);
  const prevSalesByStore = new Map<string, number>();
  for (const o of prevOrders) prevSalesByStore.set(o.store_id, (prevSalesByStore.get(o.store_id) ?? 0) + o.total);

  const storeRanking = stores
    .map((s) => {
      const sales = salesByStore.get(s.id) ?? 0;
      const cost = costByStore.get(s.id) ?? 0;
      const labor = laborByStore.get(s.id) ?? 0;
      const expense = expensesByStore.get(s.id) ?? 0;
      const guests = guestsByStore.get(s.id) ?? 0;
      const grossProfit = sales - cost;
      const profit = grossProfit - labor - expense;
      const prevSales = prevSalesByStore.get(s.id) ?? 0;
      const changePct = prevSales > 0 ? ((sales - prevSales) / prevSales) * 100 : null;
      return {
        id: s.id,
        name: s.name,
        sales,
        grossProfit,
        profit,
        guests,
        avgSpend: guests > 0 ? Math.floor(sales / guests) : 0,
        changePct,
      };
    })
    .sort((a, b) => b.sales - a.sales);

  // ---- 商品ランキング TOP10 ----
  interface ProductAgg {
    key: string;
    name: string;
    quantity: number;
    revenue: number;
  }
  const productMap = new Map<string, ProductAgg>();
  for (const oi of monthItems) {
    const mi = oi.menu_items as unknown as { name: string } | null;
    const key = oi.menu_item_id ?? `custom:${oi.name}`;
    const existing = productMap.get(key);
    if (existing) {
      existing.quantity += oi.quantity;
      existing.revenue += oi.line_total;
    } else {
      productMap.set(key, { key, name: mi?.name ?? oi.name, quantity: oi.quantity, revenue: oi.line_total });
    }
  }
  const productRanking = [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // ---- スタッフランキング TOP10 ----
  const staffAgg = new Map<string, { count: number; sales: number; guests: number }>();
  for (const o of monthPaidOrders) {
    const key = o.staff_id ?? '__unassigned__';
    const cur = staffAgg.get(key) ?? { count: 0, sales: 0, guests: 0 };
    cur.count += 1;
    cur.sales += o.total;
    cur.guests += o.guest_count;
    staffAgg.set(key, cur);
  }
  const staffIds = [...staffAgg.keys()].filter((k) => k !== '__unassigned__');
  const { data: staffProfiles } =
    staffIds.length > 0
      ? await supabase.from('profiles').select('id, display_name').in('id', staffIds)
      : { data: [] as { id: string; display_name: string }[] };
  const staffNameById = new Map((staffProfiles ?? []).map((p) => [p.id, p.display_name]));
  const staffRanking = [...staffAgg.entries()]
    .map(([staffId, v]) => ({
      name: staffId === '__unassigned__' ? '未設定' : (staffNameById.get(staffId) ?? '不明なスタッフ'),
      count: v.count,
      sales: v.sales,
      avgSpend: v.guests > 0 ? Math.floor(v.sales / v.guests) : 0,
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 10);

  // ---- 曜日別・時間帯別（今月・全店） ----
  const WEEKDAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];
  const salesByWeekday = new Map<string, number>();
  const salesByHour = new Map<number, number>();
  for (const o of monthPaidOrders) {
    const wd = weekdayJa(o.business_date);
    salesByWeekday.set(wd, (salesByWeekday.get(wd) ?? 0) + o.total);
    const hour = Number(formatTime(o.opened_at).split(':')[0]) % 24;
    salesByHour.set(hour, (salesByHour.get(hour) ?? 0) + o.total);
  }
  const weekdayChartData = WEEKDAY_ORDER.map((w) => ({ weekday: w, sales: salesByWeekday.get(w) ?? 0 }));
  const hourlyChartData = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}時`, sales: salesByHour.get(h) ?? 0 }));

  // ---- 支払方法別（今月） ----
  const amountByMethod = new Map<string, number>();
  for (const p of payments) amountByMethod.set(p.method, (amountByMethod.get(p.method) ?? 0) + p.amount);
  const paymentChartData = [...amountByMethod.entries()]
    .map(([method, amount]) => ({ label: METHOD_LABELS[method] ?? method, amount }))
    .sort((a, b) => b.amount - a.amount);

  // ---- 新規/リピーター構成（今月）----
  const linkedOrders = monthPaidOrders.filter((o) => o.customer_id);
  const unlinkedCount = monthPaidOrders.length - linkedOrders.length;
  const customerIds = [...new Set(linkedOrders.map((o) => o.customer_id).filter((v): v is string => !!v))];
  const { data: customerRows } =
    customerIds.length > 0
      ? await supabase.from('customers').select('id, first_visit_at').in('id', customerIds)
      : { data: [] as { id: string; first_visit_at: string | null }[] };
  const firstVisitById = new Map((customerRows ?? []).map((c) => [c.id, dateOnlyJst(c.first_visit_at)]));
  let newOrderCount = 0;
  for (const o of linkedOrders) {
    const fv = o.customer_id ? firstVisitById.get(o.customer_id) : null;
    if (fv && fv >= monthFrom && fv <= today) newOrderCount += 1;
  }
  const repeatOrderCount = linkedOrders.length - newOrderCount;

  // ---- 予約経路別（今月）----
  const sourceAgg = new Map<string, { id: string | null; total: number; completed: number; cancelled: number }>();
  for (const r of reservations) {
    const src = r.reservation_sources as unknown as { id: string; name: string } | null;
    const key = src?.name ?? '未設定';
    const cur = sourceAgg.get(key) ?? { id: src?.id ?? null, total: 0, completed: 0, cancelled: 0 };
    cur.total += 1;
    if (r.status === 'completed') cur.completed += 1;
    if (r.status === 'cancelled' || r.status === 'no_show') cur.cancelled += 1;
    sourceAgg.set(key, cur);
  }
  const sourceRows = [...sourceAgg.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total);

  const reportsHref = (extra?: string) => `/app/reports?from=${monthFrom}&to=${today}${extra ?? ''}`;
  const todayReportsHref = `/app/reports?from=${today}&to=${today}`;

  return (
    <div>
      <PageHeader title="ダッシュボード" description={`全店舗（${stores.length}店舗）｜${today.replaceAll('-', '/')}（${weekdayJa(today)}）本社サマリー`} />

      {setupPercent != null && <SetupProgressCard percent={setupPercent} />}
      <AnnouncementBanner supabase={supabase} organizationId={ctx.organizationId} userId={ctx.userId} storeIds={storeIds} />
      <AlertList alerts={alerts} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <LinkStatCard href={todayReportsHref} label="本日売上" value={yen(todaySales)} tone="primary" />
        <LinkStatCard href={reportsHref()} label="今月売上" value={yen(monthSalesTotal)} tone="primary" />
        <LinkStatCard href={reportsHref()} label="今月粗利益" value={yen(monthGrossProfit)} tone="success" />
        <LinkStatCard href={reportsHref()} label="利益率" value={`${monthProfitRate.toFixed(1)}%`} />
        <LinkStatCard href={todayReportsHref} label="本日客数" value={`${todayGuests}名`} sub={`会計${todayCount}件`} />
        <LinkStatCard href={todayReportsHref} label="客単価" value={yen(todayAvgSpend)} />
        <LinkStatCard label="店舗数" value={`${stores.length}店舗`} />
        <LinkStatCard href="/app/payroll" label="今月人件費（概算）" value={yen(laborResult.total)} />
        <LinkStatCard href="/app/payroll" label="人件費率" value={`${laborRate.toFixed(1)}%`} tone={laborRate > 35 ? 'warning' : 'default'} />
      </div>
      <p className="mt-2 text-xs text-gray-400">
        ※ 原価はレシピ原価を優先し、無ければ商品原価（menu_items.cost）を使用。どちらも未設定の品目（{costSummary.excludedCount}件・売上{yen(costSummary.excludedRevenue)}）は原価計算から除外しています。
        人件費は時給ルール×実働時間の概算（月給者は月給÷21日で日割り）で、残業・深夜等の割増は含みません
        {laborResult.missingRuleCount > 0 && `（給与ルール未設定の勤務${laborResult.missingRuleCount}件は概算から除外）`}。
      </p>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>店舗ランキング（今月・{stores.length}店舗）</CardTitle>
        </CardHeader>
        <CardContent>
          {storeRanking.length === 0 ? (
            <EmptyState title="今月の実績データがありません" className="border-0 py-8" />
          ) : (
            <StoreRankingTable rows={storeRanking} monthFrom={monthFrom} today={today} exportHref={`/app/dashboard/export?from=${monthFrom}&to=${today}`} />
          )}
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>商品ランキング TOP10（今月・全店）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {productRanking.length === 0 ? (
              <div className="p-5">
                <EmptyState title="商品データがありません" className="border-0 py-8" />
              </div>
            ) : (
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>#</Th>
                      <Th>商品名</Th>
                      <Th className="text-right">数量</Th>
                      <Th className="text-right">売上</Th>
                      <Th />
                    </Tr>
                  </THead>
                  <TBody>
                    {productRanking.map((p, i) => (
                      <Tr key={p.key}>
                        <Td className="text-gray-400">{i + 1}</Td>
                        <Td className="font-medium text-navy">{p.name}</Td>
                        <Td className="text-right tabular-nums">{p.quantity}</Td>
                        <Td className="text-right tabular-nums">{yen(p.revenue)}</Td>
                        <Td>
                          <Link href={`/app/costing?tab=items&q=${encodeURIComponent(p.name)}`} className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
                            原価を見る
                          </Link>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>スタッフランキング TOP10（今月・全店）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {staffRanking.length === 0 ? (
              <div className="p-5">
                <EmptyState title="スタッフ別データがありません" className="border-0 py-8" />
              </div>
            ) : (
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>#</Th>
                      <Th>スタッフ</Th>
                      <Th className="text-right">会計件数</Th>
                      <Th className="text-right">売上</Th>
                      <Th className="text-right">客単価</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {staffRanking.map((s, i) => (
                      <Tr key={s.name + i}>
                        <Td className="text-gray-400">{i + 1}</Td>
                        <Td className="font-medium text-navy">{s.name}</Td>
                        <Td className="text-right tabular-nums">{s.count}件</Td>
                        <Td className="text-right tabular-nums">{yen(s.sales)}</Td>
                        <Td className="text-right tabular-nums">{yen(s.avgSpend)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>曜日別売上（今月・全店）</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href={reportsHref()} className="block">
              <WeekdaySalesChart data={weekdayChartData} />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>時間帯別売上（今月・全店）</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href={reportsHref()} className="block">
              <HourlySalesChart data={hourlyChartData} />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>支払方法別構成（今月・全店）</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentChartData.length === 0 ? (
              <EmptyState title="支払データがありません" className="border-0 py-10" />
            ) : (
              <Link href="/app/orders" className="block">
                <PaymentMethodChart data={paymentChartData} />
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>新規・リピーター構成（今月・全店）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <span className="text-sm text-gray-600">顧客紐付きあり</span>
              <span className="tabular-nums font-semibold text-navy">
                {linkedOrders.length}件（{monthPaidOrders.length > 0 ? ((linkedOrders.length / monthPaidOrders.length) * 100).toFixed(1) : '0.0'}%）
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <span className="text-sm text-gray-600">顧客紐付きなし</span>
              <span className="tabular-nums font-semibold text-navy">
                {unlinkedCount}件（{monthPaidOrders.length > 0 ? ((unlinkedCount / monthPaidOrders.length) * 100).toFixed(1) : '0.0'}%）
              </span>
            </div>
            <div className="ml-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary-soft/40 px-4 py-3">
              <span className="text-sm text-gray-600">└ 新規（今月が初回来店）</span>
              <span className="tabular-nums font-semibold text-primary-deep">
                {newOrderCount}件（{linkedOrders.length > 0 ? ((newOrderCount / linkedOrders.length) * 100).toFixed(1) : '0.0'}%）
              </span>
            </div>
            <Link href="/app/customers?sort=last_visit_desc" className="ml-4 flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 hover:border-primary/40">
              <span className="text-sm text-gray-600">└ リピーター（既存顧客）</span>
              <span className="tabular-nums font-semibold text-navy">
                {repeatOrderCount}件（{linkedOrders.length > 0 ? ((repeatOrderCount / linkedOrders.length) * 100).toFixed(1) : '0.0'}%）
              </span>
            </Link>
            <p className="text-xs text-gray-400">
              ※ visit_count は累計来店回数のため月次の新規判定には使えず、「顧客紐付きの有無」と「初回来店日（first_visit_at）が今月かどうか」による近似値です。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>予約経路別（今月・全店）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sourceRows.length === 0 ? (
              <div className="p-5">
                <EmptyState title="予約データがありません" className="border-0 py-8" />
              </div>
            ) : (
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>経路</Th>
                      <Th className="text-right">件数</Th>
                      <Th className="text-right">来店完了率</Th>
                      <Th className="text-right">キャンセル率</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {sourceRows.map((s) => (
                      <Tr key={s.name}>
                        <Td>
                          <Link
                            href={`/app/reservations/list?from=${monthFrom}&to=${today}${s.id ? `&source=${s.id}` : ''}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {s.name}
                          </Link>
                        </Td>
                        <Td className="text-right tabular-nums">{s.total}件</Td>
                        <Td className="text-right tabular-nums">{s.total > 0 ? ((s.completed / s.total) * 100).toFixed(1) : '0.0'}%</Td>
                        <Td className="text-right tabular-nums">{s.total > 0 ? ((s.cancelled / s.total) * 100).toFixed(1) : '0.0'}%</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AlertList({ alerts }: { alerts: { id: string; tone: 'danger' | 'warning'; title: string; href: string }[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="mb-5 space-y-2">
      {alerts.map((a) => (
        <Link
          key={a.id}
          href={a.href}
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
            a.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
          }`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {a.title}
        </Link>
      ))}
    </div>
  );
}

// =====================================================================
// 店舗ダッシュボード（店舗選択時）
// =====================================================================

async function StoreDashboard({
  ctx,
  today,
  setupPercent,
}: {
  ctx: Awaited<ReturnType<typeof requireMember>>;
  today: string;
  setupPercent: number | null;
}) {
  const supabase = await createClient();
  const store = ctx.currentStore!;
  const storeIds = [store.id];

  const [todayOrdersRes, todayReservationsRes, closingsRes, alerts] = await Promise.all([
    supabase
      .from('orders')
      .select('total, guest_count, status, store_id')
      .in('store_id', storeIds)
      .eq('business_date', today)
      .in('status', ['paid', 'refunded']),
    supabase
      .from('reservations')
      .select('id, start_at, party_size, guest_name, status')
      .in('store_id', storeIds)
      .eq('reserved_date', today)
      .in('status', ['pending', 'confirmed', 'waiting', 'arrived', 'seated'])
      .order('start_at')
      .limit(8),
    supabase
      .from('daily_closings')
      .select('business_date, sales_total')
      .in('store_id', storeIds)
      .gte('business_date', daysAgoJst(30))
      .order('business_date'),
    collectDashboardAlerts(supabase, ctx.organizationId, [store], false),
  ]);

  const todayOrders = todayOrdersRes.data ?? [];
  const todaySales = todayOrders.filter((o) => o.status === 'paid').reduce((a, o) => a + o.total, 0);
  const todayCount = todayOrders.filter((o) => o.status === 'paid').length;
  const todayGuests = todayOrders.reduce((a, o) => a + o.guest_count, 0);
  const avgSpend = todayGuests > 0 ? Math.floor(todaySales / todayGuests) : 0;

  const byDate = new Map<string, number>();
  for (const c of closingsRes.data ?? []) byDate.set(c.business_date, (byDate.get(c.business_date) ?? 0) + c.sales_total);
  const chartData: DailyPoint[] = [...byDate.entries()].map(([date, sales]) => ({
    date: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
    sales,
  }));

  return (
    <div>
      <PageHeader title="ダッシュボード" description={`${store.name}｜${today.replaceAll('-', '/')}（${weekdayJa(today)}）の状況`} />

      {setupPercent != null && <SetupProgressCard percent={setupPercent} />}
      <AnnouncementBanner supabase={supabase} organizationId={ctx.organizationId} userId={ctx.userId} storeIds={storeIds} />
      <AlertList alerts={alerts} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <LinkStatCard href="/app/orders" label="本日売上" value={yen(todaySales)} tone="primary" />
        <LinkStatCard href="/app/orders" label="会計件数" value={`${todayCount}件`} />
        <LinkStatCard href="/app/orders" label="客数" value={`${todayGuests}名`} />
        <LinkStatCard href="/app/reports" label="客単価" value={yen(avgSpend)} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>売上推移（過去30日）</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <EmptyState title="売上データがまだありません" description="レジ締めを行うと日次売上が記録されます" />
            ) : (
              <Link href="/app/reports" className="block">
                <SalesChart data={chartData} />
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>本日の予約</CardTitle>
            <Link href="/app/reservations" className="text-xs font-medium text-primary hover:underline">
              台帳を見る
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {(todayReservationsRes.data ?? []).length === 0 ? (
              <div className="p-5">
                <EmptyState title="本日の予約はありません" className="border-0 py-8" />
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {(todayReservationsRes.data ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy">
                        {formatTime(r.start_at)}　{r.guest_name} 様
                      </p>
                      <p className="text-xs text-gray-500">{r.party_size}名</p>
                    </div>
                    <Badge tone={r.status === 'seated' ? 'success' : 'primary'}>{r.status === 'seated' ? '着席中' : '予約'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
