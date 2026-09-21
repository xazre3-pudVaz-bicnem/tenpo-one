import { describe, it, expect } from 'vitest';
import { normalizeForSearch, soldOutCount, soldOutSections, type SoldOutItem } from '@/lib/sold-out';

const item = (id: string, categoryId: string | null, name: string, over: Partial<SoldOutItem> = {}): SoldOutItem => ({
  id,
  categoryId,
  name,
  nameKana: null,
  price: 480,
  isSoldOut: false,
  sortOrder: 0,
  shared: false,
  ...over,
});

const categories = [
  { id: 'c-soft', name: 'SOFT DRINK', sortOrder: 20 },
  { id: 'c-beer', name: 'BEER', sortOrder: 10 },
  { id: 'c-empty', name: 'EMPTY', sortOrder: 30 },
];
const items = [
  item('i-cola', 'c-soft', 'コーラ', { sortOrder: 20 }),
  item('i-tea', 'c-soft', '緑茶', { sortOrder: 10, isSoldOut: true }),
  item('i-beer', 'c-beer', '生ビール', { nameKana: 'ナマビール' }),
  item('i-x', null, 'お通し'),
];

describe('品切れの設定画面', () => {
  it('カテゴリの並び順・商品の並び順で並べ、商品の無いカテゴリは出さない（カテゴリ無しは最後に「その他」）', () => {
    const sections = soldOutSections(categories, items);
    expect(sections.map((s) => s.name)).toEqual(['BEER', 'SOFT DRINK', 'その他']);
    expect(sections[1].items.map((i) => i.name)).toEqual(['緑茶', 'コーラ']);
  });

  it('「売切中だけ」で売切の商品だけにする', () => {
    const sections = soldOutSections(categories, items, { filter: 'soldOut' });
    expect(sections.map((s) => s.items.map((i) => i.id))).toEqual([['i-tea']]);
  });

  it('商品名・カナで探せる（ひらがな・カタカナ、全角・半角の違いは気にしない）', () => {
    expect(soldOutSections(categories, items, { query: 'ビール' }).flatMap((s) => s.items.map((i) => i.id))).toEqual(['i-beer']);
    expect(soldOutSections(categories, items, { query: 'なまびーる' }).flatMap((s) => s.items.map((i) => i.id))).toEqual(['i-beer']);
    expect(soldOutSections(categories, items, { query: 'こーら' }).flatMap((s) => s.items.map((i) => i.id))).toEqual(['i-cola']);
    expect(soldOutSections(categories, items, { query: '  ' })).toHaveLength(3);
    expect(normalizeForSearch('ＣＯＬＡ　コーラ')).toBe('colaこーら');
  });

  it('売切中の数', () => {
    expect(soldOutCount(items)).toBe(1);
    expect(soldOutCount([])).toBe(0);
  });
});
