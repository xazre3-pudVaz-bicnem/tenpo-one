/** 原価管理モジュール共通のデータ取得（商品原価一覧・CSV出力から共用） */
import type { createClient } from '@/lib/supabase/server';
import { calcRecipeCost, costRate, grossProfit, type RecipeLine } from '@/lib/costing';
import {
  COSTABLE_ITEM_TYPES,
  resolveDisplayCost,
  type CostableItemType,
  type MenuItemCostRow,
} from './labels';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** 対象menu_itemのレシピ明細（品目名・使用量・平均仕入単価）をmenu_item_id単位でまとめて取得する */
export async function fetchIngredientLinesByMenuItems(
  supabase: SupabaseClient,
  menuItemIds: string[]
): Promise<Map<string, RecipeLine[]>> {
  const map = new Map<string, RecipeLine[]>();
  if (menuItemIds.length === 0) return map;

  const { data } = await supabase
    .from('menu_item_ingredients')
    .select('menu_item_id, quantity, inventory_items(name, avg_cost)')
    .in('menu_item_id', menuItemIds);

  for (const row of data ?? []) {
    const inv = row.inventory_items as unknown as { name: string; avg_cost: number | null } | null;
    const line: RecipeLine = {
      ingredientName: inv?.name ?? '（不明な食材）',
      quantity: Number(row.quantity),
      avgCost: inv?.avg_cost ?? null,
    };
    const list = map.get(row.menu_item_id as string);
    if (list) list.push(line);
    else map.set(row.menu_item_id as string, [line]);
  }
  return map;
}

interface RawMenuItem {
  id: string;
  category_id: string | null;
  name: string;
  item_type: string;
  price: number;
  cost: number | null;
}

/** menu_item + レシピ明細から一覧の1行を組み立てる */
export function buildCostRow(
  item: RawMenuItem,
  categoryName: string,
  lines: RecipeLine[]
): MenuItemCostRow {
  const ingredientCount = lines.length;
  const recipeResult = calcRecipeCost(lines);
  const recipeCost = ingredientCount > 0 ? recipeResult.totalCost : null;
  const displayCost = resolveDisplayCost(recipeCost, item.cost);
  const rate = displayCost != null ? costRate(displayCost, item.price) : null;
  const gp = displayCost != null ? grossProfit(item.price, displayCost) : { profit: null, rate: null };

  return {
    id: item.id,
    name: item.name,
    categoryName,
    itemType: item.item_type as CostableItemType,
    price: item.price,
    manualCost: item.cost,
    recipeCost,
    ingredientCount,
    missingCostCount: recipeResult.missingCostCount,
    displayCost,
    costRate: rate,
    grossProfitYen: gp.profit,
    grossProfitRate: gp.rate,
  };
}

export interface CostRowFilters {
  categoryId?: string | null;
  q?: string | null;
}

/** 対象店舗（全店共通商品 + 当店固有商品）のactiveなfood/drink/course商品を原価付きで取得する */
export async function fetchMenuItemCostRows(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  filters: CostRowFilters = {}
): Promise<{ rows: MenuItemCostRow[]; categories: { id: string; name: string }[] }> {
  const { data: categories } = await supabase
    .from('menu_categories')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('sort_order');
  const categoryMap = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));

  let query = supabase
    .from('menu_items')
    .select('id, category_id, name, item_type, price, cost')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .in('item_type', COSTABLE_ITEM_TYPES)
    .or(`store_id.is.null,store_id.eq.${storeId}`);
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters.q) query = query.ilike('name', `%${filters.q}%`);

  const { data: menuItems } = await query.order('name');
  const items = (menuItems ?? []) as RawMenuItem[];
  const linesByItem = await fetchIngredientLinesByMenuItems(
    supabase,
    items.map((i) => i.id)
  );

  const rows = items.map((i) =>
    buildCostRow(i, i.category_id ? (categoryMap.get(i.category_id) ?? '未分類') : '未分類', linesByItem.get(i.id) ?? [])
  );

  return { rows, categories: (categories ?? []).map((c) => ({ id: c.id as string, name: c.name as string })) };
}
