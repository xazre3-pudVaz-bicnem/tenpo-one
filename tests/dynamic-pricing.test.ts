import { describe, it, expect } from 'vitest';
import {
  adjustPrice,
  describeRule,
  dynamicPricingFrom,
  dynamicRuleProblem,
  dynamicUnitPrice,
  normalizeDynamicRule,
  ruleActiveAt,
  type DynamicPriceRule,
} from '@/lib/dynamic-pricing';

/** 日本時間の日時（2026-09-21 は月曜） */
const jst = (d: number, hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, d, h - 9, m));
};

const base: DynamicPriceRule = {
  id: 'r1',
  name: 'ハッピーアワー',
  enabled: true,
  days: [1, 2, 3, 4, 5],
  start: '17:00',
  end: '19:00',
  target: 'categories',
  categoryIds: ['drink'],
  itemIds: [],
  kind: 'percent',
  value: -20,
  roundTo10: false,
};
const beer = { id: 'beer', categoryId: 'drink', itemType: 'drink' };
const fries = { id: 'fries', categoryId: 'food', itemType: 'food' };

describe('ダイナミックプライシング（2026-09-23）', () => {
  it('曜日・時間帯（開始は含む・終了は含まない）', () => {
    expect(ruleActiveAt(base, jst(21, '17:00'))).toBe(true);
    expect(ruleActiveAt(base, jst(21, '18:59'))).toBe(true);
    expect(ruleActiveAt(base, jst(21, '19:00'))).toBe(false);
    expect(ruleActiveAt(base, jst(21, '16:59'))).toBe(false);
    expect(ruleActiveAt(base, jst(20, '18:00'))).toBe(false); // 日曜
  });

  it('日またぎは 0 時以降も前日の曜日で判定、終日も使える', () => {
    const night = { ...base, days: [5], start: '22:00', end: '05:00' }; // 金曜の夜
    expect(ruleActiveAt(night, jst(25, '23:30'))).toBe(true); // 金 23:30
    expect(ruleActiveAt(night, jst(26, '02:00'))).toBe(true); // 土 2:00 → 金曜のルール
    expect(ruleActiveAt(night, jst(26, '05:00'))).toBe(false);
    expect(ruleActiveAt(night, jst(26, '23:00'))).toBe(false); // 土曜の夜は対象外
    expect(ruleActiveAt({ ...base, days: [], start: '00:00', end: '00:00' }, jst(20, '03:00'))).toBe(true);
  });

  it('値段の計算（四捨五入・10円単位・0円未満にしない）', () => {
    expect(adjustPrice(550, { kind: 'percent', value: -20, roundTo10: false })).toBe(440);
    expect(adjustPrice(555, { kind: 'percent', value: -10, roundTo10: false })).toBe(500); // 499.5 → 500
    expect(adjustPrice(555, { kind: 'percent', value: -10, roundTo10: true })).toBe(500);
    expect(adjustPrice(480, { kind: 'percent', value: 10, roundTo10: true })).toBe(530); // 528 → 530
    expect(adjustPrice(500, { kind: 'amount', value: -100, roundTo10: false })).toBe(400);
    expect(adjustPrice(50, { kind: 'amount', value: -100, roundTo10: false })).toBe(0);
    expect(adjustPrice(999, { kind: 'fixed', value: 300, roundTo10: false })).toBe(300);
  });

  it('上のルールが優先、当てはまらなければ元の値段', () => {
    const rules = [base, { ...base, id: 'r2', target: 'all' as const, value: 10 }];
    expect(dynamicUnitPrice(rules, beer, 600, jst(21, '18:00'))).toMatchObject({ price: 480, rule: { id: 'r1' } });
    expect(dynamicUnitPrice(rules, fries, 600, jst(21, '18:00'))).toMatchObject({ price: 660, rule: { id: 'r2' } });
    expect(dynamicUnitPrice(rules, beer, 600, jst(21, '20:00'))).toEqual({ price: 600, rule: null });
    expect(dynamicUnitPrice([{ ...base, enabled: false }], beer, 600, jst(21, '18:00')).price).toBe(600);
    // 「全部」はコース・オプションには効かない
    expect(dynamicUnitPrice([{ ...base, target: 'all' }], { id: 'c', categoryId: null, itemType: 'course' }, 3000, jst(21, '18:00')).price).toBe(3000);
    expect(dynamicUnitPrice([{ ...base, target: 'items', itemIds: ['fries'] }], fries, 400, jst(21, '18:00')).price).toBe(320);
  });

  it('設定の読み込みは壊れたルールを捨てる', () => {
    const s = dynamicPricingFrom({
      dynamicPricing: { rules: [base, { ...base, id: 'x', start: '25:00' }, { ...base, id: 'y', kind: 'percent', value: -100 }, 'bad'] },
      other: 1,
    });
    expect(s.rules.map((r) => r.id)).toEqual(['r1']);
    expect(dynamicPricingFrom(null).rules).toEqual([]);
    expect(normalizeDynamicRule({ ...base, days: [1, 1, 9, 3] })?.days).toEqual([1, 3]);
  });

  it('保存前のチェックと一覧の説明', () => {
    expect(dynamicRuleProblem(base)).toBeNull();
    expect(dynamicRuleProblem({ ...base, categoryIds: [] })).toContain('カテゴリ');
    expect(dynamicRuleProblem({ ...base, target: 'items' })).toContain('商品');
    expect(describeRule(base)).toBe('月・火・水・木・金 17:00〜19:00・20%引き');
    expect(describeRule({ ...base, days: [], start: '00:00', end: '00:00', kind: 'amount', value: 50, roundTo10: true })).toBe('毎日 終日・+50円（10円単位）');
  });
});
