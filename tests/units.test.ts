import { describe, expect, it } from 'vitest';
import {
  hasCostPrecisionRisk,
  purchaseToStockQty,
  purchaseToStockUnitCost,
  suggestConversionFactor,
} from '@/lib/units';

describe('suggestConversionFactor（単位ペアの推奨係数）', () => {
  it('kg→g は 1000、L→ml は 1000', () => {
    expect(suggestConversionFactor('kg', 'g')).toBe(1000);
    expect(suggestConversionFactor('L', 'ml')).toBe(1000);
  });
  it('同一単位は 1', () => {
    expect(suggestConversionFactor('個', '個')).toBe(1);
    expect(suggestConversionFactor('袋', '袋')).toBe(1);
  });
  it('不明な組み合わせ（ケース→個等）は null（手入力を促す）', () => {
    expect(suggestConversionFactor('ケース', '個')).toBeNull();
    expect(suggestConversionFactor('箱', '本')).toBeNull();
  });
});

describe('purchaseToStockQty（仕入→在庫数量）', () => {
  it('鶏肉 5kg 入荷（係数1000）→ 在庫 5000g', () => {
    expect(purchaseToStockQty(5, 1000)).toBe(5000);
  });
  it('唐揚げ1食200g × 25食販売 = 5000g 消費（在庫単位で成立）', () => {
    // レシピは在庫単位（g）で記述されるため、25食×200g = 5kg分の理論減少
    expect(200 * 25).toBe(purchaseToStockQty(5, 1000));
  });
  it('ビール 2ケース（1ケース=24本・係数24）→ 48本', () => {
    expect(purchaseToStockQty(2, 24)).toBe(48);
  });
  it('係数0以下は例外', () => {
    expect(() => purchaseToStockQty(5, 0)).toThrow();
  });
});

describe('purchaseToStockUnitCost（仕入単価→在庫単価）', () => {
  it('鶏肉 1200円/kg・係数1000 → 1円/g（四捨五入）', () => {
    expect(purchaseToStockUnitCost(1200, 1000)).toBe(1);
  });
  it('ビール 6000円/ケース（24本）→ 250円/本', () => {
    expect(purchaseToStockUnitCost(6000, 24)).toBe(250);
  });
  it('係数1なら仕入単価そのまま', () => {
    expect(purchaseToStockUnitCost(780, 1)).toBe(780);
  });
});

describe('hasCostPrecisionRisk（丸め誤差の警告）', () => {
  it('1200円/kg→1.2円/g は誤差17%で警告', () => {
    expect(hasCostPrecisionRisk(1200, 1000)).toBe(true);
  });
  it('6000円/ケース→250円/本 は誤差なしで警告なし', () => {
    expect(hasCostPrecisionRisk(6000, 24)).toBe(false);
  });
  it('変換後単価が0円になる場合は必ず警告', () => {
    expect(hasCostPrecisionRisk(400, 1000)).toBe(true);
  });
});
