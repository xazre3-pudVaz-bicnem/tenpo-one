import { enqueueOrderSlipPrint } from '@/app/app/pos/print-actions';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { requireHandyClerk } from '@/lib/handy-session';
import { HandyBackButton, HandyMain, HandyTopBar } from '@/components/handy/handy-chrome';
import { HandyTableDetail, type HandySlip } from '@/components/handy/handy-table-detail';
import type { HandyServiceCall } from '@/components/handy/logic';
import { openHandyOrder, resolveServiceCall } from '@/app/app/handy/actions';

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

function notFound(message: string) {
  return (
    <>
      <HandyTopBar left={<HandyBackButton href="/handy" label="テーブル一覧" />} title="卓の注文" />
      <HandyMain>
        <p className="px-6 py-10 text-center text-[13px] leading-loose text-[#7f6e7a]">
          {message}
          <br />
          <Link href="/handy" className="font-bold text-[#9f2c6c] underline">
            テーブル一覧へ戻る
          </Link>
        </p>
      </HandyMain>
    </>
  );
}

export default async function HandyTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ sent?: string }>;
}) {
  const { tableId } = await params;
  const { sent } = await searchParams;
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store || !can(ctx.role, 'pos.order')) {
    return notFound('この画面は利用できません。店舗の割り当てと注文権限を確認してください。');
  }
  const clerk = await requireHandyClerk();

  const supabase = await createClient();
  const { data: table } = await supabase
    .from('restaurant_tables')
    .select('id, name, capacity_max, current_status, store_id')
    .eq('id', tableId)
    // 削除・無効化した卓はURL直打ちでも開かせない（一覧と同じ条件）
    .eq('status', 'active')
    .maybeSingle();

  if (!table || table.store_id !== store.id) {
    return notFound('このテーブルは存在しないか、現在の店舗からアクセスできません。');
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

  // 注文確認画面から「注文を送信」した直後だけ ?sent=点数 が付く
  const sentQuantity = sent && /^\d{1,4}$/.test(sent) ? Number(sent) : null;

  return (
    <HandyTableDetail
      table={{
        id: table.id,
        name: table.name,
        capacityMax: table.capacity_max,
        currentStatus: table.current_status,
      }}
      staffName={clerk.name}
      slips={slips}
      calls={serviceCalls}
      serverNow={requestTime()}
      sentQuantity={sentQuantity}
      goToOrderAction={openHandyOrder}
      resolveServiceCallAction={resolveServiceCall}
      printBillAction={enqueueOrderSlipPrint}
    />
  );
}
