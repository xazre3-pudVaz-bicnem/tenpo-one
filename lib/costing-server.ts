import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { calcPriceChangeImpact, calcRecipeCost, costRate, grossProfit, type PriceImpact, type PriceImpactInput, type RecipeLine } from '@/lib/costing';
import { daysAgoJst, todayJst } from '@/lib/format';
import { fetchIngredientLinesByMenuItems, fetchMenuItemCostRows } from '@/components/costing/data';
import { COSTABLE_ITEM_TYPES, WASTE_DEFAULT_DAYS, resolveDisplayCost, type MenuItemCostRow } from '@/components/costing/labels';
import {
  dedupeIngredientOptions,
  groupWasteMovements,
  pickPriceDeviations,
  summarizeCostRows,
  type CostingIngredientOption,
  type CostRowsSummary,
  type ImpactIngredient,
  type WasteRow,
} from '@/lib/costing-view';

/**
 * 原価管理（/app/costing・/app/costing/[menuItemId]）の読み込み。
 * Web の page.tsx と iPad ネイティブ（lib/native-modules/costing.ts）で同じものを使う（lib/kds-server.ts と同じやり方）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から切り出した（中身は変えていない）。
 */

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// MARK: [items] 商品原価

export interface CostingItemsData {
  rows: MenuItemCostRow[];
  categories: { id: string; name: string }[];
  summary: CostRowsSummary;
}

/** [items] 商品原価一覧（カテゴリ・商品名で絞り込み）と上の3つの数字 */
export async function loadCostingItems(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  filters: { category?: string | null; q?: string | null }
): Promise<CostingItemsData> {
  const { rows, categories } = await fetchMenuItemCostRows(supabase, organizationId, storeId, {
    categoryId: filters.category || null,
    q: filters.q || null,
  });
  return { rows, categories, summary: summarizeCostRows(rows) };
}

// MARK: [impact] 仕入影響

export interface CostingImpactData {
  /** 平均仕入単価と最終仕入単価の両方が登録されている食材（選択肢） */
  ingredients: ImpactIngredient[];
  /** 乖離率しきい値以上の食材（上位10件） */
  deviations: (ImpactIngredient & { deviationRate: number | null })[];
  /** 選んだ食材（見つからなければ null） */
  selected: ImpactIngredient | null;
  /** 選んだ食材を使う商品への影響 */
  impactRows: PriceImpact[];
}

/** [impact] 仕入価格変動の影響分析 */
export async function loadCostingImpact(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  selectedIngredientId: string | null
): Promise<CostingImpactData> {
  const { data: invItemsData } = await supabase
    .from('inventory_items')
    .select('id, name, unit, avg_cost, last_purchase_cost')
    .eq('organization_id', organizationId)
    .eq('store_id', storeId)
    .eq('status', 'active')
    .not('avg_cost', 'is', null)
    .not('last_purchase_cost', 'is', null)
    .order('name');

  const ingredients: ImpactIngredient[] = (invItemsData ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
    unit: i.unit as string,
    avgCost: i.avg_cost as number,
    lastCost: i.last_purchase_cost as number,
  }));

  const deviations = pickPriceDeviations(ingredients);

  const selected = selectedIngredientId ? (ingredients.find((i) => i.id === selectedIngredientId) ?? null) : null;

  let impactRows: PriceImpact[] = [];
  if (selected) {
    const { data: recipeUse } = await supabase
      .from('menu_item_ingredients')
      .select('menu_item_id, quantity, menu_items(name, price, status, item_type)')
      .eq('inventory_item_id', selected.id);

    const usedItems = (recipeUse ?? [])
      .map((r) => ({
        menuItemId: r.menu_item_id as string,
        quantity: Number(r.quantity),
        menuItem: r.menu_items as unknown as { name: string; price: number; status: string; item_type: string } | null,
      }))
      .filter(
        (r): r is { menuItemId: string; quantity: number; menuItem: { name: string; price: number; status: string; item_type: string } } =>
          !!r.menuItem && r.menuItem.status === 'active' && (COSTABLE_ITEM_TYPES as string[]).includes(r.menuItem.item_type)
      );

    const menuItemIds = [...new Set(usedItems.map((u) => u.menuItemId))];
    const linesByItem = await fetchIngredientLinesByMenuItems(supabase, menuItemIds);

    const inputs: PriceImpactInput[] = usedItems.map((u) => ({
      menuItemName: u.menuItem.name,
      quantity: u.quantity,
      currentRecipeCost: calcRecipeCost(linesByItem.get(u.menuItemId) ?? []).totalCost,
      price: u.menuItem.price,
    }));

    impactRows = calcPriceChangeImpact(inputs, selected.avgCost, selected.lastCost);
  }

  return { ingredients, deviations, selected, impactRows };
}

// MARK: [waste] 廃棄・在庫差異

export interface CostingDiffRow {
  id: string;
  name: string;
  unit: string;
  expected: number;
  counted: number;
  diff: number;
  diffAmount: number | null;
}

export interface CostingWasteData {
  today: string;
  rangeFrom: string;
  rangeTo: string;
  wasteRows: WasteRow[];
  totalWasteAmount: number;
  /** 直近の確定済み棚卸（なければ null） */
  latestCount: { id: string; countDate: string } | null;
  /** 直近の棚卸で差異のあった品目 */
  diffRows: CostingDiffRow[];
  /** 期間のプリセット（7日・30日・90日） */
  periods: { label: string; from: string; to: string }[];
}

/** [waste] 廃棄（期間・既定は30日）と在庫差異（直近の確定済み棚卸） */
export async function loadCostingWaste(
  supabase: SupabaseClient,
  organizationId: string,
  storeId: string,
  from?: string,
  to?: string
): Promise<CostingWasteData> {
  const today = todayJst();
  const rangeFrom = from || daysAgoJst(WASTE_DEFAULT_DAYS - 1);
  const rangeTo = to || today;

  const { data: wasteMovements } = await supabase
    .from('stock_movements')
    .select('inventory_item_id, quantity, unit_cost, reason, inventory_items(name, unit)')
    .eq('organization_id', organizationId)
    .eq('store_id', storeId)
    .eq('movement_type', 'waste')
    .gte('business_date', rangeFrom)
    .lte('business_date', rangeTo);

  const { rows: wasteRows, totalAmount: totalWasteAmount } = groupWasteMovements(
    (wasteMovements ?? []).map((m) => {
      const inv = m.inventory_items as unknown as { name: string; unit: string } | null;
      return {
        inventoryItemId: m.inventory_item_id as string,
        name: inv?.name ?? null,
        unit: inv?.unit ?? null,
        quantity: Number(m.quantity),
        unitCost: m.unit_cost as number | null,
        reason: (m.reason as string | null) ?? null,
      };
    })
  );

  const { data: latestCount } = await supabase
    .from('stock_counts')
    .select('id, count_date')
    .eq('organization_id', organizationId)
    .eq('store_id', storeId)
    .eq('status', 'completed')
    .order('count_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  let diffRows: CostingDiffRow[] = [];
  if (latestCount) {
    const { data: countItems } = await supabase
      .from('stock_count_items')
      .select('id, expected_quantity, counted_quantity, difference, inventory_items(name, unit, avg_cost)')
      .eq('stock_count_id', latestCount.id);
    diffRows = (countItems ?? [])
      .filter((ci) => ci.difference != null && Number(ci.difference) !== 0)
      .map((ci) => {
        const inv = ci.inventory_items as unknown as { name: string; unit: string; avg_cost: number | null } | null;
        const diff = Number(ci.difference);
        return {
          id: ci.id as string,
          name: inv?.name ?? '（不明な食材）',
          unit: inv?.unit ?? '',
          expected: Number(ci.expected_quantity),
          counted: Number(ci.counted_quantity),
          diff,
          diffAmount: inv?.avg_cost != null ? Math.round(diff * inv.avg_cost) : null,
        };
      });
  }

  const periods = [
    { label: '7日', from: daysAgoJst(6), to: today },
    { label: '30日', from: daysAgoJst(29), to: today },
    { label: '90日', from: daysAgoJst(89), to: today },
  ];

  return {
    today,
    rangeFrom,
    rangeTo,
    wasteRows,
    totalWasteAmount,
    latestCount: latestCount ? { id: latestCount.id as string, countDate: String(latestCount.count_date) } : null,
    diffRows,
    periods,
  };
}

// MARK: レシピ編集（/app/costing/[menuItemId]）

export interface RecipeDetailLine {
  id: string;
  inventoryItemId: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  avgCost: number | null;
  lineCost: number | null;
  note: string | null;
}

export interface RecipeDetailData {
  menuItem: { id: string; name: string; item_type: string; price: number; cost: number | null; status: string };
  lineRows: RecipeDetailLine[];
  /** 原価未設定の食材数 */
  missingCostCount: number;
  /** レシピ原価（食材0件は null） */
  recipeCost: number | null;
  /** 表示する原価（レシピ原価を優先、なければ手入力原価） */
  displayCost: number | null;
  rate: number | null;
  gp: { profit: number | null; rate: number | null };
  ingredientOptions: CostingIngredientOption[];
}

/** レシピ編集の画面の中身。商品が見つからなければ null（Web は notFound） */
export async function loadRecipeDetail(
  supabase: SupabaseClient,
  organizationId: string,
  preferStoreId: string | null,
  menuItemId: string
): Promise<RecipeDetailData | null> {
  const { data: menuItem } = await supabase
    .from('menu_items')
    .select('id, name, item_type, price, cost, status')
    .eq('id', menuItemId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!menuItem) return null;

  const { data: lineData } = await supabase
    .from('menu_item_ingredients')
    .select('id, inventory_item_id, quantity, note, inventory_items(name, unit, avg_cost)')
    .eq('menu_item_id', menuItemId)
    .order('created_at');
  const rawLines = lineData ?? [];

  const recipeLines: RecipeLine[] = rawLines.map((l) => {
    const inv = l.inventory_items as unknown as { name: string; unit: string; avg_cost: number | null } | null;
    return { ingredientName: inv?.name ?? '（不明な食材）', quantity: Number(l.quantity), avgCost: inv?.avg_cost ?? null };
  });
  const costResult = calcRecipeCost(recipeLines);

  const lineRows: RecipeDetailLine[] = rawLines.map((l, idx) => {
    const inv = l.inventory_items as unknown as { name: string; unit: string; avg_cost: number | null } | null;
    return {
      id: l.id as string,
      inventoryItemId: l.inventory_item_id as string,
      ingredientName: inv?.name ?? '（不明な食材）',
      unit: inv?.unit ?? '',
      quantity: Number(l.quantity),
      avgCost: inv?.avg_cost ?? null,
      lineCost: costResult.lines[idx]?.cost ?? null,
      note: l.note as string | null,
    };
  });

  const recipeCost = lineRows.length > 0 ? costResult.totalCost : null;
  const displayCost = resolveDisplayCost(recipeCost, menuItem.cost as number | null);
  const rate = displayCost != null ? costRate(displayCost, menuItem.price as number) : null;
  const gp = displayCost != null ? grossProfit(menuItem.price as number, displayCost) : { profit: null, rate: null };

  // レシピ食材の選択肢（全店の active な品目。同名は現在店舗の品目を優先して 1 つに）
  const { data: allInvItems } = await supabase
    .from('inventory_items')
    .select('id, name, unit, avg_cost, store_id')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('name');
  const ingredientOptions = dedupeIngredientOptions(
    (allInvItems ?? []).map((it) => ({
      id: it.id as string,
      name: it.name as string,
      unit: it.unit as string,
      avg_cost: it.avg_cost as number | null,
      store_id: (it.store_id as string | null) ?? null,
    })),
    preferStoreId
  );

  return {
    menuItem: {
      id: menuItem.id as string,
      name: menuItem.name as string,
      item_type: menuItem.item_type as string,
      price: menuItem.price as number,
      cost: menuItem.cost as number | null,
      status: menuItem.status as string,
    },
    lineRows,
    missingCostCount: costResult.missingCostCount,
    recipeCost,
    displayCost,
    rate,
    gp,
    ingredientOptions,
  };
}
