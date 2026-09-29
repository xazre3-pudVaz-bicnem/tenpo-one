import type { createClient } from '@/lib/supabase/server';
import {
  buildHandyTabs,
  initialHandyTab,
  type HandyCategoryInput,
  type HandyMenuItemInput,
  type HandyTabView,
} from '@/components/handy/logic';
import type { PosOptionGroup } from '@/components/pos/option-dialog';
import { filterMenuBook, planCategoryIds } from '@/lib/menu-book';
import { englishName } from '@/lib/romaji';
import { loadMenuStock } from '@/lib/menu-stock-server';
import { isMenuSoldOut } from '@/lib/menu-stock';
import { jstNowHm, loadMenuBook, loadOrderPlanState } from '@/lib/menu-book-server';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface HandyMenuData {
  tabs: HandyTabView[];
  initialTabId: string | null;
  optionGroupsByItem: Record<string, PosOptionGroup[]>;
}

/**
 * ハンディの注文画面のメニュー（上のタブ→ページ→商品・選択肢）。
 * ハンディの卓の注文（app/handy/[tableId]/order）と、即会計の「メニュー選択」（app/app/quick-pay）で同じものを使う。
 * orderId は伝票のプラン（飲み放題など）を見るため。
 */
export async function loadHandyMenu(
  supabase: SupabaseServerClient,
  organizationId: string,
  storeId: string,
  /** 伝票（プランを見る）。まだ伝票が無いときは null（プランなし） */
  orderId: string | null
): Promise<HandyMenuData> {
  const [{ data: categories }, { data: menuItems }, { data: optionLinks }, menuBook, plan] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, name_en, station, sort_order')
      .eq('organization_id', organizationId)
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .eq('status', 'active')
      .order('sort_order'),
    // POSと違い item_type='option'（サービス・追加オプション）も出す（承認済みUIの⑥サービス）
    supabase
      .from('menu_items')
      .select(
        'id, category_id, name, name_en, name_kana, price, item_type, is_sold_out, sort_order, sell_start_time, sell_end_time, image_path'
      )
      .eq('organization_id', organizationId)
      .or(`store_id.is.null,store_id.eq.${storeId}`)
      .eq('status', 'active')
      .order('sort_order'),
    // menu_option_groups に name_en 列は無い（選択肢の英語名は menu_option_items のみ）。
    // ここに存在しない列を入れるとクエリが失敗し、選択肢ダイアログが黙って出なくなる。
    supabase
      .from('menu_item_option_groups')
      .select(
        'menu_item_id, sort_order, menu_option_groups!inner(id, name, is_required, min_select, max_select, status, menu_option_items(id, name, name_en, price, sort_order, status))'
      )
      .eq('store_id', storeId)
      .eq('menu_option_groups.status', 'active')
      .order('sort_order'),
    // メニューブック（店長が決めたカテゴリの出し方）と、この伝票に入っているプラン（飲み放題など）
    loadMenuBook(supabase, storeId),
    orderId ? loadOrderPlanState(supabase, orderId) : Promise.resolve({ hasPlan: false, planItemIds: [] }),
  ]);

  // 商品ごとの選択肢グループ（POS画面と同じ構造・同じダイアログを使う）
  const optionGroupsByItem: Record<string, PosOptionGroup[]> = {};
  for (const link of optionLinks ?? []) {
    const g = link.menu_option_groups as unknown as {
      id: string;
      name: string;
      is_required: boolean;
      min_select: number;
      max_select: number;
      menu_option_items: {
        id: string;
        name: string;
        name_en: string | null;
        price: number;
        sort_order: number;
        status: string;
      }[];
    } | null;
    if (!g) continue;
    const items = (g.menu_option_items ?? [])
      .filter((o) => o.status === 'active')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({ id: o.id, name: o.name, nameEn: o.name_en, price: o.price }));
    if (items.length === 0) continue;
    (optionGroupsByItem[link.menu_item_id] ??= []).push({
      id: g.id,
      name: g.name,
      isRequired: g.is_required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      items,
    });
  }

  const categoryInputs: HandyCategoryInput[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: englishName(c.name, null, c.name_en),
    station: c.station,
    sortOrder: c.sort_order,
  }));
  // メニューの売り切り（本日の食数）が0になった商品は自動で売切にする（2026-09-24 店舗要望）
  const menuStock = await loadMenuStock(supabase, storeId);

  const itemInputs: HandyMenuItemInput[] = (menuItems ?? []).map((m) => ({
    id: m.id,
    categoryId: m.category_id,
    name: m.name,
    // 英語名が入っていない商品はカナからローマ字を作る（レジ画面と同じ englishName）
    nameEn: englishName(m.name, m.name_kana, m.name_en),
    price: m.price,
    itemType: m.item_type,
    isSoldOut: isMenuSoldOut(!!m.is_sold_out, menuStock.get(m.id as string)),
    sortOrder: m.sort_order,
    sellStartTime: m.sell_start_time,
    sellEndTime: m.sell_end_time,
    imagePath: m.image_path,
    hasOptions: !!optionGroupsByItem[m.id],
  }));

  // ハンディに出すカテゴリだけに絞る（アラカルトの伝票には飲み放題の F などを出さない。レジは今まで通り全部出す）
  const nowHm = jstNowHm();
  const visible = filterMenuBook(categoryInputs, itemInputs, menuBook, { channel: 'handy', plan, nowHm });
  // 上のタブ（1 単品／2 コース・飲み放題／3 サービス）→ メニューブックのページ。ページの区切りは出さないカテゴリも
  // 含めた並び順で決める（時間帯・卓によって区切りが変わらないように）
  const planIds = planCategoryIds(categoryInputs, itemInputs, menuBook);
  const tabs = buildHandyTabs(categoryInputs, visible.items, nowHm, { planCategoryIds: planIds, pages: menuBook });
  const initialTabId = initialHandyTab(tabs, planIds, plan.hasPlan);
  return { tabs, initialTabId, optionGroupsByItem };
}
