import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { yen, todayJst, daysAgoJst, formatTime, weekdayJa } from '@/lib/format';
import { METHOD_LABELS } from '@/components/cash/labels';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { PeriodLinks, type PeriodPreset } from '@/components/reports/period-links';
import { DailySalesChart } from '@/components/reports/daily-sales-chart';
import { HourlySalesChart } from '@/components/reports/hourly-sales-chart';
import { WeekdaySalesChart } from '@/components/reports/weekday-sales-chart';
import { PaymentMethodChart } from '@/components/reports/payment-method-chart';
import { CategorySalesChart } from '@/components/reports/category-sales-chart';

export const metadata: Metadata = { title: 'レポート' };

const WEEKDAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];

function monthBounds(offsetMonths: number, todayStr: string) {
  const [y, m] = todayStr.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { first: first.toISOString().slice(0, 10), last: last.toISOString().slice(0, 10) };
}

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

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await requirePermission('reports.view');

  const sp = await searchParams;
  const today = todayJst();
  let from = sp.from || daysAgoJst(29);
  let to = sp.to || today;
  if (from > to) [from, to] = [to, from];
  const spanDays = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
  if (spanDays > 366) {
    from = new Date(new Date(`${to}T00:00:00Z`).getTime() - 366 * 86400000).toISOString().slice(0, 10);
  }

  const thisMonth = monthBounds(0, today);
  const lastMonth = monthBounds(-1, today);
  const presets: PeriodPreset[] = [
    { label: '今日', from: today, to: today },
    { label: '7日', from: daysAgoJst(6), to: today },
    { label: '30日', from: daysAgoJst(29), to: today },
    { label: '今月', from: thisMonth.first, to: today },
    { label: '先月', from: lastMonth.first, to: lastMonth.last },
  ];

  const supabase = await createClient();
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
  const scopeLabel = ctx.currentStore ? ctx.currentStore.name : '全店舗';

  if (storeIds.length === 0) {
    return (
      <div>
        <PageHeader title="レポート" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗の割り当てを依頼してください" />
      </div>
    );
  }

  const [{ data: orders }, { data: reservations }, { data: payments }, { data: orderItems }, { data: menuCategories }] =
    await Promise.all([
      supabase
        .from('orders')
        .select('id, total, guest_count, status, store_id, staff_id, discount_total, business_date, opened_at')
        .in('store_id', storeIds)
        .gte('business_date', from)
        .lte('business_date', to)
        .in('status', ['paid', 'refunded']),
      supabase
        .from('reservations')
        .select('id, status, created_via, store_id, reservation_sources(name)')
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
    ]);

  const allOrders = orders ?? [];
  const paidOrders = allOrders.filter((o) => o.status === 'paid');
  const allReservations = reservations ?? [];
  const allOrderItems = orderItems ?? [];
  const categoryNameById = new Map((menuCategories ?? []).map((c) => [c.id, c.name]));

  // ---- KPI ----
  const salesTotal = paidOrders.reduce((a, o) => a + o.total, 0);
  const transactionCount = allOrders.length;
  const guestCount = allOrders.reduce((a, o) => a + o.guest_count, 0);
  const avgSpend = guestCount > 0 ? Math.floor(salesTotal / guestCount) : 0;
  const discountTotal = paidOrders.reduce((a, o) => a + o.discount_total, 0);

  const reservationCount = allReservations.length;
  const reservationCancelled = allReservations.filter((r) => r.status === 'cancelled' || r.status === 'no_show').length;
  const reservationCancelRate = reservationCount > 0 ? (reservationCancelled / reservationCount) * 100 : 0;
  const walkInCount = allReservations.filter((r) => r.created_via === 'walk_in').length;

  let profitableRevenue = 0;
  let totalCost = 0;
  let hasExcludedCost = false;
  for (const oi of allOrderItems) {
    const mi = oi.menu_items as unknown as { cost: number | null } | null;
    if (mi?.cost != null) {
      profitableRevenue += oi.line_total;
      totalCost += mi.cost * oi.quantity;
    } else {
      hasExcludedCost = true;
    }
  }
  const grossProfit = profitableRevenue - totalCost;
  const grossMargin = profitableRevenue > 0 ? (grossProfit / profitableRevenue) * 100 : 0;

  // ---- 日別売上 ----
  const salesByDate = new Map<string, number>();
  for (const o of paidOrders) salesByDate.set(o.business_date, (salesByDate.get(o.business_date) ?? 0) + o.total);
  const dailyRows = dateSequence(from, to).map((date) => ({ date, sales: salesByDate.get(date) ?? 0 }));
  const dailyChartData = dailyRows.map((r) => ({ date: `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`, sales: r.sales }));

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
    const existing = productMap.get(key);
    const lineCost = mi?.cost != null ? mi.cost * oi.quantity : null;
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
    staffIds.length > 0 ? await supabase.from('profiles').select('id, display_name').in('id', staffIds) : { data: [] as { id: string; display_name: string }[] };
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
  const sourceAgg = new Map<string, { total: number; completed: number; cancelled: number }>();
  for (const r of allReservations) {
    const src = (r.reservation_sources as unknown as { name: string } | null)?.name ?? '未設定';
    const cur = sourceAgg.get(src) ?? { total: 0, completed: 0, cancelled: 0 };
    cur.total += 1;
    if (r.status === 'completed') cur.completed += 1;
    if (r.status === 'cancelled' || r.status === 'no_show') cur.cancelled += 1;
    sourceAgg.set(src, cur);
  }
  const sourceRows = [...sourceAgg.entries()]
    .map(([name, v]) => ({
      name,
      total: v.total,
      completionRate: v.total > 0 ? (v.completed / v.total) * 100 : 0,
      cancelRate: v.total > 0 ? (v.cancelled / v.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // ---- 店舗別比較（全店舗表示時のみ）----
  let storeComparison: { name: string; sales: number; count: number; guests: number }[] = [];
  if (!ctx.currentStore && ctx.stores.length > 1) {
    storeComparison = ctx.stores.map((s) => {
      const storeOrders = allOrders.filter((o) => o.store_id === s.id);
      const storePaid = storeOrders.filter((o) => o.status === 'paid');
      return {
        name: s.name,
        sales: storePaid.reduce((a, o) => a + o.total, 0),
        count: storeOrders.length,
        guests: storeOrders.reduce((a, o) => a + o.guest_count, 0),
      };
    });
  }

  return (
    <div>
      <PageHeader
        title="レポート・経営分析"
        description={`${scopeLabel}｜${from.replaceAll('-', '/')}〜${to.replaceAll('-', '/')}の実績`}
        actions={
          can(ctx.role, 'csv.export') && (
            <a href={`/app/reports/export?from=${from}&to=${to}`} className={buttonVariants({ variant: 'secondary' })}>
              CSV出力
            </a>
          )
        }
      />

      <PeriodLinks basePath="/app/reports" presets={presets} currentFrom={from} currentTo={to} />

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="売上" value={yen(salesTotal)} tone="primary" />
        <StatCard label="会計件数" value={`${transactionCount.toLocaleString('ja-JP')}件`} />
        <StatCard label="客数" value={`${guestCount.toLocaleString('ja-JP')}名`} />
        <StatCard label="客単価" value={yen(avgSpend)} />
        <StatCard label="予約数" value={`${reservationCount.toLocaleString('ja-JP')}件`} />
        <StatCard
          label="予約キャンセル率"
          value={`${reservationCancelRate.toFixed(1)}%`}
          tone={reservationCancelRate > 0 ? 'warning' : 'default'}
          sub={`${reservationCancelled}件`}
        />
        <StatCard label="ウォークイン数" value={`${walkInCount.toLocaleString('ja-JP')}件`} />
        <StatCard label="値引き額合計" value={yen(discountTotal)} />
        <StatCard label="粗利益" value={yen(grossProfit)} tone="success" />
        <StatCard label="粗利率" value={`${grossMargin.toFixed(1)}%`} />
      </div>
      {hasExcludedCost && <p className="mt-2 text-xs text-gray-500">※ 原価未設定品目は粗利計算から除外しています</p>}

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>日別売上推移</CardTitle>
          </CardHeader>
          <CardContent>
            {salesTotal === 0 ? (
              <EmptyState title="この期間の売上データがありません" className="border-0 py-10" />
            ) : (
              <DailySalesChart data={dailyChartData} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>支払方法別構成</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentChartData.length === 0 ? (
              <EmptyState title="支払データがありません" className="border-0 py-10" />
            ) : (
              <PaymentMethodChart data={paymentChartData} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>時間帯別売上</CardTitle>
          </CardHeader>
          <CardContent>
            <HourlySalesChart data={hourlyChartData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>曜日別売上</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekdaySalesChart data={weekdayChartData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>カテゴリ別売上 TOP8</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryChartData.length === 0 ? (
              <EmptyState title="商品データがありません" className="border-0 py-10" />
            ) : (
              <CategorySalesChart data={categoryChartData} />
            )}
          </CardContent>
        </Card>
      </div>

      {storeComparison.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>店舗別比較</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>店舗</Th>
                    <Th className="text-right">売上</Th>
                    <Th className="text-right">会計件数</Th>
                    <Th className="text-right">客数</Th>
                  </Tr>
                </THead>
                <TBody>
                  {storeComparison.map((s) => (
                    <Tr key={s.name}>
                      <Td className="font-medium text-navy">{s.name}</Td>
                      <Td className="text-right tabular-nums">{yen(s.sales)}</Td>
                      <Td className="text-right tabular-nums">{s.count}件</Td>
                      <Td className="text-right tabular-nums">{s.guests}名</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>商品別売上 TOP20</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {productRows.length === 0 ? (
              <div className="p-5">
                <EmptyState title="商品データがありません" className="border-0 py-8" />
              </div>
            ) : (
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>商品名</Th>
                      <Th className="text-right">数量</Th>
                      <Th className="text-right">売上</Th>
                      <Th className="text-right">原価</Th>
                      <Th className="text-right">粗利</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {productRows.map((p) => (
                      <Tr key={p.key}>
                        <Td className="font-medium text-navy">{p.name}</Td>
                        <Td className="text-right tabular-nums">{p.quantity}</Td>
                        <Td className="text-right tabular-nums">{yen(p.revenue)}</Td>
                        <Td className="text-right tabular-nums">{p.cost == null ? '—' : yen(p.cost)}</Td>
                        <Td className="text-right tabular-nums">{p.cost == null ? '—' : yen(p.revenue - p.cost)}</Td>
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
            <CardTitle>スタッフ別売上</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {staffRows.length === 0 ? (
              <div className="p-5">
                <EmptyState title="スタッフ別データがありません" className="border-0 py-8" />
              </div>
            ) : (
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>スタッフ</Th>
                      <Th className="text-right">件数</Th>
                      <Th className="text-right">売上</Th>
                      <Th className="text-right">客単価</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {staffRows.map((s) => (
                      <Tr key={s.name}>
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
            <CardTitle>予約経路別</CardTitle>
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
                        <Td className="font-medium text-navy">{s.name}</Td>
                        <Td className="text-right tabular-nums">{s.total}件</Td>
                        <Td className="text-right tabular-nums">{s.completionRate.toFixed(1)}%</Td>
                        <Td className="text-right tabular-nums">{s.cancelRate.toFixed(1)}%</Td>
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
            <CardTitle>日別売上明細</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>日付</Th>
                    <Th className="text-right">売上</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {[...dailyRows].reverse().map((r) => (
                    <Tr key={r.date}>
                      <Td>
                        {r.date.replaceAll('-', '/')}（{weekdayJa(r.date)}）
                      </Td>
                      <Td className="text-right tabular-nums">{yen(r.sales)}</Td>
                      <Td>
                        <Link href={`/app/orders?from=${r.date}&to=${r.date}`} className="text-xs font-medium text-primary hover:underline">
                          明細を見る
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
