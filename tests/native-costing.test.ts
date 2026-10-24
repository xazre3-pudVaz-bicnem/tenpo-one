import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dedupeIngredientOptions, groupWasteMovements, pickPriceDeviations, summarizeCostRows } from '@/lib/costing-view';
import { isIsoDate, parseNativeCostingAction, parseNativeCostingQuery } from '@/lib/native-costing';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ID = '11111111-2222-4333-8444-555555555555';
const ID2 = '66666666-7777-4888-9999-000000000000';
const ID3 = '22222222-3333-4444-8555-666666666666';

describe('原価管理の画面の組み立て（lib/costing-view.ts）', () => {
  it('上の3つの数字：平均原価率（原価率のある商品だけ・小数1桁）・レシピ設定済み・要注意（30%超）', () => {
    const s = summarizeCostRows([
      { costRate: 25, ingredientCount: 3 },
      { costRate: 30, ingredientCount: 0 },
      { costRate: 30.1, ingredientCount: 2 },
      { costRate: null, ingredientCount: 0 },
    ]);
    expect(s).toEqual({ avgCostRate: 28.4, recipeSetCount: 2, warningCount: 1, total: 4 });
    expect(summarizeCostRows([])).toEqual({ avgCostRate: null, recipeSetCount: 0, warningCount: 0, total: 0 });
  });

  it('仕入単価の乖離：10%以上だけ・大きい順・10件まで・平均0は出さない', () => {
    const list = [
      { id: 'a', avgCost: 100, lastCost: 109 },
      { id: 'b', avgCost: 100, lastCost: 110 },
      { id: 'c', avgCost: 100, lastCost: 70 },
      { id: 'd', avgCost: 0, lastCost: 50 },
    ];
    const r = pickPriceDeviations(list);
    expect(r.map((x) => [x.id, x.deviationRate])).toEqual([
      ['c', 30],
      ['b', 10],
    ]);
    const many = Array.from({ length: 15 }, (_, i) => ({ id: String(i), avgCost: 100, lastCost: 120 + i }));
    expect(pickPriceDeviations(many)).toHaveLength(10);
    expect(pickPriceDeviations(many)[0].id).toBe('14');
  });

  it('廃棄：品目ごと（数量は絶対値の合計・廃棄額は切り上げ・単価なしは除く）・理由の件数・廃棄額の大きい順', () => {
    const { rows, totalAmount } = groupWasteMovements([
      { inventoryItemId: ID, name: '鶏肉', unit: 'g', quantity: -200, unitCost: 2.5, reason: '期限切れ' },
      { inventoryItemId: ID, name: '鶏肉', unit: 'g', quantity: -100, unitCost: 2.5, reason: ' ' },
      { inventoryItemId: ID2, name: null, unit: null, quantity: -3, unitCost: null, reason: '落下' },
      { inventoryItemId: ID3, name: '米', unit: 'g', quantity: -1000, unitCost: 0.6, reason: '期限切れ' },
    ]);
    expect(rows.map((r) => [r.name, r.quantity, r.amount, r.reasonSummary])).toEqual([
      ['鶏肉', 300, 750, '期限切れ×1、理由未記入×1'],
      ['米', 1000, 600, '期限切れ×1'],
      ['（不明な食材）', 3, 0, '落下×1'],
    ]);
    expect(rows[2].unit).toBe('');
    expect(totalAmount).toBe(1350);
  });

  it('レシピの食材の選択肢：同じ名前は今の店の品目を1つだけ・名前順', () => {
    const opts = dedupeIngredientOptions(
      [
        { id: 'x1', name: '鶏肉', unit: 'g', avg_cost: 3, store_id: 'other' },
        { id: 'x2', name: '鶏肉', unit: 'g', avg_cost: 2, store_id: 'mine' },
        { id: 'x3', name: 'キャベツ', unit: 'g', avg_cost: null, store_id: 'other' },
      ],
      'mine'
    );
    expect(opts).toEqual([
      { id: 'x3', name: 'キャベツ', unit: 'g', avgCost: null },
      { id: 'x2', name: '鶏肉', unit: 'g', avgCost: 2 },
    ]);
    // 店がなければ名前順で最初のもの
    expect(dedupeIngredientOptions([{ id: 'x1', name: '鶏肉', unit: 'g', avg_cost: 3, store_id: 'a' }, { id: 'x2', name: '鶏肉', unit: 'g', avg_cost: 2, store_id: 'b' }], null)).toHaveLength(1);
  });
});

describe('iPad の原価管理の入力（lib/native-costing.ts）', () => {
  it('食材の追加：Web のフォームと同じ確認・同じことば（全角の数字も受ける・メモは空なら null）', () => {
    expect(parseNativeCostingAction({ type: 'costingLineAdd', menuItemId: ID, inventoryItemId: ID2, quantity: '２００', note: '  ' })).toEqual({
      ok: true,
      action: { type: 'costingLineAdd', menuItemId: ID, inventoryItemId: ID2, quantity: 200, note: null },
    });
    expect(parseNativeCostingAction({ type: 'costingLineAdd', menuItemId: ID, inventoryItemId: '', quantity: 1 })).toEqual({ ok: false, error: '食材を選択してください' });
    expect(parseNativeCostingAction({ type: 'costingLineAdd', menuItemId: ID, inventoryItemId: ID2, quantity: 0 })).toEqual({
      ok: false,
      error: '使用量は0より大きい値で入力してください',
    });
    expect(parseNativeCostingAction({ type: 'costingLineAdd', menuItemId: ID, inventoryItemId: ID2, quantity: 'abc' }).ok).toBe(false);
    expect(parseNativeCostingAction({ type: 'costingLineAdd', menuItemId: 'bad', inventoryItemId: ID2, quantity: 1 }).ok).toBe(false);
  });

  it('食材の編集・削除は行の id がいる', () => {
    expect(parseNativeCostingAction({ type: 'costingLineUpdate', lineId: ID3, menuItemId: ID, inventoryItemId: ID2, quantity: 0.5, note: '下味込み' })).toEqual({
      ok: true,
      action: { type: 'costingLineUpdate', lineId: ID3, menuItemId: ID, inventoryItemId: ID2, quantity: 0.5, note: '下味込み' },
    });
    expect(parseNativeCostingAction({ type: 'costingLineUpdate', menuItemId: ID, inventoryItemId: ID2, quantity: 1 }).ok).toBe(false);
    expect(parseNativeCostingAction({ type: 'costingLineDelete', lineId: ID3, menuItemId: ID })).toEqual({
      ok: true,
      action: { type: 'costingLineDelete', lineId: ID3, menuItemId: ID },
    });
    expect(parseNativeCostingAction({ type: 'costingLineDelete', menuItemId: ID }).ok).toBe(false);
    expect(parseNativeCostingAction({ type: 'nope', menuItemId: ID }).ok).toBe(false);
    expect(parseNativeCostingAction(null).ok).toBe(false);
  });

  it('GET の絞り込み：正しくない値は無いものに', () => {
    const q = parseNativeCostingQuery(new URLSearchParams({ category: ID, q: ' 唐揚げ ', ingredient: 'x', from: '2026-10-01', to: '2026-02-30', id: ID2 }));
    expect(q).toEqual({ category: ID, q: '唐揚げ', ingredient: null, from: '2026-10-01', to: undefined, id: ID2 });
    expect(parseNativeCostingQuery(new URLSearchParams())).toEqual({ category: null, q: null, ingredient: null, from: undefined, to: undefined, id: null });
    expect(isIsoDate('2026-10-24')).toBe(true);
    expect(isIsoDate('2026-1-24')).toBe(false);
  });

  it('Web とネイティブは同じ読み込み・同じ Server Action・同じ権限（機能 costing ＋ menu.manage）', () => {
    const list = read('app/app/costing/page.tsx');
    for (const fn of ['loadCostingItems(', 'loadCostingImpact(', 'loadCostingWaste(']) expect(list).toContain(fn);
    expect(read('app/app/costing/[menuItemId]/page.tsx')).toContain('loadRecipeDetail(');
    const mod = read('lib/native-modules/costing.ts');
    expect(mod).toContain("disabledFeatures?.has('costing')");
    expect(mod).toContain("can(ctx.role, 'menu.manage')");
    for (const fn of ['addRecipeLine', 'updateRecipeLine', 'deleteRecipeLine']) expect(mod).toContain(`await ${fn}(`);
    const registry = read('lib/native-modules/registry.ts');
    for (const key of ['costing: costingGet', 'costingImpact: costingImpactGet', 'costingWaste: costingWasteGet', 'costingItem: costingItemGet', 'costingLineAdd: costingLinePost']) {
      expect(registry).toContain(key);
    }
    expect(read('ios/Shared/NativeModules.swift')).toContain('("/app/costing", "costing")');
    expect(read('ios/Shared/NativeModules.swift')).toContain('case "costing": NativeCostingView(');
  });

  it('iPad のその場の計算は lib/costing.ts と同じ（行の原価は切り上げ・原価率は %小数1桁で Math.round）', () => {
    const lib = read('lib/costing.ts');
    expect(lib).toContain('Math.ceil(l.quantity * l.avgCost)');
    expect(lib).toContain('Math.round((costYen / priceYen) * 1000) / 10');
    const swift = read('ios/Shared/NativeCostingView.swift');
    expect(swift).toContain('(quantity * a).rounded(.up)');
    expect(swift).toContain('jsRound(cost / price * 1000) / 10');
    expect(swift).toContain('(x + 0.5).rounded(.down)');
    // しきい値（labels.ts の 30% / 40%）
    expect(read('components/costing/labels.ts')).toMatch(/COST_RATE_WARNING_THRESHOLD = 30;[\s\S]*COST_RATE_DANGER_THRESHOLD = 40;/);
    expect(swift).toContain('static let warning: Double = 30');
    expect(swift).toContain('static let danger: Double = 40');
  });
});
