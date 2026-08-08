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
import { Badge } from '@/components/ui/badge';
import { OrderStatusBadge } from '@/components/orders/status-badge';
import { METHOD_LABELS } from '@/components/cash/labels';
import { RefundDialog, type RefundableItem, type PaymentMethodBreakdown } from '@/components/orders/refund-dialog';
import { ReopenDialog } from '@/components/orders/reopen-dialog';
import { JournalSourceLink } from '@/components/accounting/journal-source-link';
import { refundOrder, reopenOrder, type RefundMethod } from '../actions';

const REFUND_KIND_LABELS: Record<string, string> = { refund: '返金', void: '取消（VOID）' };

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
      'id, order_no, order_type, status, guest_count, subtotal, tax_total, service_charge, discount_total, discount_reason, total, opened_at, closed_at, created_at, store_id, source_order_id, reservation_id, customer_id, restaurant_tables(name), profiles(display_name), customers(name)'
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

  const [{ data: items }, { data: payments }, { data: refunds }, { data: sourceOrder }, { data: derivedOrders }] =
    await Promise.all([
      supabase
        .from('order_items')
        .select('id, name, unit_price, quantity, line_total, status, cancel_reason')
        .eq('order_id', id)
        .order('created_at'),
      supabase
        .from('payments')
        .select('id, method, amount, tendered, change_amount, paid_at, status, business_date')
        .eq('order_id', id)
        .order('paid_at'),
      supabase
        .from('refunds')
        .select('id, amount, method, reason, refunded_at, kind, business_date')
        .eq('order_id', id)
        .order('refunded_at'),
      order.source_order_id
        ? supabase.from('orders').select('id, order_no, status').eq('id', order.source_order_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('orders').select('id, order_no, status').eq('source_order_id', id).order('created_at'),
    ]);

  // ---- 取引トレース用の追加データ（予約・在庫移動・ポイント）----
  const [{ data: reservation }, { data: stockMovements }, { data: pointTransactions }] = await Promise.all([
    order.reservation_id
      ? supabase
          .from('reservations')
          .select('id, code, guest_name, party_size, start_at, created_at')
          .eq('id', order.reservation_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, occurred_at, inventory_items(name)')
      .eq('ref_order_id', id)
      .in('movement_type', ['sale', 'return'])
      .order('occurred_at'),
    supabase
      .from('point_transactions')
      .select('id, kind, points, balance_after, note, created_at')
      .eq('order_id', id)
      .order('created_at'),
  ]);

  const refundIds = (refunds ?? []).map((r) => r.id);
  const { data: refundItemRows } =
    refundIds.length > 0
      ? await supabase
          .from('refund_items')
          .select('id, refund_id, order_item_id, quantity, amount, restock')
          .in('refund_id', refundIds)
      : { data: [] as { id: string; refund_id: string; order_item_id: string; quantity: number; amount: number; restock: boolean }[] };

  const totalPaid = (payments ?? [])
    .filter((p) => p.status === 'completed')
    .reduce((a, p) => a + p.amount, 0);
  const totalRefunded = (refunds ?? []).reduce((a, r) => a + r.amount, 0);
  const refundable = Math.max(0, totalPaid - totalRefunded);

  // 支払方法別の内訳（返金ダイアログの「返金元の確認UX」用）。
  // 支払済み(completed)・返金済みをmethod別に集計し、混合支払（現金+カード+ポイント等）でも
  // どの方法にいくら残額があるかを一目で確認できるようにする。
  const paidByMethod = new Map<string, number>();
  for (const p of (payments ?? []).filter((p) => p.status === 'completed')) {
    paidByMethod.set(p.method, (paidByMethod.get(p.method) ?? 0) + p.amount);
  }
  const refundedByMethod = new Map<string, number>();
  for (const r of refunds ?? []) {
    refundedByMethod.set(r.method, (refundedByMethod.get(r.method) ?? 0) + r.amount);
  }
  const paymentBreakdown: PaymentMethodBreakdown[] = [...new Set([...paidByMethod.keys(), ...refundedByMethod.keys()])].map(
    (method) => ({
      method: method as RefundMethod,
      paid: paidByMethod.get(method) ?? 0,
      refunded: refundedByMethod.get(method) ?? 0,
    })
  );
  const canReopen = can(ctx.role, 'pos.refund') && ['paid', 'refunded'].includes(order.status);
  const fullyRefunded = order.status === 'refunded' && refundable === 0 && totalPaid > 0;
  const openDerived = (derivedOrders ?? []).find((d) => d.status === 'open');
  const hasVoid = (refunds ?? []).some((r) => r.kind === 'void');
  const isSettled = order.status === 'paid' || order.status === 'refunded';

  // 品目ごとの返金済み数量・金額（商品単位返金のrefund_itemsのみ。金額指定返金は品目に紐付かない）
  const refundedByItem = new Map<string, { qty: number; amount: number }>();
  for (const ri of refundItemRows ?? []) {
    const cur = refundedByItem.get(ri.order_item_id) ?? { qty: 0, amount: 0 };
    cur.qty += Number(ri.quantity);
    cur.amount += ri.amount;
    refundedByItem.set(ri.order_item_id, cur);
  }
  // 返金ごとの品目内訳（返金履歴の表示用）
  const itemRowsByRefund = new Map<string, typeof refundItemRows>();
  for (const ri of refundItemRows ?? []) {
    const arr = itemRowsByRefund.get(ri.refund_id) ?? [];
    arr.push(ri);
    itemRowsByRefund.set(ri.refund_id, arr);
  }
  const itemNameById = new Map((items ?? []).map((it) => [it.id, it.name]));

  // 返金ダイアログ用: 未返金の残数量・残額が残っているactive品目のみ（line_totalベースの単価で按分）
  const refundableItems: RefundableItem[] = (items ?? [])
    .filter((it) => it.status === 'active')
    .map((it) => {
      const already = refundedByItem.get(it.id) ?? { qty: 0, amount: 0 };
      return {
        orderItemId: it.id,
        name: it.name,
        remainingQty: Number(it.quantity) - already.qty,
        remainingAmount: it.line_total - already.amount,
      };
    })
    .filter((it) => it.remainingQty > 0.0001 && it.remainingAmount > 0);

  const table = order.restaurant_tables as unknown as { name: string } | null;
  const staff = order.profiles as unknown as { display_name: string } | null;
  const customer = order.customers as unknown as { name: string } | null;

  // 会計連動: 売上・返金の仕訳は日次・店舗単位の集計（{storeId}:{businessDate}）のため、
  // この注文の完了済み支払／返金の営業日から該当する集計仕訳が存在するかを確認する。
  const businessDates = [...new Set((payments ?? []).filter((p) => p.status === 'completed').map((p) => p.business_date as string))];
  const refundBusinessDates = [...new Set((refunds ?? []).map((r) => r.business_date as string))];
  let journaledDates: string[] = [];
  type JournalRow = { id: string; source_type: string; source_id: string; entry_date: string; posted_at: string | null; created_at: string };
  let matchedJournalRows: JournalRow[] = [];
  const salesSourceIds = businessDates.map((d) => `${order.store_id}:${d}`);
  const refundSourceIds = refundBusinessDates.map((d) => `${order.store_id}:${d}`);
  const [{ data: matchedSalesJournals }, { data: matchedRefundJournals }] = await Promise.all([
    salesSourceIds.length > 0
      ? supabase
          .from('journal_entries')
          .select('id, source_type, source_id, entry_date, posted_at, created_at')
          .eq('organization_id', ctx.organizationId)
          .eq('source_type', 'pos_sales')
          .in('source_id', salesSourceIds)
      : Promise.resolve({ data: [] as JournalRow[] }),
    refundSourceIds.length > 0
      ? supabase
          .from('journal_entries')
          .select('id, source_type, source_id, entry_date, posted_at, created_at')
          .eq('organization_id', ctx.organizationId)
          .eq('source_type', 'pos_refund')
          .in('source_id', refundSourceIds)
      : Promise.resolve({ data: [] as JournalRow[] }),
  ]);
  matchedJournalRows = [...(matchedSalesJournals ?? []), ...(matchedRefundJournals ?? [])];
  journaledDates = businessDates.filter((d) =>
    (matchedSalesJournals ?? []).some((j) => j.source_id === `${order.store_id}:${d}`)
  );

  // ---- 取引トレース: 予約→注文作成→支払→返金→在庫移動→仕訳→ポイントを時系列で一覧化 ----
  interface TraceEvent {
    key: string;
    category: string;
    label: string;
    detail: string;
    timestamp: string;
    href?: string | null;
  }
  const traceEvents: TraceEvent[] = [];
  if (reservation) {
    traceEvents.push({
      key: `reservation-${reservation.id}`,
      category: '予約',
      label: `予約 ${reservation.code}`,
      detail: `${reservation.guest_name} 様・${reservation.party_size}名`,
      timestamp: reservation.created_at,
    });
  }
  traceEvents.push({
    key: `order-created-${order.id}`,
    category: '注文作成',
    label: `注文 #${order.order_no} 作成`,
    detail: `${ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}・客数${order.guest_count}名`,
    timestamp: order.created_at,
  });
  for (const p of payments ?? []) {
    traceEvents.push({
      key: `payment-${p.id}`,
      category: '支払',
      label: `${METHOD_LABELS[p.method] ?? p.method}で支払`,
      detail: `${yen(p.amount)}${p.status !== 'completed' ? `（${p.status}）` : ''}`,
      timestamp: p.paid_at,
    });
  }
  for (const r of refunds ?? []) {
    traceEvents.push({
      key: `refund-${r.id}`,
      category: r.kind === 'void' ? '取消' : '返金',
      label: `${METHOD_LABELS[r.method] ?? r.method}へ${r.kind === 'void' ? '取消' : '返金'}`,
      detail: `${yen(r.amount)}・理由: ${r.reason}`,
      timestamp: r.refunded_at,
    });
  }
  const stockMovementLabels: Record<string, string> = { sale: '販売による在庫減', return: '返品による在庫戻し' };
  for (const m of stockMovements ?? []) {
    const inv = m.inventory_items as unknown as { name: string } | null;
    traceEvents.push({
      key: `stock-${m.id}`,
      category: '在庫移動',
      label: stockMovementLabels[m.movement_type] ?? m.movement_type,
      detail: `${inv?.name ?? '不明な品目'}　数量 ${m.quantity}`,
      timestamp: m.occurred_at,
      href: '/app/inventory',
    });
  }
  for (const j of matchedJournalRows) {
    traceEvents.push({
      key: `journal-${j.id}`,
      category: '仕訳',
      label: j.source_type === 'pos_refund' ? '返金仕訳（日次集計）' : '売上仕訳（日次集計）',
      detail: `${j.source_id}`,
      timestamp: j.posted_at ?? j.created_at,
      href: `/app/accounting?source_type=${j.source_type}&source_id=${encodeURIComponent(j.source_id)}`,
    });
  }
  const pointKindLabels: Record<string, string> = {
    earn: 'ポイント付与',
    redeem: 'ポイント利用',
    revoke: 'ポイント取消',
    refund_return: 'ポイント返却',
    adjust: 'ポイント調整',
    expire: 'ポイント失効',
  };
  for (const pt of pointTransactions ?? []) {
    traceEvents.push({
      key: `point-${pt.id}`,
      category: 'ポイント',
      label: pointKindLabels[pt.kind] ?? pt.kind,
      detail: `${pt.points > 0 ? '+' : ''}${pt.points}pt（残高 ${pt.balance_after}pt）${pt.note ? `・${pt.note}` : ''}`,
      timestamp: pt.created_at,
      href: order.customer_id ? `/app/customers/${order.customer_id}` : null,
    });
  }
  traceEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

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
            {hasVoid && <Badge tone="gray">取消（VOID）あり</Badge>}
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
                        <Th>区分</Th>
                        <Th>方法</Th>
                        <Th className="text-right">金額</Th>
                        <Th>明細内訳</Th>
                        <Th>在庫戻し</Th>
                        <Th>理由</Th>
                        <Th>日時</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {(refunds ?? []).map((r) => {
                        const refundItemRowsForR = itemRowsByRefund.get(r.id) ?? [];
                        const anyRestocked = refundItemRowsForR.some((ri) => ri.restock);
                        return (
                          <Tr key={r.id}>
                            <Td>
                              <Badge tone={r.kind === 'void' ? 'gray' : 'primary'}>
                                {REFUND_KIND_LABELS[r.kind] ?? r.kind}
                              </Badge>
                            </Td>
                            <Td>{METHOD_LABELS[r.method] ?? r.method}</Td>
                            <Td className="text-right tabular-nums">{yen(r.amount)}</Td>
                            <Td className="text-xs text-gray-600">
                              {refundItemRowsForR.length > 0 ? (
                                <ul className="space-y-0.5">
                                  {refundItemRowsForR.map((ri) => (
                                    <li key={ri.id}>
                                      {itemNameById.get(ri.order_item_id) ?? '（削除済み品目）'}×{ri.quantity}
                                      {ri.restock && <span className="ml-1 text-primary">（在庫戻し）</span>}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                '—（金額指定）'
                              )}
                            </Td>
                            <Td className="text-xs">
                              {refundItemRowsForR.length === 0 ? '—' : anyRestocked ? 'あり' : 'なし'}
                            </Td>
                            <Td>{r.reason}</Td>
                            <Td className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(r.refunded_at)}</Td>
                          </Tr>
                        );
                      })}
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
                <span>{isSettled ? '総売上（元取引）' : '合計'}</span>
                <span className="tabular-nums">{yen(order.total)}</span>
              </div>
              {isSettled && (
                <>
                  <div className="flex justify-between text-danger">
                    <span>返金合計{hasVoid ? '（取消含む）' : ''}</span>
                    <span className="tabular-nums">{totalRefunded > 0 ? `-${yen(totalRefunded)}` : yen(0)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 pt-1.5 text-base font-bold text-navy">
                    <span>純売上</span>
                    <span className="tabular-nums">{yen(order.total - totalRefunded)}</span>
                  </div>
                </>
              )}
              {journaledDates.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                  {journaledDates.map((d) => (
                    <JournalSourceLink
                      key={d}
                      sourceType="pos_sales"
                      sourceId={`${order.store_id}:${d}`}
                      label={`会計仕訳を見る（${d}の売上仕訳）`}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {can(ctx.role, 'pos.refund') && ['paid', 'refunded'].includes(order.status) && (
            <Card>
              <CardHeader>
                <CardTitle>返金・取消</CardTitle>
              </CardHeader>
              <CardContent>
                {refundable <= 0 ? (
                  <p className="text-sm text-gray-500">これ以上返金できる金額はありません</p>
                ) : (
                  <RefundDialog
                    orderId={order.id}
                    refundable={refundable}
                    items={refundableItems}
                    paymentBreakdown={paymentBreakdown}
                    refundOrderAction={refundOrder}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {canReopen && (
            <Card>
              <CardHeader>
                <CardTitle>再会計</CardTitle>
              </CardHeader>
              <CardContent>
                {openDerived ? (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-500">
                      再会計伝票 #{openDerived.order_no} が作成済みです。
                    </p>
                    <Link
                      href={`/app/pos?order=${openDerived.id}`}
                      className={cn(buttonVariants({ variant: 'navy' }), 'w-full')}
                    >
                      POSで開く
                    </Link>
                  </div>
                ) : fullyRefunded ? (
                  <ReopenDialog orderId={order.id} reopenOrderAction={reopenOrder} />
                ) : (
                  <p className="text-sm text-gray-500">
                    再会計するには先に全額返金してください
                    {refundable > 0 && `（未返金 ${yen(refundable)}）`}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {(sourceOrder || (derivedOrders ?? []).length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>関連取引</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {sourceOrder && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">元取引</span>
                    <Link href={`/app/orders/${sourceOrder.id}`} className="font-medium text-primary hover:underline">
                      #{sourceOrder.order_no}
                    </Link>
                  </div>
                )}
                {(derivedOrders ?? []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between">
                    <span className="text-gray-500">派生取引</span>
                    <Link href={`/app/orders/${d.id}`} className="font-medium text-primary hover:underline">
                      #{d.order_no}
                    </Link>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>トレース（監査証跡）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {traceEvents.length === 0 ? (
            <div className="p-5">
              <EmptyState title="トレース対象のイベントがありません" className="border-0 py-6" />
            </div>
          ) : (
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>日時</Th>
                    <Th>区分</Th>
                    <Th>内容</Th>
                    <Th>詳細</Th>
                  </Tr>
                </THead>
                <TBody>
                  {traceEvents.map((ev) => (
                    <Tr key={ev.key}>
                      <Td className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(ev.timestamp)}</Td>
                      <Td>
                        <Badge tone="gray">{ev.category}</Badge>
                      </Td>
                      <Td className="font-medium text-navy">{ev.label}</Td>
                      <Td className="text-sm text-gray-600">
                        {ev.href ? (
                          <Link href={ev.href} className="text-primary hover:underline">
                            {ev.detail}
                          </Link>
                        ) : (
                          ev.detail
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
