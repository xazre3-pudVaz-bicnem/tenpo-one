import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { OrderPicker } from '@/components/pos/order-picker';
import { PosScreen } from '@/components/pos/pos-screen';
import {
  addItem,
  updateQty,
  cancelItem,
  setDiscount,
  checkout,
  startTakeout,
  splitOrder,
  mergeOrders,
  moveTable,
} from './actions';
import { startTerminalPayment, checkTerminalPayment, cancelTerminalPayment, getPaymentAvailability } from './payment-actions';

export const metadata: Metadata = { title: 'POSレジ' };

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderId } = await searchParams;
  const ctx = await requireFeature('pos');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="POSレジ" />
        <EmptyState
          title="アクセス可能な店舗がありません"
          description="管理者に店舗の割り当てを依頼してください"
        />
      </div>
    );
  }

  if (!orderId) {
    const { data: openOrders, error: openOrdersError } = await supabase
      .from('orders')
      .select('id, order_no, order_type, guest_count, opened_at, source_order_id, restaurant_tables(name)')
      .eq('store_id', store.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });
    if (openOrdersError) {
      throw new Error('注文一覧の読み込みに失敗しました');
    }

    return (
      <div>
        <PageHeader title="POSレジ" description={`${store.name}｜会計する注文を選択してください`} />
        <OrderPicker
          orders={(openOrders ?? []).map((o) => ({
            id: o.id,
            orderNo: o.order_no,
            orderType: o.order_type,
            guestCount: o.guest_count,
            openedAt: o.opened_at,
            tableName: (o.restaurant_tables as unknown as { name: string } | null)?.name ?? null,
            isDerived: !!o.source_order_id,
          }))}
          startTakeoutAction={startTakeout}
        />
      </div>
    );
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'id, order_no, order_type, status, guest_count, discount_total, discount_reason, subtotal, tax_total, service_charge, total, store_id, table_id, staff_id, restaurant_tables(name), profiles(display_name)'
    )
    .eq('id', orderId)
    .single();
  if (orderError && orderError.code !== 'PGRST116') {
    throw new Error('注文の読み込みに失敗しました');
  }

  if (!order || order.store_id !== store.id) {
    return (
      <div>
        <PageHeader title="POSレジ" />
        <EmptyState
          title="注文が見つかりません"
          description="この注文は存在しないか、現在の店舗からアクセスできません"
          action={
            <Link href="/app/pos" className="text-sm font-medium text-primary hover:underline">
              注文選択画面へ戻る
            </Link>
          }
        />
      </div>
    );
  }

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('id, name, unit_price, quantity, tax_rate, tax_included, line_total, status')
    .eq('order_id', orderId)
    .eq('status', 'active')
    .order('created_at');

  const { data: categories, error: categoriesError } = await supabase
    .from('menu_categories')
    .select('id, name, color, sort_order')
    .eq('organization_id', ctx.organizationId)
    .or(`store_id.is.null,store_id.eq.${store.id}`)
    .eq('status', 'active')
    .order('sort_order');

  const { data: menuItems, error: menuItemsError } = await supabase
    .from('menu_items')
    .select('id, category_id, name, price, takeout_price, item_type, is_sold_out, sort_order')
    .eq('organization_id', ctx.organizationId)
    .or(`store_id.is.null,store_id.eq.${store.id}`)
    .eq('status', 'active')
    .neq('item_type', 'option')
    .order('sort_order');

  if (itemsError || categoriesError || menuItemsError) {
    throw new Error('注文内容の読み込みに失敗しました');
  }

  const table = order.restaurant_tables as unknown as { name: string } | null;
  const staff = order.profiles as unknown as { display_name: string } | null;

  const canCheckout = can(ctx.role, 'pos.checkout');
  let paymentAvailability = { configured: false, testMode: false };
  let terminalReaders: {
    id: string;
    label: string;
    deviceType: string | null;
    isSimulated: boolean;
    status: string;
    lastSeenAt: string | null;
  }[] = [];
  let otherOpenOrders: {
    id: string;
    orderNo: number;
    tableName: string | null;
    total: number;
    guestCount: number;
  }[] = [];
  let availableTables: { id: string; name: string; capacityMax: number }[] = [];

  if (canCheckout) {
    const [availability, { data: readers }, { data: otherOrders }] = await Promise.all([
      getPaymentAvailability(),
      supabase
        .from('terminal_readers')
        .select('id, label, device_type, is_simulated, status, last_seen_at')
        .eq('store_id', store.id),
      supabase
        .from('orders')
        .select('id, order_no, total, guest_count, restaurant_tables(name)')
        .eq('store_id', store.id)
        .eq('status', 'open')
        .neq('id', orderId)
        .order('opened_at', { ascending: false })
        .limit(30),
    ]);
    paymentAvailability = availability;
    const statusOrder: Record<string, number> = { online: 0, unknown: 1, offline: 2 };
    terminalReaders = (readers ?? [])
      .map((r) => ({
        id: r.id,
        label: r.label,
        deviceType: r.device_type,
        isSimulated: r.is_simulated,
        status: r.status,
        lastSeenAt: r.last_seen_at,
      }))
      .sort(
        (a, b) =>
          (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1) || a.label.localeCompare(b.label, 'ja')
      );
    otherOpenOrders = (otherOrders ?? []).map((o) => ({
      id: o.id,
      orderNo: o.order_no,
      tableName: (o.restaurant_tables as unknown as { name: string } | null)?.name ?? null,
      total: o.total,
      guestCount: o.guest_count,
    }));

    if (order.table_id) {
      const { data: tables } = await supabase
        .from('restaurant_tables')
        .select('id, name, capacity_max')
        .eq('store_id', store.id)
        .eq('status', 'active')
        .eq('current_status', 'available')
        .order('sort_order');
      availableTables = (tables ?? []).map((t) => ({ id: t.id, name: t.name, capacityMax: t.capacity_max }));
    }
  }

  return (
    <div className="-m-4 lg:-m-6">
      <PosScreen
        order={{
          id: order.id,
          orderNo: order.order_no,
          orderType: order.order_type,
          guestCount: order.guest_count,
          discountTotal: order.discount_total,
          discountReason: order.discount_reason,
          subtotal: order.subtotal,
          taxTotal: order.tax_total,
          serviceCharge: order.service_charge,
          total: order.total,
          tableId: order.table_id,
        }}
        items={items ?? []}
        categories={categories ?? []}
        menuItems={menuItems ?? []}
        tableName={table?.name ?? null}
        staffName={staff?.display_name ?? null}
        canDiscount={can(ctx.role, 'pos.discount')}
        canCheckout={canCheckout}
        terminalReaders={terminalReaders}
        paymentAvailability={paymentAvailability}
        otherOpenOrders={otherOpenOrders}
        availableTables={availableTables}
        addItemAction={addItem}
        updateQtyAction={updateQty}
        cancelItemAction={cancelItem}
        setDiscountAction={setDiscount}
        checkoutAction={checkout}
        splitOrderAction={splitOrder}
        mergeOrdersAction={mergeOrders}
        moveTableAction={moveTable}
        startTerminalPaymentAction={startTerminalPayment}
        checkTerminalPaymentAction={checkTerminalPayment}
        cancelTerminalPaymentAction={cancelTerminalPayment}
      />
    </div>
  );
}
