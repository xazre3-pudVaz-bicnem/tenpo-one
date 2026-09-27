import { describe, it, expect } from 'vitest';
import { buildShoppingPurpose, shoppingSpent, sortShops, validateShopping } from '@/lib/cash-shops';

describe('出金の買い物先（2026-09-28 Ronnie「企業ごとに設定・アルファベット順」）', () => {
  it('英字は A→Z、読みがあれば読みで五十音順', () => {
    const r = sortShops([
      { name: 'Rose family store', kana: null },
      { name: 'Asian mart', kana: null },
      { name: 'Ok super', kana: null },
      { name: '肉のハナマサ', kana: 'にくのはなまさ' },
      { name: '業務スーパー', kana: 'ぎょうむすーぱー' },
    ]).map((s) => s.name);
    expect(r.slice(0, 3)).toEqual(['Asian mart', 'Ok super', 'Rose family store']);
    expect(r.indexOf('業務スーパー')).toBeLessThan(r.indexOf('肉のハナマサ'));
  });
});

describe('買い物の出金（2026-09-28 Ronnie「払った担当者は必須・買った物・お釣り・ちょうど」）', () => {
  const base = { clerk: '田中', shop: '業務スーパー', items: '野菜・鶏肉', taken: 10000, change: 2650 };
  it('レジから減るのは 持出 − お釣り', () => {
    expect(shoppingSpent(10000, 2650)).toBe(7350);
    expect(shoppingSpent(5000, 0)).toBe(5000);
  });
  it('担当者・買った物が無いと登録できない。お釣りが持出以上もだめ', () => {
    expect(validateShopping(base)).toBeNull();
    expect(validateShopping({ ...base, clerk: '' })).toMatch(/担当者/);
    expect(validateShopping({ ...base, items: ' ' })).toMatch(/買った物/);
    expect(validateShopping({ ...base, change: 10000 })).toMatch(/お釣り/);
    expect(validateShopping({ ...base, taken: 0 })).toMatch(/持ち出した金額/);
  });
  it('用途の文：買い物：店 品｜担当 名前｜持出・お釣り（ちょうどは「ちょうど」）', () => {
    expect(buildShoppingPurpose(base)).toBe('買い物：業務スーパー 野菜・鶏肉｜担当 田中｜持出¥10,000 お釣り¥2,650');
    expect(buildShoppingPurpose({ ...base, shop: '', change: 0 })).toBe('買い物：野菜・鶏肉｜担当 田中｜持出¥10,000 ちょうど');
  });
});
