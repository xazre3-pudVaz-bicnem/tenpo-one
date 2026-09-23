import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, PackageX, Settings } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { storeAccessBlock } from '@/components/pos/store-access-guard';
import { createClient } from '@/lib/supabase/server';
import { loadMenuBook } from '@/lib/menu-book-server';
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
  moveTable,
  cancelEmptyOrder,
  setGuestCount,
  setSeatTime,
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
  searchParams: Promise<{ order?: string; checkout?: string; move?: string }>;
}) {
  const { order: orderId, checkout: openCheckout, move: openMove } = await searchParams;
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

  // 契約のアクセス制限（お店の回線・レジ端末の台数）。制限なしの店舗はそのまま
  const accessBlock = await storeAccessBlock(store, { countDevice: true });
  if (accessBlock) return accessBlock;

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
        <PageHeader
          title="POSレジ"
          description={`${store.name}｜会計する注文を選択してください`}
          actions={
            <div className="flex flex-wrap gap-2">
              {/* 品切れ（売切・販売再開）はスタッフ全員。レジ・ハンディ・お客様QRに反映 */}
              <Link
                href="/app/pos/sold-out"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-navy hover:bg-gray-50"
              >
                <PackageX className="h-4 w-4" aria-hidden />
                品切れ
              </Link>
              {/* レジの設定（厨房伝票・メニュー・QR・ハンディなど、今までの設定をレジからまとめて変える） */}
              <Link
                href="/app/pos/settings"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-navy hover:bg-gray-50"
              >
                <Settings className="h-4 w-4" aria-hidden />
                レジの設定
              </Link>
              {/* メニューブック（カテゴリ・商品の並び順、ハンディ・お客様QRでの出し方）は店長以上だけ */}
              {can(ctx.role, 'menu.manage') && (
                <Link
                  href="/app/settings/menu-book"
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-navy hover:bg-gray-50"
                >
                  <BookOpen className="h-4 w-4" aria-hidden />
                  メニューブック
                </Link>
              )}
            </div>
          }
        />
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
      'id, order_no, order_type, status, guest_count, discount_total, discount_reason, coupon_code, customer_id, subtotal, tax_total, service_charge, total, store_id, table_id, staff_id, clerk_id, opened_at, restaurant_tables(name), profiles(display_name), reservations(start_at, end_at, course_id)'
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
  const menuBook = await loadMenuBook(supabase, store.id);

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
      .select('id, category_id, name, name_en, name_kana, price, takeout_price, item_type, is_sold_out, is_recommended, sort_order, duration_minutes')
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
  // 英語名を持つのは選択肢（menu_option_items.name_en）だけで、グループ自体には無い。
  // グループに name_en を指定するとクエリごと失敗し、選択肢ダイアログが黙って出なくなる。
  const { data: optionLinks, error: optionLinksError } = await supabase
    .from('menu_item_option_groups')
    .select(
      'menu_item_id, sort_order, menu_option_groups!inner(id, name, is_required, min_select, max_select, status, menu_option_items(id, name, name_en, price, sort_order, status))'
    )
    .eq('store_id', store.id)
    .eq('menu_option_groups.status', 'active')
    .order('sort_order');
  if (optionLinksError) {
    // 取得に失敗すると選択肢が出ないまま会計できてしまうため、気付けるように記録する
    console.error('[pos] 選択肢グループの取得に失敗', optionLinksError.message);
  }

  const optionGroupsByItem: Record<string, {
    id: string; name: string; isRequired: boolean; minSelect: number; maxSelect: number;
    items: { id: string; name: string; nameEn: string | null; price: number }[];
  }[]> = {};
  for (const link of optionLinks ?? []) {
    const g = link.menu_option_groups as unknown as {
      id: string; name: string; is_required: boolean; min_select: number; max_select: number;
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
  let availableTables: { id: string; name: string; capacityMax: number }[] = [];
  // レジが開局しているか（未開局だと会計を受け付けない。画面にも先に出しておく）
  let registerOpen = true;

  if (canCheckout) {
    const [availability, { data: readers }, { data: openSession }] = await Promise.all([
      getPaymentAvailability(),
      supabase
        .from('terminal_readers')
        .select('id, label, device_type, is_simulated, status, last_seen_at')
        .eq('store_id', store.id),
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

  // 席の時間・コース（伝票画面の上で直せる）
  const seatResv = (Array.isArray(order.reservations) ? order.reservations[0] : order.reservations) as
    | { start_at: string | null; end_at: string | null; course_id: string | null }
    | null;
  const seatStartMs = new Date(order.opened_at as string).getTime();
  const seatEndMs = seatResv?.end_at ? new Date(seatResv.end_at).getTime() : null;
  const seatTime = {
    startMs: seatStartMs,
    endMs: seatEndMs != null && seatEndMs > seatStartMs ? seatEndMs : null,
    courseId: seatResv?.course_id ?? null,
  };
  const seatCourses = (menuItems ?? [])
    .filter((m) => m.item_type === 'course')
    .map((m) => ({ id: m.id as string, name: m.name as string, durationMinutes: (m.duration_minutes as number | null) ?? null }));

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
        menuPages={menuBook}
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
        availableTables={availableTables}
        addItemAction={addItem}
        updateQtyAction={updateQty}
        cancelItemAction={cancelItem}
        setDiscountAction={setDiscount}
        checkoutAction={checkout}
        sendOrderAction={sendOrderToKitchen}
        moveTableAction={moveTable}
        cancelEmptyOrderAction={cancelEmptyOrder}
        openCheckout={openCheckout === '1'}
        openTableMove={openMove === '1'}
        setGuestCountAction={setGuestCount}
        seatTime={order.table_id ? seatTime : undefined}
        seatCourses={seatCourses}
        setSeatTimeAction={setSeatTime}
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
