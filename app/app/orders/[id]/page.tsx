import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { yen, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/state';
import { buttonVariants } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { OrderStatusBadge } from '@/components/orders/status-badge';
import { METHOD_LABELS } from '@/components/cash/labels';
import { RefundDialog } from '@/components/orders/refund-dialog';
import { refundOrder } from '../actions';

export const metadata: Metadata = { title: '注文詳細' };

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: '店内',
  takeout: 'テイクアウト',
  delivery: 'デリバリー',
  course: 'コース',
  pre_order: '事前注文',
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMember();
  const supabase = await createClient();

  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, order_no, order_type, status, guest_count, subtotal, tax_total, service_charge, discount_total, discount_reason, total, opened_at, closed_at, store_id, restaurant_tables(name), profiles(display_name), customers(name)'
    )
    .eq('id', id)
    .single();

  if (!order || (!ctx.isHq && !ctx.stores.some((s) => s.id === order.store_id))) {
    return (
      <div>
        <EmptyState
          title="注文が見つかりません"
          action={
            <Link href="/app/orders" className="text-sm font-medium text-primary hover:underline">
              一覧へ戻る
            </Link>
          }
        />
      </div>
    );
  }

  const [{ data: items }, { data: payments }, { data: refunds }] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, name, unit_price, quantity, line_total, status, cancel_reason')
      .eq('order_id', id)
      .order('created_at'),
    supabase
      .from('payments')
      .select('id, method, amount, tendered, change_amount, paid_at, status')
      .eq('order_id', id)
      .order('paid_at'),
    supabase
      .from('refunds')
      .select('id, amount, method, reason, refunded_at')
      .eq('order_id', id)
      .order('refunded_at'),
  ]);

  const totalPaid = (payments ?? [])
    .filter((p) => p.status === 'completed')
    .reduce((a, p) => a + p.amount, 0);
  const totalRefunded = (refunds ?? []).reduce((a, r) => a + r.amount, 0);
  const refundable = Math.max(0, totalPaid - totalRefunded);

  const table = order.restaurant_tables as unknown as { name: string } | null;
  const staff = order.profiles as unknown as { display_name: string } | null;
  const customer = order.customers as unknown as { name: string } | null;

  return (
    <div>
      <div className="mb-4">
        <Link href="/app/orders" className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-primary">
          <ArrowLeft className="h-4 w-4" />
          注文・取引履歴へ戻る
        </Link>
      </div>

      <PageHeader
        title={`注文 #${order.order_no}`}
        description={`${table?.name ?? ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}｜${formatDateTime(order.opened_at)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            {order.status === 'open' && (
              <Link href={`/app/pos?order=${order.id}`} className={cn(buttonVariants({ variant: 'primary' }))}>
                POSで開く
              </Link>
            )}
            {order.status !== 'open' && (
              <Link href={`/app/pos/receipt/${order.id}`} className={cn(buttonVariants({ variant: 'secondary' }))}>
                レシートを表示
              </Link>
            )}
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>品目明細</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>品名</Th>
                      <Th className="text-right">単価</Th>
                      <Th className="text-right">数量</Th>
                      <Th className="text-right">金額</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {(items ?? []).map((it) => (
                      <Tr key={it.id}>
                        <Td className={it.status === 'cancelled' ? 'text-gray-400 line-through' : ''}>
                          {it.name}
                          {it.status === 'cancelled' && it.cancel_reason && (
                            <span className="ml-2 text-xs text-danger no-underline">（取消: {it.cancel_reason}）</span>
                          )}
                        </Td>
                        <Td className={cn('text-right tabular-nums', it.status === 'cancelled' && 'text-gray-400 line-through')}>
                          {yen(it.unit_price)}
                        </Td>
                        <Td className={cn('text-right tabular-nums', it.status === 'cancelled' && 'text-gray-400 line-through')}>
                          {it.quantity}
                        </Td>
                        <Td className={cn('text-right tabular-nums', it.status === 'cancelled' && 'text-gray-400 line-through')}>
                          {yen(it.line_total)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>支払</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(payments ?? []).length === 0 ? (
                <div className="p-5">
                  <EmptyState title="支払記録がありません" className="border-0 py-6" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>方法</Th>
                        <Th className="text-right">金額</Th>
                        <Th className="text-right">預り金</Th>
                        <Th className="text-right">お釣り</Th>
                        <Th>日時</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {(payments ?? []).map((p) => (
                        <Tr key={p.id}>
                          <Td>{METHOD_LABELS[p.method] ?? p.method}</Td>
                          <Td className="text-right tabular-nums">{yen(p.amount)}</Td>
                          <Td className="text-right tabular-nums">{p.tendered != null ? yen(p.tendered) : '—'}</Td>
                          <Td className="text-right tabular-nums">{p.change_amount != null ? yen(p.change_amount) : '—'}</Td>
                          <Td className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(p.paid_at)}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          {(refunds ?? []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>返金履歴</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>方法</Th>
                        <Th className="text-right">金額</Th>
                        <Th>理由</Th>
                        <Th>日時</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {(refunds ?? []).map((r) => (
                        <Tr key={r.id}>
                          <Td>{METHOD_LABELS[r.method] ?? r.method}</Td>
                          <Td className="text-right tabular-nums">{yen(r.amount)}</Td>
                          <Td>{r.reason}</Td>
                          <Td className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(r.refunded_at)}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>会計情報</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>担当</span>
                <span>{staff?.display_name ?? '—'}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>客数</span>
                <span>{order.guest_count}名</span>
              </div>
              {customer && (
                <div className="flex justify-between text-gray-600">
                  <span>顧客</span>
                  <span>{customer.name}</span>
                </div>
              )}
              <div className="my-2 border-t border-gray-100" />
              <div className="flex justify-between text-gray-600">
                <span>小計</span>
                <span className="tabular-nums">{yen(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>消費税</span>
                <span className="tabular-nums">{yen(order.tax_total)}</span>
              </div>
              {order.service_charge > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>サービス料</span>
                  <span className="tabular-nums">{yen(order.service_charge)}</span>
                </div>
              )}
              {order.discount_total > 0 && (
                <div className="flex justify-between text-warning">
                  <span>値引き{order.discount_reason ? `（${order.discount_reason}）` : ''}</span>
                  <span className="tabular-nums">-{yen(order.discount_total)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-100 pt-1.5 text-base font-bold text-navy">
                <span>合計</span>
                <span className="tabular-nums">{yen(order.total)}</span>
              </div>
              {totalRefunded > 0 && (
                <div className="flex justify-between text-danger">
                  <span>返金済み</span>
                  <span className="tabular-nums">-{yen(totalRefunded)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {can(ctx.role, 'pos.refund') && ['paid', 'refunded'].includes(order.status) && (
            <Card>
              <CardHeader>
                <CardTitle>返金</CardTitle>
              </CardHeader>
              <CardContent>
                {refundable <= 0 ? (
                  <p className="text-sm text-gray-500">これ以上返金できる金額はありません</p>
                ) : (
                  <RefundDialog orderId={order.id} refundable={refundable} refundOrderAction={refundOrder} />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
