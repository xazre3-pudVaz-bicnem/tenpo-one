/**
 * 注文明細の原価計算（レポート・ダッシュボード共通）。
 * 原価優先順位: レシピ原価（menu_item_ingredients） > menu_items.cost > 計算対象外。
 * components/costing/data.ts の fetchIngredientLinesByMenuItems と組み合わせて使う。
 */
import { calcRecipeCost, type RecipeLine } from '@/lib/costing';

export interface CostableOrderItem {
  menu_item_id: string | null;
  quantity: number;
  line_total: number;
  menu_items: { cost: number | null } | null;
}

/** 商品原価を解決する。レシピ登録があればレシピ原価、無ければ手入力原価、どちらも無ければ null */
export function resolveUnitCost(
  menuItemId: string | null,
  manualCost: number | null,
  linesByItem: Map<string, RecipeLine[]>
): number | null {
  if (menuItemId) {
    const lines = linesByItem.get(menuItemId);
    if (lines && lines.length > 0) return calcRecipeCost(lines).totalCost;
  }
  return manualCost ?? null;
}

export interface CostSummary {
  /** 原価が算出できた明細の原価合計 */
  totalCost: number;
  /** 原価未設定のため計算から除外した明細の売上（注記用） */
  excludedRevenue: number;
  /** 原価未設定の明細件数（注記用） */
  excludedCount: number;
}

export function summarizeItemCosts(
  items: CostableOrderItem[],
  linesByItem: Map<string, RecipeLine[]>
): CostSummary {
  let totalCost = 0;
  let excludedRevenue = 0;
  let excludedCount = 0;
  for (const oi of items) {
    const unitCost = resolveUnitCost(oi.menu_item_id, oi.menu_items?.cost ?? null, linesByItem);
    if (unitCost == null) {
      excludedRevenue += oi.line_total;
      excludedCount += 1;
      continue;
    }
    totalCost += unitCost * oi.quantity;
  }
  return { totalCost, excludedRevenue, excludedCount };
}
