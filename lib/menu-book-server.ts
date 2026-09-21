import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  emptyMenuBook,
  menuBookFrom,
  orderPlanState,
  type MenuBookSettings,
  type OrderPlanState,
} from '@/lib/menu-book';

/**
 * メニューブック（lib/menu-book.ts）の読み込み。
 * 読めなかったときは「設定なし（全部自動）」「プラン無し」に倒す
 * （プランの中身＝0円の飲み放題などを、プランの無いお客様に出さないため）。
 */

/** 'HH:MM'（JST）。販売時間帯・ランチ時間帯の判定用（リクエスト時に1回だけ求める） */
export function jstNowHm(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

const NO_PLAN: OrderPlanState = { hasPlan: false, planItemIds: [] };

export async function loadMenuBook(client: AnyClient, storeId: string): Promise<MenuBookSettings> {
  const { data, error } = await client
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) {
    console.error('[menu-book] settings read failed', error.message);
    return emptyMenuBook();
  }
  return menuBookFrom((data as { settings?: unknown } | null)?.settings ?? null);
}

export async function loadOrderPlanState(client: AnyClient, orderId: string): Promise<OrderPlanState> {
  const { data, error } = await client
    .from('order_items')
    .select('menu_item_id, name, status, menu_items(item_type)')
    .eq('order_id', orderId);
  if (error) {
    console.error('[menu-book] order lines read failed', error.message);
    return NO_PLAN;
  }
  type Row = {
    menu_item_id: string | null;
    name: string;
    status: string | null;
    menu_items: { item_type: string | null } | { item_type: string | null }[] | null;
  };
  return orderPlanState(
    ((data ?? []) as Row[]).map((r) => {
      const mi = Array.isArray(r.menu_items) ? r.menu_items[0] : r.menu_items;
      return { menuItemId: r.menu_item_id, name: r.name, itemType: mi?.item_type ?? null, status: r.status };
    })
  );
}

/**
 * お客様QR（匿名）のメニュー用。卓の店舗のメニューブックと、卓の伝票のプランを読む。
 * 匿名では店舗設定・伝票を読めないため、サービスロールで読む（読むのはこの卓の分だけ）。
 */
export async function loadQrMenuBook(
  storeSlug: string,
  tableToken: string
): Promise<{ book: MenuBookSettings; plan: OrderPlanState }> {
  try {
    const admin = createAdminClient();
    const { data: table } = await admin
      .from('restaurant_tables')
      .select('id, store_id, stores!inner(slug)')
      .eq('qr_token', tableToken)
      .eq('stores.slug', storeSlug)
      .eq('status', 'active')
      .maybeSingle();
    if (!table) return { book: emptyMenuBook(), plan: NO_PLAN };
    const [book, { data: order }] = await Promise.all([
      loadMenuBook(admin, table.store_id),
      admin
        .from('orders')
        .select('id')
        .eq('table_id', table.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const plan = order ? await loadOrderPlanState(admin, order.id) : NO_PLAN;
    return { book, plan };
  } catch (e) {
    console.error('[menu-book] qr context failed', e instanceof Error ? e.message : e);
    return { book: emptyMenuBook(), plan: NO_PLAN };
  }
}
