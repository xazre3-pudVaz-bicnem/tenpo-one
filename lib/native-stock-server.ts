import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { groupMenuPages, menuBookFrom } from '@/lib/menu-book';
import { loadMenuStock } from '@/lib/menu-stock-server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 在庫設定（本日の残り数）。Web の app/app/inventory/menu-stock/page.tsx と同じ組み立て */
export interface NativeStockPayload {
  store: { id: string; name: string };
  groups: { key: string; name: string; categories: { id: string; name: string }[] }[];
  items: { id: string; name: string; categoryId: string | null; limit: number | null; sold: number }[];
}

export async function loadNativeStock(ctx: SessionContext, supabase: Supabase, store: { id: string; name: string }): Promise<NativeStockPayload> {
  const [{ data: categories }, { data: items }, { data: settingsRow }, stock] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, sort_order, station')
      .eq('organization_id', ctx.organizationId)
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .eq('status', 'active')
      .order('sort_order')
      .order('name'),
    supabase
      .from('menu_items')
      .select('id, name, category_id, price, sort_order')
      .eq('organization_id', ctx.organizationId)
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .eq('status', 'active')
      .neq('item_type', 'option')
      .order('sort_order')
      .order('name'),
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
    loadMenuStock(supabase, store.id),
  ]);
  const book = menuBookFrom(settingsRow?.settings ?? null);
  const rows = (categories ?? []) as { id: string; name: string; station: string | null }[];
  const priceByCategory = new Map<string, number[]>();
  for (const i of (items ?? []) as { category_id: string | null; price: number }[]) {
    if (!i.category_id) continue;
    const list = priceByCategory.get(i.category_id) ?? [];
    list.push(Number(i.price ?? 0));
    priceByCategory.set(i.category_id, list);
  }
  const forPages = rows.map((c) => {
    const prices = priceByCategory.get(c.id) ?? [];
    return { ...c, allZeroPrice: prices.length > 0 && prices.every((p) => p === 0) };
  });
  return {
    store,
    groups: groupMenuPages(forPages, book)
      .map((pg) => ({ key: pg.key, name: pg.name ?? pg.categories.map((c) => c.name).join(' / '), categories: pg.categories.map((c) => ({ id: c.id, name: c.name })) }))
      .filter((g) => g.categories.length > 0),
    items: ((items ?? []) as { id: string; name: string; category_id: string | null }[]).map((m) => {
      const st = stock.get(m.id);
      return { id: m.id, name: m.name, categoryId: m.category_id, limit: st ? st.limit : null, sold: st ? st.sold : 0 };
    }),
  };
}
