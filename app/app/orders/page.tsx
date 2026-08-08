import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { yen, formatDateTime, todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { OrderStatusBadge } from '@/components/orders/status-badge';
import { Badge } from '@/components/ui/badge';
import { METHOD_LABELS } from '@/components/cash/labels';

export const metadata: Metadata = { title: '注文・取引履歴' };

const PAGE_SIZE = 50;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    status?: string;
    method?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFeature('pos');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="注文・取引履歴" />
        <EmptyState title="アクセス可能な店舗がありません" />
      </div>
    );
  }

  const today = todayJst();
  const from = sp.from || today;
  const to = sp.to || today;
  const status = sp.status || '';
  const method = sp.method || '';
  const q = (sp.q || '').trim();
  const page = Math.max(1, Number(sp.page) || 1);

  let orderIdsByMethod: string[] | null = null;
  if (method) {
    const { data: pays } = await supabase
      .from('payments')
      .select('order_id')
      .eq('store_id', store.id)
      .eq('method', method);
    orderIdsByMethod = [...new Set((pays ?? []).map((p) => p.order_id))];
  }

  let query = supabase
    .from('orders')
    .select(
      'id, order_no, opened_at, closed_at, status, total, order_type, restaurant_tables(name), profiles(display_name), order_items(id)',
      { count: 'exact' }
    )
    .eq('store_id', store.id)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('opened_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (orderIdsByMethod) query = query.in('id', orderIdsByMethod.length > 0 ? orderIdsByMethod : ['00000000-0000-0000-0000-000000000000']);
  const orderNoQuery = q.replace(/^#/, '');
  if (orderNoQuery && /^\d+$/.test(orderNoQuery)) query = query.eq('order_no', Number(orderNoQuery));

  const rangeFrom = (page - 1) * PAGE_SIZE;
  const { data: orders, count } = await query.range(rangeFrom, rangeFrom + PAGE_SIZE - 1);

  // 返金/取消バッジ・純額表示用（このページに表示される注文のみを対象にした軽量クエリ）
  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: refundRows } =
    orderIds.length > 0
      ? await supabase.from('refunds').select('order_id, amount, kind').in('order_id', orderIds)
      : { data: [] as { order_id: string; amount: number; kind: string }[] };
  const refundTotalByOrder = new Map<string, number>();
  const voidOrderIds = new Set<string>();
  for (const r of refundRows ?? []) {
    refundTotalByOrder.set(r.order_id, (refundTotalByOrder.get(r.order_id) ?? 0) + r.amount);
    if (r.kind === 'void') voidOrderIds.add(r.order_id);
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const buildHref = (p: number) => {
    const params = new URLSearchParams({ from, to, status, method, q, page: String(p) });
    return `/app/orders?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="注文・取引履歴"
        description={store.name}
        actions={
          can(ctx.role, 'csv.export') ? (
            <a
              href={`/app/orders/export?${new URLSearchParams({ from, to }).toString()}`}
              className={cn(buttonVariants({ variant: 'secondary' }))}
            >
              <Download className="h-4 w-4" />
              CSV出力
            </a>
          ) : undefined
        }
      />

      <Card className="mb-4 p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <Label htmlFor="from">開始日</Label>
            <Input id="from" type="date" name="from" defaultValue={from} />
          </div>
          <div>
            <Label htmlFor="to">終了日</Label>
            <Input id="to" type="date" name="to" defaultValue={to} />
          </div>
          <div>
            <Label htmlFor="status">状態</Label>
            <Select id="status" name="status" defaultValue={status}>
              <option value="">すべて</option>
              <option value="open">会計前</option>
              <option value="paid">会計済</option>
              <option value="refunded">返金済</option>
              <option value="cancelled">取消</option>
              <option value="void">無効</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="method">支払方法</Label>
            <Select id="method" name="method" defaultValue={method}>
              <option value="">すべて</option>
              {Object.entries(METHOD_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="q">注文番号</Label>
            <Input id="q" name="q" defaultValue={q} placeholder="#123" />
          </div>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              検索
            </Button>
          </div>
        </form>
      </Card>

      {(orders ?? []).length === 0 ? (
        <EmptyState title="該当する注文がありません" description="期間や条件を変更してお試しください" />
      ) : (
        <>
          <TableWrap>
            <Table>
              <THead>
                <Tr>
                  <Th>注文番号</Th>
                  <Th>日時</Th>
                  <Th>テーブル</Th>
                  <Th>担当</Th>
                  <Th className="text-right">品目数</Th>
                  <Th className="text-right">金額</Th>
                  <Th>状態</Th>
                </Tr>
              </THead>
              <TBody>
                {(orders ?? []).map((o) => {
                  const table = o.restaurant_tables as unknown as { name: string } | null;
                  const staff = o.profiles as unknown as { display_name: string } | null;
                  const itemCount = (o.order_items as unknown as { id: string }[] | null)?.length ?? 0;
                  const refundTotal = refundTotalByOrder.get(o.id) ?? 0;
                  const isVoided = voidOrderIds.has(o.id);
                  const isPartiallyRefunded = !isVoided && o.status === 'paid' && refundTotal > 0;
                  return (
                    <Tr key={o.id}>
                      <Td>
                        <Link href={`/app/orders/${o.id}`} className="font-medium text-primary hover:underline">
                          #{o.order_no}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(o.opened_at)}</Td>
                      <Td>{table?.name ?? '—'}</Td>
                      <Td>{staff?.display_name ?? '—'}</Td>
                      <Td className="text-right tabular-nums">{itemCount}</Td>
                      <Td className="text-right font-medium tabular-nums">
                        {yen(o.total)}
                        {refundTotal > 0 && (
                          <div className="text-xs font-normal text-danger">純額 {yen(o.total - refundTotal)}</div>
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1">
                          <OrderStatusBadge status={o.status} />
                          {isVoided && <Badge tone="gray">取消</Badge>}
                          {isPartiallyRefunded && <Badge tone="warning">一部返金あり</Badge>}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
              <span>
                {count ?? 0}件中 {rangeFrom + 1}〜{Math.min((count ?? 0), rangeFrom + PAGE_SIZE)}件
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={buildHref(page - 1)} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
                    前へ
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={buildHref(page + 1)} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
                    次へ
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
