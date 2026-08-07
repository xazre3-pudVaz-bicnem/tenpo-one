/**
 * 在庫単位変換（テスト対象）。
 * 仕入単位（kg/L/ケース等）と在庫単位（g/ml/個等）を係数で変換する。
 * 例: 鶏肉を「kg」で仕入れ「g」で在庫管理 → 係数1000。5kg入荷 = 5000g。
 * レシピ（唐揚げ1食=鶏肉200g）はすべて在庫単位で記述するため、
 * 25食販売 → 理論在庫5000g減少が成立する。
 */

export const STOCK_UNITS = ['g', 'kg', 'ml', 'L', '個', '本', '袋', '箱', 'ケース', '樽', '枚', '食'] as const;

/** 既知の単位ペアの標準係数（仕入単位 → 在庫単位） */
const KNOWN_FACTORS: Record<string, number> = {
  'kg>g': 1000,
  'g>g': 1,
  'kg>kg': 1,
  'L>ml': 1000,
  'ml>ml': 1,
  'L>L': 1,
};

/** 仕入単位と在庫単位から推奨係数を返す（不明な組み合わせは null = 手入力） */
export function suggestConversionFactor(purchaseUnit: string, stockUnit: string): number | null {
  if (purchaseUnit === stockUnit) return 1;
  return KNOWN_FACTORS[`${purchaseUnit}>${stockUnit}`] ?? null;
}

/** 仕入数量 → 在庫数量（係数は正であること） */
export function purchaseToStockQty(purchaseQty: number, factor: number): number {
  if (factor <= 0) throw new Error('変換係数は正の数で指定してください');
  return purchaseQty * factor;
}

/**
 * 仕入単価（円/仕入単位） → 在庫単価（円/在庫単位）。
 * avg_cost は在庫単位あたりで保持する。原価は保守的に切り上げず、
 * 在庫単価は小数を許さず四捨五入（円未満の管理はしない）。
 * 例: 鶏肉 5kg=6,000円（1,200円/kg）・係数1000 → 1.2円/g → 1円/g（丸め）
 * 丸め誤差が大きい食材（円/g < 10）は原価計算で乖離するため、
 * 呼び出し側で「在庫単位あたり単価が10円未満になる場合」は係数の見直しを促すこと。
 */
export function purchaseToStockUnitCost(purchaseUnitCost: number, factor: number): number {
  if (factor <= 0) throw new Error('変換係数は正の数で指定してください');
  return Math.round(purchaseUnitCost / factor);
}

/**
 * 在庫単価の精度警告: 変換後単価が小さすぎる（丸め誤差率が大きい）場合 true。
 * 例: 1.2円/g → 1円/g は誤差17%。この場合は在庫単位を「100gあたり」等へ
 * 変更するか、係数を調整して単価精度を確保することを促す。
 */
export function hasCostPrecisionRisk(purchaseUnitCost: number, factor: number): boolean {
  if (factor <= 0) return false;
  const exact = purchaseUnitCost / factor;
  if (exact <= 0) return false;
  const rounded = Math.round(exact);
  if (rounded === 0) return true;
  return Math.abs(exact - rounded) / exact > 0.05;
}
