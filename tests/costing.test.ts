import { describe, expect, it } from 'vitest';
import {
  calcPriceChangeImpact, calcRecipeCost, calcWasteAmount, costRate, grossProfit,
} from '@/lib/costing';

describe('calcRecipeCost（レシピ原価）', () => {
  it('唐揚げ定食: 食材別原価の合算（切り上げ）', () => {
    // 鶏肉200g(2.5円/g) + 油20ml(0.3円/ml) + キャベツ80g(0.5円/g) + 米200g(0.6円/g)
    const r = calcRecipeCost([
      { ingredientName: '鶏肉', quantity: 200, avgCost: 2.5 },
      { ingredientName: '油', quantity: 20, avgCost: 0.3 },
      { ingredientName: 'キャベツ', quantity: 80, avgCost: 0.5 },
      { ingredientName: '米', quantity: 200, avgCost: 0.6 },
    ]);
    expect(r.totalCost).toBe(500 + 6 + 40 + 120);
    expect(r.missingCostCount).toBe(0);
    expect(r.lines[0]).toEqual({ ingredientName: '鶏肉', cost: 500 });
  });

  it('原価未設定の食材は除外し件数を返す', () => {
    const r = calcRecipeCost([
      { ingredientName: '鶏肉', quantity: 200, avgCost: 2.5 },
      { ingredientName: '調味料', quantity: 1, avgCost: null },
    ]);
    expect(r.totalCost).toBe(500);
    expect(r.missingCostCount).toBe(1);
    expect(r.lines[1].cost).toBeNull();
  });

  it('端数は切り上げ（保守的見積り）', () => {
    const r = calcRecipeCost([{ ingredientName: 'a', quantity: 3, avgCost: 0.4 }]);
    expect(r.totalCost).toBe(2); // 1.2 → 2
  });
});

describe('costRate / grossProfit', () => {
  it('原価率 = 原価/売価（%小数1桁）', () => {
    expect(costRate(300, 1000)).toBe(30);
    expect(costRate(333, 1000)).toBe(33.3);
    expect(costRate(300, 0)).toBeNull();
  });
  it('粗利益と粗利率', () => {
    const g = grossProfit(1000, 300);
    expect(g.profit).toBe(700);
    expect(g.rate).toBe(70);
  });
});

describe('calcPriceChangeImpact（仕入価格変動の影響）', () => {
  it('鶏肉が2.5→3.0円/gに上がると唐揚げ定食の原価が100円上がる', () => {
    const [impact] = calcPriceChangeImpact(
      [{ menuItemName: '唐揚げ定食', quantity: 200, currentRecipeCost: 666, price: 1000 }],
      2.5,
      3.0
    );
    expect(impact.costDelta).toBe(100);
    expect(impact.newCost).toBe(766);
    expect(impact.oldCostRate).toBe(66.6);
    expect(impact.newCostRate).toBe(76.6);
  });
  it('値下げなら負の差分', () => {
    const [impact] = calcPriceChangeImpact(
      [{ menuItemName: 'サラダ', quantity: 100, currentRecipeCost: 200, price: 500 }],
      1.0,
      0.8
    );
    expect(impact.costDelta).toBe(-20);
  });
});

describe('calcWasteAmount（廃棄額）', () => {
  it('廃棄数量×単価の合算（数量は負でも絶対値）', () => {
    expect(
      calcWasteAmount([
        { quantity: -2, unitCost: 780 },
        { quantity: -1.5, unitCost: 100 },
        { quantity: -3, unitCost: null },
      ])
    ).toBe(1560 + 150);
  });
});
