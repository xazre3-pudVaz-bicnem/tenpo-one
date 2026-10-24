/**
 * 原価管理（/app/costing）の画面の組み立てに使う純関数（テスト対象）。
 * Web の page.tsx と iPad ネイティブ（lib/native-modules/costing.ts）で同じものを使う。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から切り出した（中身は変えていない）。
 */
import { calcWasteAmount } from '@/lib/costing';
import { COST_RATE_WARNING_THRESHOLD, PRICE_DEVIATION_THRESHOLD } from '@/components/costing/labels';

/** [items] 上の3つの数字（平均原価率・レシピ設定済み商品数・要注意商品数） */
export interface CostRowsSummary {
  /** 原価率が出ている商品の平均（%小数1桁）。1件もなければ null */
  avgCostRate: number | null;
  /** レシピ（食材1件以上）を設定した商品数 */
  recipeSetCount: number;
  /** 原価率が要注意しきい値（30%）を超える商品数 */
  warningCount: number;
  /** 対象の商品数 */
  total: number;
}

export function summarizeCostRows(rows: { costRate: number | null; ingredientCount: number }[]): CostRowsSummary {
  const ratedRows = rows.filter((r) => r.costRate != null);
  const avgCostRate =
    ratedRows.length > 0
      ? Math.round((ratedRows.reduce((sum, r) => sum + (r.costRate ?? 0), 0) / ratedRows.length) * 10) / 10
      : null;
  const recipeSetCount = rows.filter((r) => r.ingredientCount > 0).length;
  const warningCount = ratedRows.filter((r) => (r.costRate ?? 0) > COST_RATE_WARNING_THRESHOLD).length;
  return { avgCostRate, recipeSetCount, warningCount, total: rows.length };
}

/** [impact] 平均仕入単価と最終仕入単価の両方がある食材 */
export interface ImpactIngredient {
  id: string;
  name: string;
  unit: string;
  avgCost: number;
  lastCost: number;
}

/** [impact] 最終仕入単価が平均から乖離率しきい値（10%）以上ずれている食材（乖離の大きい順に10件） */
export function pickPriceDeviations<T extends { avgCost: number; lastCost: number }>(
  ingredients: T[]
): (T & { deviationRate: number | null })[] {
  return ingredients
    .map((i) => ({
      ...i,
      deviationRate: i.avgCost > 0 ? Math.round((Math.abs(i.lastCost - i.avgCost) / i.avgCost) * 1000) / 10 : null,
    }))
    .filter((i) => i.deviationRate != null && i.deviationRate >= PRICE_DEVIATION_THRESHOLD)
    .sort((a, b) => (b.deviationRate ?? 0) - (a.deviationRate ?? 0))
    .slice(0, 10);
}

/** [waste] 廃棄の記録 1 件（stock_movements の movement_type='waste'） */
export interface WasteMovementInput {
  inventoryItemId: string;
  /** 品目名（品目が消えていれば null） */
  name: string | null;
  unit: string | null;
  quantity: number;
  unitCost: number | null;
  reason: string | null;
}

/** [waste] 廃棄一覧の 1 行（品目ごと） */
export interface WasteRow {
  id: string;
  name: string;
  unit: string;
  /** 廃棄数量の合計（絶対値） */
  quantity: number;
  /** 廃棄額（Σ 数量×単価、単価のない記録は除く） */
  amount: number;
  /** 理由ごとの件数（例：期限切れ×2、落下×1） */
  reasonSummary: string;
}

/** [waste] 廃棄の記録を品目ごとにまとめる（廃棄額の大きい順）。合計廃棄額も返す */
export function groupWasteMovements(movements: WasteMovementInput[]): { rows: WasteRow[]; totalAmount: number } {
  interface WasteGroup {
    id: string;
    name: string;
    unit: string;
    quantity: number;
    movements: { quantity: number; unitCost: number | null }[];
    reasons: Map<string, number>;
  }
  const groups = new Map<string, WasteGroup>();
  for (const m of movements) {
    let g = groups.get(m.inventoryItemId);
    if (!g) {
      g = { id: m.inventoryItemId, name: m.name ?? '（不明な食材）', unit: m.unit ?? '', quantity: 0, movements: [], reasons: new Map() };
      groups.set(m.inventoryItemId, g);
    }
    g.quantity += Math.abs(m.quantity);
    g.movements.push({ quantity: m.quantity, unitCost: m.unitCost });
    const reason = (m.reason && m.reason.trim()) || '理由未記入';
    g.reasons.set(reason, (g.reasons.get(reason) ?? 0) + 1);
  }
  const rows = [...groups.values()]
    .map((g) => ({
      id: g.id,
      name: g.name,
      unit: g.unit,
      quantity: g.quantity,
      amount: calcWasteAmount(g.movements),
      reasonSummary: [...g.reasons.entries()].map(([r, c]) => `${r}×${c}`).join('、'),
    }))
    .sort((a, b) => b.amount - a.amount);
  const totalAmount = calcWasteAmount(movements.map((m) => ({ quantity: m.quantity, unitCost: m.unitCost })));
  return { rows, totalAmount };
}

/** レシピの食材の選択肢（components/costing/recipe-line-form.tsx の IngredientOption と同じ形） */
export interface CostingIngredientOption {
  id: string;
  name: string;
  unit: string;
  avgCost: number | null;
}

/**
 * レシピ食材の選択肢: 全店共通運用のため、重複名を除いた品目名で表示し選択は品目ID。
 * 同名品目が複数店舗にある場合は、当ユーザーの現在店舗の品目を優先する。並びは名前順（日本語）。
 */
export function dedupeIngredientOptions(
  items: { id: string; name: string; unit: string; avg_cost: number | null; store_id: string | null }[],
  preferStoreId: string | null
): CostingIngredientOption[] {
  const sorted = [...items].sort((a, b) => {
    const aPref = preferStoreId && a.store_id === preferStoreId ? 0 : 1;
    const bPref = preferStoreId && b.store_id === preferStoreId ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    return a.name.localeCompare(b.name, 'ja');
  });
  const seenNames = new Set<string>();
  const options: CostingIngredientOption[] = [];
  for (const it of sorted) {
    if (seenNames.has(it.name)) continue;
    seenNames.add(it.name);
    options.push({ id: it.id, name: it.name, unit: it.unit, avgCost: it.avg_cost });
  }
  options.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return options;
}
