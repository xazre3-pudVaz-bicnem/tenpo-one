import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { HandyTableDetail, type HandySlip } from '@/components/handy/handy-table-detail';
import type { HandyServiceCall } from '@/components/handy/logic';
import { goToOrder, startWalkIn } from '../../floor/actions';
import { resolveServiceCall } from '../actions';

export const metadata: Metadata = { title: '卓の注文' };

/** 描画の基準時刻（リクエスト時点）。クライアントの時計のハイドレーション初期値にも使う */
function requestTime() {
  return Date.now();
}

interface OrderItemRow {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  modifiers: unknown;
}

/** order_items.modifiers（[{name, price}]）から表示用のラベルを作る */
function modifierLabel(modifiers: unknown): string | null {
  if (!Array.isArray(modifiers) || modifiers.length === 0) return null;
  const names = modifiers
    .map((m) => (m && typeof m === 'object' && 'name' in m ? String((m as { name: unknown }).name) : ''))
    .filter(Boolean);
  return names.length > 0 ? names.join('・') : null;
}

export default async function HandyTablePage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.order')) {
    return (
      <div>
        <PageHeader title="卓の注文" en="Table" />
        <EmptyState title="この画面は利用できません" description="店舗の割り当てと注文権限を確認してください" />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, name, capacity_max, current_status, store_id')
    .eq('id', tableId)
    // 削除・無効化した卓はURL直打ちでも開かせない（一覧と同じ条件）
    .eq('status', 'active')
    .maybeSingle();

  if (!table || table.store_id !== store.id) {
    return (
      <div>
        <PageHeader title="卓の注文" en="Table" />
        <EmptyState
          title="テーブルが見つかりません"
          description="このテーブルは存在しないか、現在の店舗からアクセスできません"
          action={
            <Link href="/app/handy" className="text-sm font-medium text-primary hover:underline">
              テーブル一覧へ戻る
            </Link>
          }
        />
      </div>
    );
  }

  const [{ data: orders }, { data: calls }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_no, guest_count, opened_at, subtotal, tax_total, discount_total, total')
      .eq('table_id', tableId)
      .eq('status', 'open')
      .order('opened_at'),
    supabase
      .from('service_calls')
      .select('id, table_id, kind, note, created_at')
      .eq('table_id', tableId)
      .eq('status', 'open')
      .order('created_at'),
  ]);

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: itemRows } = orderIds.length
    ? await supabase
        .from('order_items')
        .select('id, order_id, name, quantity, unit_price, line_total, modifiers')
        .in('order_id', orderIds)
        .eq('status', 'active')
        .order('created_at')
    : { data: [] as (OrderItemRow & { order_id: string })[] };

  const itemsByOrder = new Map<string, OrderItemRow[]>();
  for (const row of (itemRows ?? []) as (OrderItemRow & { order_id: string })[]) {
    const list = itemsByOrder.get(row.order_id) ?? [];
    list.push(row);
    itemsByOrder.set(row.order_id, list);
  }

  const slips: HandySlip[] = (orders ?? []).map((o) => ({
    id: o.id,
    orderNo: o.order_no,
    guestCount: o.guest_count,
    openedAtMs: new Date(o.opened_at).getTime(),
    subtotal: Number(o.subtotal ?? 0),
    discountTotal: Number(o.discount_total ?? 0),
    total: Number(o.total ?? 0),
    items: (itemsByOrder.get(o.id) ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price ?? 0),
      lineTotal: Number(i.line_total ?? 0),
      optionLabel: modifierLabel(i.modifiers),
    })),
  }));

  const serviceCalls: HandyServiceCall[] = (calls ?? []).map((c) => ({
    id: c.id,
    tableId: c.table_id,
    tableName: table.name,
    kind: c.kind === 'checkout' ? 'checkout' : 'staff',
    createdAtMs: new Date(c.created_at).getTime(),
    note: c.note,
  }));

  return (
    <HandyTableDetail
      storeId={store.id}
      table={{
        id: table.id,
        name: table.name,
        capacityMax: table.capacity_max,
        currentStatus: table.current_status,
      }}
      slips={slips}
      calls={serviceCalls}
      serverNow={requestTime()}
      goToOrderAction={goToOrder}
      startWalkInAction={startWalkIn}
      resolveServiceCallAction={resolveServiceCall}
    />
  );
}
