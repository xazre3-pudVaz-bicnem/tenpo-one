/**
 * 原価管理の純関数（テスト対象）。
 * レシピ原価・原価率・粗利・仕入価格変動の影響計算。
 * 金額は円の整数（端数は切り上げ: 原価は保守的に見積もる）。
 */

export interface RecipeLine {
  ingredientName: string;
  /** 1商品あたりの使用量（品目の在庫単位で） */
  quantity: number;
  /** 品目の平均仕入単価（円/在庫単位）。未設定はnull */
  avgCost: number | null;
}

export interface RecipeCostResult {
  /** 1商品原価（円）。原価未設定の食材は除外して合算 */
  totalCost: number;
  /** 食材別内訳 */
  lines: { ingredientName: string; cost: number | null }[];
  /** 原価未設定の食材数（画面で注記する） */
  missingCostCount: number;
}

/** レシピから1商品原価を計算する */
export function calcRecipeCost(lines: RecipeLine[]): RecipeCostResult {
  let total = 0;
  let missing = 0;
  const detail = lines.map((l) => {
    if (l.avgCost == null) {
      missing++;
      return { ingredientName: l.ingredientName, cost: null };
    }
    const cost = Math.ceil(l.quantity * l.avgCost);
    total += cost;
    return { ingredientName: l.ingredientName, cost };
  });
  return { totalCost: total, lines: detail, missingCostCount: missing };
}

/** 原価率（%小数1桁）。税込売価に対する原価の割合 */
export function costRate(costYen: number, priceYen: number): number | null {
  if (priceYen <= 0) return null;
  return Math.round((costYen / priceYen) * 1000) / 10;
}

/** 粗利益と粗利率 */
export function grossProfit(priceYen: number, costYen: number): { profit: number; rate: number | null } {
  const profit = priceYen - costYen;
  return { profit, rate: costRate(profit, priceYen) };
}

/**
 * 仕入価格変更の影響。
 * 対象食材の単価が oldCost → newCost に変わったとき、
 * その食材を使う各商品の原価がどれだけ変化するかを返す。
 */
export interface PriceImpactInput {
  menuItemName: string;
  /** 対象食材の1商品あたり使用量 */
  quantity: number;
  currentRecipeCost: number;
  price: number;
}

export interface PriceImpact {
  menuItemName: string;
  costDelta: number;
  newCost: number;
  oldCostRate: number | null;
  newCostRate: number | null;
}

export function calcPriceChangeImpact(
  items: PriceImpactInput[],
  oldCost: number,
  newCost: number
): PriceImpact[] {
  return items.map((item) => {
    const delta = Math.ceil(item.quantity * newCost) - Math.ceil(item.quantity * oldCost);
    const updated = item.currentRecipeCost + delta;
    return {
      menuItemName: item.menuItemName,
      costDelta: delta,
      newCost: updated,
      oldCostRate: costRate(item.currentRecipeCost, item.price),
      newCostRate: costRate(updated, item.price),
    };
  });
}

/** 廃棄額 = Σ(廃棄数量 × 単価)。単価未設定の movement は除外 */
export function calcWasteAmount(
  movements: { quantity: number; unitCost: number | null }[]
): number {
  return movements.reduce((acc, m) => {
    if (m.unitCost == null) return acc;
    return acc + Math.ceil(Math.abs(m.quantity) * m.unitCost);
  }, 0);
}
