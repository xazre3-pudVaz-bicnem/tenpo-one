import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { yen, todayJst, daysAgoJst, formatTime, weekdayJa } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { SalesChart, type DailyPoint } from '@/components/dashboard/sales-chart';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';

export const metadata: Metadata = { title: 'ダッシュボード' };

export default async function DashboardPage() {
  const ctx = await requireMember();
  const supabase = await createClient();
  const today = todayJst();
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  // 本日の実績（ordersからリアルタイム集計）
  const { data: todayOrders } = await supabase
    .from('orders')
    .select('total, guest_count, status, store_id')
    .in('store_id', storeIds)
    .eq('business_date', today)
    .in('status', ['paid', 'refunded']);

  const todaySales = (todayOrders ?? []).filter((o) => o.status === 'paid').reduce((a, o) => a + o.total, 0);
  const todayCount = (todayOrders ?? []).length;
  const todayGuests = (todayOrders ?? []).reduce((a, o) => a + o.guest_count, 0);
  const avgSpend = todayGuests > 0 ? Math.floor(todaySales / todayGuests) : 0;

  // 本日の予約
  const { data: todayReservations } = await supabase
    .from('reservations')
    .select('id, start_at, party_size, guest_name, status, store_id, stores(name)')
    .in('store_id', storeIds)
    .eq('reserved_date', today)
    .in('status', ['pending', 'confirmed', 'seated'])
    .order('start_at')
    .limit(8);

  // 過去30日の売上推移（daily_closings）
  const { data: closings } = await supabase
    .from('daily_closings')
    .select('business_date, sales_total, cash_difference, store_id')
    .in('store_id', storeIds)
    .gte('business_date', daysAgoJst(30))
    .order('business_date');

  const byDate = new Map<string, number>();
  for (const c of closings ?? []) {
    byDate.set(c.business_date, (byDate.get(c.business_date) ?? 0) + c.sales_total);
  }
  const chartData: DailyPoint[] = [...byDate.entries()].map(([date, sales]) => ({
    date: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
    sales,
  }));

  // アラート収集
  const alerts: { label: string; href: string; tone: 'warning' | 'danger' }[] = [];
  const yesterday = daysAgoJst(1);
  const { count: openSessions } = await supabase
    .from('register_sessions')
    .select('id', { count: 'exact', head: true })
    .in('store_id', storeIds)
    .eq('status', 'open')
    .lte('business_date', yesterday);
  if (openSessions) alerts.push({ label: `レジ締め未完了が${openSessions}件あります`, href: '/app/cash', tone: 'danger' });

  const diffDays = (closings ?? []).filter((c) => c.cash_difference !== 0).length;
  if (diffDays > 0) alerts.push({ label: `過去30日で現金差異が${diffDays}日発生しています`, href: '/app/cash', tone: 'warning' });

  const { count: overdueInvoices } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.organizationId)
    .lt('due_date', today)
    .in('status', ['open', 'review', 'approved', 'scheduled']);
  if (overdueInvoices) alerts.push({ label: `支払期限を過ぎた請求書が${overdueInvoices}件あります`, href: '/app/invoices', tone: 'danger' });

  const { count: pendingCash } = await supabase
    .from('cash_transactions')
    .select('id', { count: 'exact', head: true })
    .in('store_id', storeIds)
    .eq('approval_status', 'pending');
  if (pendingCash) alerts.push({ label: `承認待ちの小口現金が${pendingCash}件あります`, href: '/app/cash', tone: 'warning' });

  // 店舗比較（全店舗表示時のみ）
  let storeComparison: { name: string; sales: number; orders: number }[] = [];
  if (!ctx.currentStore && ctx.stores.length > 1) {
    storeComparison = ctx.stores.map((s) => {
      const rows = (todayOrders ?? []).filter((o) => o.store_id === s.id && o.status === 'paid');
      return { name: s.name, sales: rows.reduce((a, o) => a + o.total, 0), orders: rows.length };
    });
  }

  const scopeLabel = ctx.currentStore ? ctx.currentStore.name : '全店舗';

  return (
    <div>
      <PageHeader
        title="ダッシュボード"
        description={`${scopeLabel}｜${today.replaceAll('-', '/')}（${weekdayJa(today)}）の状況`}
      />

      {alerts.length > 0 && (
        <div className="mb-5 space-y-2">
          {alerts.map((a, i) => (
            <Link
              key={i}
              href={a.href}
              className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
                a.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
              }`}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {a.label}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="本日売上" value={yen(todaySales)} tone="primary" />
        <StatCard label="会計件数" value={`${todayCount}件`} />
        <StatCard label="客数" value={`${todayGuests}名`} />
        <StatCard label="客単価" value={yen(avgSpend)} />
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
              <SalesChart data={chartData} />
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
            {(todayReservations ?? []).length === 0 ? (
              <div className="p-5">
                <EmptyState title="本日の予約はありません" className="border-0 py-8" />
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {(todayReservations ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy">
                        {formatTime(r.start_at)}　{r.guest_name} 様
                      </p>
                      <p className="text-xs text-gray-500">
                        {r.party_size}名
                        {!ctx.currentStore && r.stores ? `｜${(r.stores as unknown as { name: string }).name}` : ''}
                      </p>
                    </div>
                    <Badge tone={r.status === 'seated' ? 'success' : 'primary'}>
                      {r.status === 'seated' ? '着席中' : '予約'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {storeComparison.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>店舗別 本日実績</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>店舗</Th>
                    <Th className="text-right">売上</Th>
                    <Th className="text-right">会計件数</Th>
                  </Tr>
                </THead>
                <TBody>
                  {storeComparison.map((s) => (
                    <Tr key={s.name}>
                      <Td className="font-medium text-navy">{s.name}</Td>
                      <Td className="text-right tabular-nums">{yen(s.sales)}</Td>
                      <Td className="text-right tabular-nums">{s.orders}件</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
