import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { MenuItemRow } from '@/components/settings/menu-item-dialog';
import type { CategoryRow } from '@/components/settings/category-panel';

interface MenuCtx {
  organizationId: string;
}

export interface MenuSettingsData {
  categoryRows: CategoryRow[];
  /** カテゴリの厨房ステーション（カテゴリ画面の振り分け用） */
  stations: { id: string; name: string; station: string }[];
  itemRows: MenuItemRow[];
  taxRates: { id: string; name: string }[];
}

/**
 * 設定 > メニュー / プラン / カテゴリ で共通に使う、店舗のカテゴリ・商品・税率。
 * （2026-09-23 dinii と同じく「メニュー・プラン・オプション・カテゴリ」を別の画面に分けた）
 */
export async function loadMenuSettingsData(ctx: MenuCtx, storeId: string): Promise<MenuSettingsData> {
  const supabase = await createClient();

  const [{ data: categories }, { data: items }, { data: taxRates }] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, name_en, color, sort_order, station')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .order('sort_order'),
    supabase
      .from('menu_items')
      .select(
        `id, category_id, name, name_en, name_kana, description, item_type, price, takeout_price, cost, tax_rate_id,
         duration_minutes, sell_start_time, sell_end_time, sort_order, is_sold_out, status, price_pending`
      )
      .eq('organization_id', ctx.organizationId)
      .neq('status', 'deleted')
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .order('sort_order'),
    supabase
      .from('tax_rates')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .order('is_default', { ascending: false }),
  ]);

  const categoryRows: CategoryRow[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: c.name_en ?? '',
    color: c.color ?? '#7b3fe4',
    sortOrder: c.sort_order,
  }));

  const itemRows: MenuItemRow[] = (items ?? []).map((i) => ({
    id: i.id,
    categoryId: i.category_id,
    name: i.name,
    nameEn: i.name_en ?? '',
    nameKana: i.name_kana ?? '',
    description: i.description ?? '',
    itemType: i.item_type,
    price: i.price,
    takeoutPrice: i.takeout_price,
    cost: i.cost,
    taxRateId: i.tax_rate_id,
    durationMinutes: i.duration_minutes,
    sellStartTime: i.sell_start_time?.slice(0, 5) ?? null,
    sellEndTime: i.sell_end_time?.slice(0, 5) ?? null,
    sortOrder: i.sort_order,
    isSoldOut: i.is_sold_out,
    status: i.status as 'active' | 'hidden' | 'deleted',
    pricePending: i.price_pending ?? false,
  }));

  return {
    categoryRows,
    stations: (categories ?? []).map((c) => ({ id: c.id, name: c.name, station: c.station })),
    itemRows,
    taxRates: (taxRates ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}
