import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SoldOutCategory, SoldOutItem } from '@/lib/sold-out';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/** 品切れの設定画面（ハンディ・レジ）に出すカテゴリと商品（販売中・非表示でない商品すべて） */
export async function loadSoldOutBoard(
  supabase: AnyClient,
  organizationId: string,
  storeId: string
): Promise<{ categories: SoldOutCategory[]; items: SoldOutItem[]; error: string | null }> {
  const [{ data: categories, error: categoriesError }, { data: items, error: itemsError }] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, sort_order')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${storeId}`),
    supabase
      .from('menu_items')
      .select('id, category_id, name, name_kana, price, is_sold_out, sort_order, store_id')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${storeId}`),
  ]);
  const error = categoriesError?.message ?? itemsError?.message ?? null;
  return {
    error,
    categories: (categories ?? []).map((c) => ({ id: c.id, name: c.name, sortOrder: c.sort_order ?? 0 })),
    items: (items ?? []).map((i) => ({
      id: i.id,
      categoryId: i.category_id,
      name: i.name,
      nameKana: i.name_kana ?? null,
      price: Number(i.price),
      isSoldOut: !!i.is_sold_out,
      sortOrder: i.sort_order ?? 0,
      shared: i.store_id === null,
    })),
  };
}
