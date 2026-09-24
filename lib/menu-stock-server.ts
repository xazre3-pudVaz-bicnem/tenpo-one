/**
 * メニューの売り切り（本日の食数）をデータベースから読む。
 * 設定は store_settings.settings.menuStock、売れた数はその日（business_date）の order_items から数える。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { todayJst } from '@/lib/format';
import { buildMenuStock, menuStockLimitsFrom, type MenuStockState } from '@/lib/menu-stock';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;

/**
 * 本日の残数表（商品ID → 残り）。食数を設定していない商品は入らない。
 * 取消した伝票・取消した明細は数えない。
 */
export async function loadMenuStock(
  supabase: Db,
  storeId: string,
  businessDate: string = todayJst()
): Promise<Map<string, MenuStockState>> {
  const { data: settingsRow } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  const limits = menuStockLimitsFrom(settingsRow?.settings ?? null);
  const ids = Object.keys(limits);
  if (ids.length === 0) return new Map();

  const { data: rows } = await supabase
    .from('order_items')
    .select('menu_item_id, quantity, orders!inner(store_id, business_date, status)')
    .in('menu_item_id', ids)
    .eq('status', 'active')
    .eq('orders.store_id', storeId)
    .eq('orders.business_date', businessDate)
    .neq('orders.status', 'cancelled');

  const soldByItem = new Map<string, number>();
  for (const r of (rows ?? []) as { menu_item_id: string | null; quantity: number }[]) {
    if (!r.menu_item_id) continue;
    soldByItem.set(r.menu_item_id, (soldByItem.get(r.menu_item_id) ?? 0) + (r.quantity ?? 0));
  }
  return buildMenuStock(limits, soldByItem);
}
