import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { takeoutMenuFrom } from '@/lib/takeout-menu';
import { SettingsBackLink } from '@/components/settings/back-link';
import { MenuBookEditor, type MenuBookCategoryRow, type MenuBookPlanRow } from '@/components/settings/menu-book-editor';
import type { MenuItemRow } from '@/components/settings/menu-item-dialog';
import { classifyMenuItem, HANDY_GROUPS, type HandyGroupId } from '@/components/handy/logic';
import {
  autoCategoryShow,
  categoryShow,
  isMenuBookTab,
  isPlanAddOn,
  isPlanItem,
  menuBookFrom,
  type MenuBookItemInput,
} from '@/lib/menu-book';

export const metadata: Metadata = { title: 'メニューブック | 設定' };


/**
 * メニューブック（店長以上）。レジの「メニューブック」ボタン・設定から開く。
 * ハンディ・お客様QRに出すカテゴリの並び順と出し方、ページ（タブのまとめ方）、商品の並び順と入力、
 * プランで出すカテゴリ、ランチの時間帯。?tab=pages などで最初に開くタブを指定できる（レジの設定から開く）。
 */
export default async function MenuBookPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const ctx = await requirePermission('menu.manage');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="メニューブック" en="Menu book" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: categories }, { data: items }, { data: taxRates }, { data: settingsRow }] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, name_en, color, sort_order, station, store_id')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .order('sort_order')
      .order('name'),
    supabase
      .from('menu_items')
      .select(
        `id, category_id, name, name_en, name_kana, description, item_type, price, takeout_price, cost, tax_rate_id,
         duration_minutes, sell_start_time, sell_end_time, sort_order, is_sold_out, status, price_pending`
      )
      .eq('organization_id', ctx.organizationId)
      .neq('status', 'deleted')
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .order('sort_order')
      .order('name'),
    supabase
      .from('tax_rates')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .order('is_default', { ascending: false }),
    supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
  ]);

  const book = menuBookFrom(settingsRow?.settings ?? null);
  const takeoutMenu = takeoutMenuFrom(settingsRow?.settings ?? null);
  const activeItems = (items ?? []).filter((i) => i.status === 'active');
  const itemInputs: MenuBookItemInput[] = activeItems.map((i) => ({
    categoryId: i.category_id,
    name: i.name,
    price: Number(i.price),
    itemType: i.item_type,
  }));
  const groupLabel = new Map(HANDY_GROUPS.map((g) => [g.id, g.label]));

  const categoryRows: MenuBookCategoryRow[] = (categories ?? []).map((c) => {
    const mine = activeItems.filter((i) => i.category_id === c.id);
    // ハンディの上位分類（フード／ドリンク…）は商品の種類で決まる。カテゴリでいちばん多いものを見出しに出す
    const counts = new Map<HandyGroupId, number>();
    for (const i of mine) {
      const g = classifyMenuItem(i.item_type, c.station);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const { show, auto } = categoryShow({ id: c.id, name: c.name }, itemInputs, book);
    return {
      id: c.id,
      name: c.name,
      nameEn: c.name_en ?? '',
      color: c.color ?? '#7B3FF2',
      sortOrder: c.sort_order,
      shared: c.store_id === null,
      itemCount: mine.length,
      station: c.station ?? null,
      // 0円だけのカテゴリ＝食べ放題・飲み放題の中身（ページの自動振り分けに使う）
      allZeroPrice: mine.length > 0 && mine.every((i) => Number(i.price) === 0),
      group: top ? (groupLabel.get(top) ?? '') : '',
      show: auto ? 'auto' : show,
      autoShow: autoCategoryShow({ id: c.id, name: c.name }, itemInputs),
    };
  });

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

  // プラン: 伝票に入るとプランとして数える商品（コース、名前が飲み放題・食べ放題の商品）。
  // アップグレード（A→AB など）・延長も伝票に入るとプランとして数えるので、後ろにまとめて並べる
  const planRows: MenuBookPlanRow[] = activeItems
    .filter((i) => isPlanItem(i.item_type, i.name))
    .map((i) => ({
      id: i.id,
      name: i.name,
      price: Number(i.price),
      categoryIds: book.plans[i.id] ?? null,
      addOn: isPlanAddOn(i.name),
    }))
    .sort((a, b) => Number(a.addOn) - Number(b.addOn));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader
        title="メニューブック"
        en="Menu book"
        description={`${store.name}｜上のタブ（ページ）、カテゴリの並び順と出し方、商品の並び順・入力（店長以上）`}
      />
      <MenuBookEditor
        storeId={store.id}
        categories={categoryRows}
        items={itemRows}
        plans={planRows}
        lunch={book.lunch}
        pages={book.pages}
        categoryPage={book.categoryPage}
        taxRates={(taxRates ?? []).map((t) => ({ id: t.id, name: t.name }))}
        takeoutItemIds={takeoutMenu.itemIds}
        initialTab={isMenuBookTab(tab) ? tab : undefined}
      />
    </div>
  );
}
