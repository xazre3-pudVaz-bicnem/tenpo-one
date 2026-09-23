import { describe, expect, it } from 'vitest';
import {
  BRANDED_METHODS,
  checkoutPresetsFrom,
  checkoutPresetsToJson,
  DEFAULT_DISCOUNT_PRESETS,
  DEFAULT_POINT_BRANDS,
  discountAmountOf,
  discountPresetsOf,
  emptyCheckoutPresets,
  methodBrandsOf,
  nextPresetKey,
  normalizePresetName,
  normalizePresetValue,
  percentDiscountAmount,
  pointBrandsOf,
  PRESET_NAME_MAX,
} from '@/lib/checkout-presets';

describe('会計の「値引き」「ポイント」の選択肢', () => {
  it('設定していない店舗は既定（幹事様無料／ホットペッパー・ぐるなび・食べログ）が出る', () => {
    const empty = emptyCheckoutPresets();
    expect(discountPresetsOf(empty).map((d) => d.name)).toEqual(DEFAULT_DISCOUNT_PRESETS.map((d) => d.name));
    expect(pointBrandsOf(empty).map((b) => b.name)).toEqual(['ホットペッパー', 'ぐるなび', '食べログ']);
    expect(DEFAULT_POINT_BRANDS).toHaveLength(3);
  });

  it('店舗が決めた選択肢は既定を置き換える', () => {
    const presets = checkoutPresetsFrom({
      checkout: {
        discounts: [{ key: 'disc1', name: '学割', kind: 'percent', value: 10 }],
        pointBrands: [{ key: 'pt1', name: 'ホットペッパー' }],
      },
    });
    expect(discountPresetsOf(presets).map((d) => d.name)).toEqual(['学割']);
    expect(pointBrandsOf(presets).map((b) => b.name)).toEqual(['ホットペッパー']);
  });

  it('壊れた値は捨てる（記号の形・名前・同じ記号・知らない引き方）', () => {
    const presets = checkoutPresetsFrom({
      checkout: {
        discounts: [
          { key: 'ok1', name: '  幹事様　無料 ', kind: 'manual' },
          { key: 'ok1', name: '同じ記号は捨てる', kind: 'manual' },
          { key: 'BAD KEY', name: 'x', kind: 'manual' },
          { key: 'ok2', name: '   ', kind: 'manual' },
          { key: 'ok3', name: '知らない引き方', kind: 'nope' },
          { key: 'ok4', name: '％は100まで', kind: 'percent', value: 999 },
          { key: 'ok5', name: '0以下は1に', kind: 'amount', value: -5 },
        ],
        pointBrands: [{ key: 'pt1', name: 'ぐるなび' }, { key: 'pt1', name: '重複' }, 'bad'],
      },
    });
    expect(presets.discounts).toEqual([
      { key: 'ok1', name: '幹事様 無料', kind: 'manual', value: 0 },
      { key: 'ok4', name: '％は100まで', kind: 'percent', value: 100 },
      { key: 'ok5', name: '0以下は1に', kind: 'amount', value: 1 },
    ]);
    expect(presets.pointBrands).toEqual([{ key: 'pt1', name: 'ぐるなび' }]);
    expect(checkoutPresetsToJson(presets)).toEqual({
      discounts: presets.discounts,
      pointBrands: presets.pointBrands,
      methodBrands: presets.methodBrands,
    });
  });

  it('名前は長すぎると切る', () => {
    expect(normalizePresetName('あ'.repeat(PRESET_NAME_MAX + 5))).toHaveLength(PRESET_NAME_MAX);
    expect(normalizePresetName('   ')).toBeNull();
    expect(normalizePresetValue('manual', 50)).toBe(0);
  });

  it('引く金額：％は合計から計算し、合計を超えない', () => {
    expect(discountAmountOf({ key: 'a', name: '10%', kind: 'percent', value: 10 }, 3300)).toBe(330);
    // 1円未満は切り捨て
    expect(discountAmountOf({ key: 'a', name: '3%', kind: 'percent', value: 3 }, 1010)).toBe(30);
    expect(discountAmountOf({ key: 'b', name: '500円', kind: 'amount', value: 500 }, 300)).toBe(300);
    // 金額はレジで入れる
    expect(discountAmountOf({ key: 'c', name: '幹事様無料', kind: 'manual', value: 0 }, 5000)).toBe(0);
    expect(percentDiscountAmount(100, 4400)).toBe(4400);
    expect(percentDiscountAmount(-5, 4400)).toBe(0);
    expect(percentDiscountAmount(150, 4400)).toBe(4400);
  });

  it('支払方法の内訳：設定が空なら既定（VISA…・PayPay…・交通系IC…）', () => {
    const empty = emptyCheckoutPresets();
    expect(BRANDED_METHODS).toEqual(['credit', 'qr', 'emoney']);
    expect(methodBrandsOf(empty, 'credit').map((b) => b.name)).toContain('VISA');
    expect(methodBrandsOf(empty, 'qr').map((b) => b.name)).toContain('PayPay');
    expect(methodBrandsOf(empty, 'emoney').map((b) => b.name)).toContain('交通系IC');
    // 内訳を出さない支払方法は空
    expect(methodBrandsOf(empty, 'cash')).toEqual([]);
  });

  it('支払方法の内訳：店舗が決めたものが優先。知らない支払方法は捨てる', () => {
    const presets = checkoutPresetsFrom({
      checkout: {
        methodBrands: {
          credit: [{ key: 'visa', name: 'VISA' }, { key: 'visa', name: '重複' }, { key: 'BAD', name: 'x' }],
          cash: [{ key: 'nope', name: '現金に内訳は無い' }],
        },
      },
    });
    expect(presets.methodBrands.credit).toEqual([{ key: 'visa', name: 'VISA' }]);
    expect(presets.methodBrands.cash).toBeUndefined();
    expect(methodBrandsOf(presets, 'credit').map((b) => b.name)).toEqual(['VISA']);
    // 決めていない支払方法は既定のまま
    expect(methodBrandsOf(presets, 'qr').length).toBeGreaterThan(0);
  });

  it('追加するときの記号は使っていないものを選ぶ', () => {
    expect(nextPresetKey([{ key: 'disc1' }, { key: 'disc2' }], 'disc')).toBe('disc3');
    expect(nextPresetKey([], 'pt')).toBe('pt1');
  });
});
