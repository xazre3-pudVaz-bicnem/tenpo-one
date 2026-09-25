import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { groupMenuPages, menuBookFrom } from '@/lib/menu-book';
import { loadMenuStock } from '@/lib/menu-stock-server';
import { MenuStockBoard, type StockGroup, type StockItem } from '@/components/inventory/menu-stock-board';
import { setMenuStockLimits } from '../menu-stock-actions';
import { enqueueStockListPrint } from '@/app/app/pos/print-actions';

export const metadata: Metadata = { title: '在庫管理' };

/**
 * 在庫管理（2026-09-25 店舗要望「レジの在庫管理と同じ画面に」）。
 * 左がカテゴリ（ページごとにまとめる）、右がその中の商品の残り数。
 * 残りが0になった商品はレジ・ハンディ・お客様QRで自動的に売切になる（lib/menu-stock.ts）。
 */
export default async function MenuStockPage() {
  const ctx = await requireFeature('pos');
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) {
    return (
      <div>
        <PageHeader title="在庫管理" en="Stock" />
        <EmptyState title="アクセス可能な店舗がありません" />
      </div>
    );
  }

  const supabase = await createClient();
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
  // カテゴリごとに「0円だけか」を出す（ページの自動振り分けに使う。lib/menu-book.ts）
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

  const groups: StockGroup[] = groupMenuPages(forPages, book)
    .map((pg) => ({
      key: pg.key,
      name: pg.name ?? pg.categories.map((c) => c.name).join(' / '),
      categories: pg.categories.map((c) => ({ id: c.id, name: c.name })),
    }))
    .filter((g) => g.categories.length > 0);

  const stockItems: StockItem[] = ((items ?? []) as { id: string; name: string; category_id: string | null }[]).map(
    (m) => {
      const st = stock.get(m.id);
      return {
        id: m.id,
        name: m.name,
        categoryId: m.category_id,
        limit: st ? st.limit : null,
        sold: st ? st.sold : 0,
      };
    }
  );

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col">
      <PageHeader
        title="在庫管理"
        en="Stock"
        description="仕込んだ数（残り）を入れると、その数だけ売れた時点でレジ・ハンディ・お客様QRが自動で売切になります"
      />
      <Link
        href="/app/inventory?tab=menu"
        className="mb-3 inline-flex shrink-0 items-center gap-1 text-[13px] font-bold text-royal"
      >
        <ChevronLeft className="h-4 w-4" />
        在庫設定へ戻る
      </Link>
      <MenuStockBoard
        storeId={store.id}
        groups={groups}
        items={stockItems}
        saveAction={setMenuStockLimits}
        printAction={enqueueStockListPrint}
      />
    </div>
  );
}
