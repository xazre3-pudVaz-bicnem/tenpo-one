import { describe, it, expect } from 'vitest';
import { resolveOptionSelection, type OptionGroup, type OptionItem } from '@/lib/menu-options';

const size: OptionGroup = { id: 'g1', name: 'サイズ', isRequired: true, minSelect: 1, maxSelect: 1 };
const topping: OptionGroup = { id: 'g2', name: 'トッピング', isRequired: false, minSelect: 0, maxSelect: 2 };

const large: OptionItem = { id: 'o1', name: '大盛り', price: 200, groupId: 'g1' };
const regular: OptionItem = { id: 'o2', name: '普通', price: 0, groupId: 'g1' };
const cheese: OptionItem = { id: 'o3', name: 'チーズ', price: 150, groupId: 'g2' };
const egg: OptionItem = { id: 'o4', name: '玉子', price: 100, groupId: 'g2' };

describe('resolveOptionSelection', () => {
  it('選択肢が無い商品は空を返す', () => {
    expect(resolveOptionSelection([], [])).toEqual({ modifiers: [], extraPrice: 0 });
  });

  it('選択肢が無い商品に選択肢を渡すと拒否する', () => {
    expect(() => resolveOptionSelection([], [cheese])).toThrow('選択肢は設定されていません');
  });

  it('追加料金を合計する', () => {
    const r = resolveOptionSelection([size, topping], [large, cheese]);
    expect(r.extraPrice).toBe(350);
    expect(r.modifiers).toEqual([
      { name: '大盛り', price: 200 },
      { name: 'チーズ', price: 150 },
    ]);
  });

  it('無料の選択肢でも記録する', () => {
    const r = resolveOptionSelection([size], [regular]);
    expect(r.extraPrice).toBe(0);
    expect(r.modifiers).toEqual([{ name: '普通', price: 0 }]);
  });

  it('必須グループが未選択なら拒否する', () => {
    expect(() => resolveOptionSelection([size, topping], [cheese])).toThrow('「サイズ」は1つ以上選んでください');
  });

  it('最大数を超えたら拒否する', () => {
    const extra: OptionItem = { id: 'o5', name: 'ベーコン', price: 200, groupId: 'g2' };
    expect(() => resolveOptionSelection([size, topping], [large, cheese, egg, extra])).toThrow(
      '「トッピング」は2つまでしか選べません'
    );
  });

  it('最小数（必須でなくとも）を満たさなければ拒否する', () => {
    const pick2: OptionGroup = { id: 'g3', name: '2品選択', isRequired: false, minSelect: 2, maxSelect: 3 };
    const a: OptionItem = { id: 'x1', name: 'A', price: 0, groupId: 'g3' };
    expect(() => resolveOptionSelection([pick2], [a])).toThrow('「2品選択」は2つ以上選んでください');
  });

  it('他グループの選択肢が混ざっていたら拒否する', () => {
    expect(() => resolveOptionSelection([size], [cheese])).toThrow('選択された選択肢が正しくありません');
  });

  it('任意グループは未選択でもよい', () => {
    const r = resolveOptionSelection([size, topping], [large]);
    expect(r.extraPrice).toBe(200);
  });

  it('modifiersはグループの並び順で安定する', () => {
    const r = resolveOptionSelection([size, topping], [cheese, large]);
    expect(r.modifiers.map((m) => m.name)).toEqual(['大盛り', 'チーズ']);
  });
});
