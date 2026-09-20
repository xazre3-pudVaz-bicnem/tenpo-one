import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isMissingColumnError } from '@/lib/schema-compat';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { OrderPicker } from '@/components/pos/order-picker';
import { PosScreen, type PosOrderItem } from '@/components/pos/pos-screen';
import {
  addItem,
  updateQty,
  cancelItem,
  setDiscount,
  checkout,
  sendOrderToKitchen,
  startTakeout,
  splitOrder,
  mergeOrders,
  moveTable,
  cancelEmptyOrder,
  setGuestCount,
  addSlipToTable,
  applyCoupon,
  clearCoupon,
  searchCustomerByPhone,
  setOrderCustomer,
} from './actions';
import { startTerminalPayment, checkTerminalPayment, cancelTerminalPayment, getPaymentAvailability } from './payment-actions';

export const metadata: Metadata = { title: 'POSレジ' };

const ORDER_ITEM_COLUMNS = 'id, menu_item_id, name, unit_price, quantity, tax_rate, tax_included, line_total, status';

/**
 * 伝票の明細。kitchen_sent_at（厨房へ送信済みか）も読むが、migration 00063 が未適用で列が無いときは
 * 列なしで読み直す（その場合は全品「送信済み」扱いになり、レジは従来どおり動く）。
 */
async function loadOrderItems(supabase: Awaited<ReturnType<typeof createClient>>, orderId: string) {
  const base = () => supabase.from('order_items').select(`${ORDER_ITEM_COLUMNS}, kitchen_sent_at`).eq('order_id', orderId).eq('status', 'active').order('created_at');
  const first = await base();
  if (!first.error || !isMissingColumnError(first.error.message, 'kitchen_sent_at')) return first;
  const legacy = await supabase.from('order_items').select(ORDER_ITEM_COLUMNS).eq('order_id', orderId).eq('status', 'active').order('created_at');
  return { data: (legacy.data ?? null) as (PosOrderItem[] | null), error: legacy.error };
}

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
          storeId={store.id}
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
      'id, order_no, order_type, status, guest_count, discount_total, discount_reason, coupon_code, customer_id, subtotal, tax_total, service_charge, total, store_id, table_id, staff_id, clerk_id, restaurant_tables(name), profiles(display_name)'
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

  // order は取得済みのため、以降の7クエリ（明細・カテゴリ・商品・売れ筋・顧客・ロイヤリティ・店舗設定）は
  // すべて相互に独立＝並列取得できる（customer も order.customer_id が判明済み）。
  const [
    { data: items, error: itemsError },
    { data: categories, error: categoriesError },
    { data: menuItems, error: menuItemsError },
    { data: recentSales },
    { data: customerRow },
    { data: loyalty },
    { data: storeSettings },
  ] = await Promise.all([
    loadOrderItems(supabase, orderId),
    supabase
      .from('menu_categories')
      .select('id, name, name_en, color, sort_order')
      .eq('organization_id', ctx.organizationId)
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .eq('status', 'active')
      .order('sort_order'),
    supabase
      .from('menu_items')
      .select('id, category_id, name, name_en, name_kana, price, takeout_price, item_type, is_sold_out, is_recommended, sort_order')
      .eq('organization_id', ctx.organizationId)
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .eq('status', 'active')
      .neq('item_type', 'option')
      .order('sort_order'),
    // 売れ筋TOP12（過去30日・支払済注文の販売数量）。SQL側で集計し上位のみ受け取る
    // （全明細を転送してJS集計すると繁忙店で数千行になるため）。
    supabase.rpc('get_best_sellers', { p_store: store.id, p_days: 30, p_limit: 12 }),
    order.customer_id
      ? supabase.from('customers').select('id, name, phone, point_balance').eq('id', order.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('loyalty_settings').select('enabled, point_value').eq('organization_id', ctx.organizationId).maybeSingle(),
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
  ]);

  if (itemsError || categoriesError || menuItemsError) {
    throw new Error('注文内容の読み込みに失敗しました');
  }

  const table = order.restaurant_tables as unknown as { name: string } | null;
  const staff = order.profiles as unknown as { display_name: string } | null;

  // RPCは販売数量の多い順に返すため、そのままIDの配列にする
  const bestSellerIds = ((recentSales ?? []) as { menu_item_id: string }[]).map((r) => r.menu_item_id);

  // 顧客紐付け・ポイント払いの活性判定はサーバーで完結させ、クライアントには結果のみ渡す
  const customer: { id: string; name: string; phone: string | null; pointBalance: number } | null = customerRow
    ? { id: customerRow.id, name: customerRow.name, phone: customerRow.phone, pointBalance: customerRow.point_balance }
    : null;
  const pointsAvailability = {
    available: !!customer && !!loyalty?.enabled && customer.pointBalance > 0,
    balance: customer?.pointBalance ?? 0,
    pointValue: loyalty?.point_value ?? 1,
  };
  const drawerSettings = (storeSettings?.settings as { drawer?: { autoOpenOnCash?: boolean; openOnCashless?: boolean } } | null)
    ?.drawer;
  const drawerConfig = {
    autoOpenOnCash: drawerSettings?.autoOpenOnCash ?? true,
    openOnCashless: drawerSettings?.openOnCashless ?? false,
  };

  // 会計時に選べるPOS担当者（この店舗の有効な名前のみ）
  const { data: clerks } = await supabase
    .from('pos_clerks')
    .select('id, name')
    .eq('store_id', store.id)
    .eq('status', 'active')
    .order('sort_order')
    .order('name');
  const clerkOptions = (clerks ?? []).map((c) => ({ id: c.id, name: c.name }));

  // 商品ごとの選択肢グループ（必須・最小/最大・追加料金）。
  // 設定がある商品はPOSでタップした際に選択ダイアログを出す。
  const { data: optionLinks } = await supabase
    .from('menu_item_option_groups')
    .select(
      'menu_item_id, sort_order, menu_option_groups!inner(id, name, name_en, is_required, min_select, max_select, status, menu_option_items(id, name, name_en, price, sort_order, status))'
    )
    .eq('store_id', store.id)
    .eq('menu_option_groups.status', 'active')
    .order('sort_order');

  const optionGroupsByItem: Record<string, {
    id: string; name: string; nameEn: string | null; isRequired: boolean; minSelect: number; maxSelect: number;
    items: { id: string; name: string; nameEn: string | null; price: number }[];
  }[]> = {};
  for (const link of optionLinks ?? []) {
    const g = link.menu_option_groups as unknown as {
      id: string; name: string; name_en: string | null; is_required: boolean; min_select: number; max_select: number;
      menu_option_items: {
        id: string; name: string; name_en: string | null; price: number; sort_order: number; status: string;
      }[];
    } | null;
    if (!g) continue;
    const items = (g.menu_option_items ?? [])
      .filter((o) => o.status === 'active')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({ id: o.id, name: o.name, nameEn: o.name_en, price: o.price }));
    if (items.length === 0) continue; // 選択肢が無いグループはダイアログを出さない
    (optionGroupsByItem[link.menu_item_id] ??= []).push({
      id: g.id,
      name: g.name,
      nameEn: g.name_en,
      isRequired: g.is_required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      items,
    });
  }

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
  // レジが開局しているか（未開局だと会計を受け付けない。画面にも先に出しておく）
  let registerOpen = true;

  if (canCheckout) {
    const [availability, { data: readers }, { data: otherOrders }, { data: openSession }] = await Promise.all([
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
      supabase.from('register_sessions').select('id').eq('store_id', store.id).eq('status', 'open').limit(1).maybeSingle(),
    ]);
    paymentAvailability = availability;
    registerOpen = !!openSession;
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
        storeId={store.id}
        order={{
          id: order.id,
          orderNo: order.order_no,
          orderType: order.order_type,
          guestCount: order.guest_count,
          discountTotal: order.discount_total,
          discountReason: order.discount_reason,
          couponCode: order.coupon_code,
          subtotal: order.subtotal,
          taxTotal: order.tax_total,
          serviceCharge: order.service_charge,
          total: order.total,
          tableId: order.table_id,
        }}
        items={items ?? []}
        categories={categories ?? []}
        menuItems={menuItems ?? []}
        bestSellerIds={bestSellerIds}
        tableName={table?.name ?? null}
        staffName={staff?.display_name ?? null}
        clerks={clerkOptions}
        currentClerkId={order.clerk_id ?? null}
        optionGroupsByItem={optionGroupsByItem}
        customer={customer}
        pointsAvailability={pointsAvailability}
        drawerConfig={drawerConfig}
        canDiscount={can(ctx.role, 'pos.discount')}
        canCheckout={canCheckout}
        registerOpen={registerOpen}
        terminalReaders={terminalReaders}
        paymentAvailability={paymentAvailability}
        otherOpenOrders={otherOpenOrders}
        availableTables={availableTables}
        addItemAction={addItem}
        updateQtyAction={updateQty}
        cancelItemAction={cancelItem}
        setDiscountAction={setDiscount}
        checkoutAction={checkout}
        sendOrderAction={sendOrderToKitchen}
        splitOrderAction={splitOrder}
        mergeOrdersAction={mergeOrders}
        moveTableAction={moveTable}
        cancelEmptyOrderAction={cancelEmptyOrder}
        setGuestCountAction={setGuestCount}
        addSlipToTableAction={addSlipToTable}
        startTerminalPaymentAction={startTerminalPayment}
        checkTerminalPaymentAction={checkTerminalPayment}
        cancelTerminalPaymentAction={cancelTerminalPayment}
        applyCouponAction={applyCoupon}
        clearCouponAction={clearCoupon}
        searchCustomerAction={searchCustomerByPhone}
        setOrderCustomerAction={setOrderCustomer}
      />
    </div>
  );
}
