import type { Metadata } from 'next';
import Link from 'next/link';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { OrderPicker } from '@/components/pos/order-picker';
import { PosScreen } from '@/components/pos/pos-screen';
import { addItem, updateQty, cancelItem, setDiscount, checkout, startTakeout } from './actions';

export const metadata: Metadata = { title: 'POSレジ' };

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderId } = await searchParams;
  const ctx = await requireMember();
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
    const { data: openOrders } = await supabase
      .from('orders')
      .select('id, order_no, order_type, guest_count, opened_at, restaurant_tables(name)')
      .eq('store_id', store.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

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
          }))}
          startTakeoutAction={startTakeout}
        />
      </div>
    );
  }

  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, order_no, order_type, status, guest_count, discount_total, discount_reason, subtotal, tax_total, service_charge, total, store_id, table_id, staff_id, restaurant_tables(name), profiles(display_name)'
    )
    .eq('id', orderId)
    .single();

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

  const { data: items } = await supabase
    .from('order_items')
    .select('id, name, unit_price, quantity, tax_rate, tax_included, line_total, status')
    .eq('order_id', orderId)
    .eq('status', 'active')
    .order('created_at');

  const { data: categories } = await supabase
    .from('menu_categories')
    .select('id, name, color, sort_order')
    .eq('organization_id', ctx.organizationId)
    .or(`store_id.is.null,store_id.eq.${store.id}`)
    .eq('status', 'active')
    .order('sort_order');

  const { data: menuItems } = await supabase
    .from('menu_items')
    .select('id, category_id, name, price, takeout_price, item_type, is_sold_out, sort_order')
    .eq('organization_id', ctx.organizationId)
    .or(`store_id.is.null,store_id.eq.${store.id}`)
    .eq('status', 'active')
    .neq('item_type', 'option')
    .order('sort_order');

  const table = order.restaurant_tables as unknown as { name: string } | null;
  const staff = order.profiles as unknown as { display_name: string } | null;

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
        }}
        items={items ?? []}
        categories={categories ?? []}
        menuItems={menuItems ?? []}
        tableName={table?.name ?? null}
        staffName={staff?.display_name ?? null}
        canDiscount={can(ctx.role, 'pos.discount')}
        addItemAction={addItem}
        updateQtyAction={updateQty}
        cancelItemAction={cancelItem}
        setDiscountAction={setDiscount}
        checkoutAction={checkout}
      />
    </div>
  );
}
