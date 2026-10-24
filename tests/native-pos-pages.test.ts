import { describe, expect, it } from 'vitest';
import { NATIVE_BESTSELLERS_TAB, NATIVE_FAVORITES_TAB, nativePosPages } from '@/lib/native-pos';
import { PICKS_PAGE_KEY } from '@/lib/menu-book';

const drink = { key: 'drink', name: 'DRINK', categories: [{ id: 'c-beer', name: 'ビール', name_en: 'Beer' }, { id: 'c-sour', name: 'サワー', name_en: null }] };
const food = { key: 'food', name: 'FOOD', categories: [{ id: 'c-curry', name: 'カレー', name_en: 'Curry' }] };

describe('nativePosPages（ネイティブの上のタブ＝Web のレジと同じページ）', () => {
  it('おすすめを店の決めた位置に入れ、標準のページは日本語を大きく・英語を小さく', () => {
    const { pages, categories } = nativePosPages([drink, food], 0);
    expect(pages.map((p) => p.key)).toEqual([PICKS_PAGE_KEY, 'drink', 'food']);
    expect(pages[0]).toEqual({ key: PICKS_PAGE_KEY, name: 'おすすめ', sub: 'Picks', categoryIds: [NATIVE_FAVORITES_TAB, NATIVE_BESTSELLERS_TAB] });
    expect(pages[1]).toMatchObject({ name: 'ドリンク', sub: 'DRINK', categoryIds: ['c-beer', 'c-sour'] });
    expect(pages[2]).toMatchObject({ name: 'フード', sub: 'FOOD', categoryIds: ['c-curry'] });
    // カテゴリの並びもページの順（左の列はページの中身だけを出す）
    expect(categories.map((c) => c.id)).toEqual([NATIVE_FAVORITES_TAB, NATIVE_BESTSELLERS_TAB, 'c-beer', 'c-sour', 'c-curry']);
  });

  it('おすすめを途中・最後にも置ける', () => {
    expect(nativePosPages([drink, food], 1).pages.map((p) => p.key)).toEqual(['drink', PICKS_PAGE_KEY, 'food']);
    expect(nativePosPages([drink, food], 9).pages.map((p) => p.key)).toEqual(['drink', 'food', PICKS_PAGE_KEY]);
  });

  it('店が名前を付けたページはその名前を大きく出す', () => {
    const lunch = { key: 'lunch-set', name: 'ランチセット', categories: [{ id: 'c-l', name: 'ランチ', name_en: null }] };
    const { pages } = nativePosPages([lunch], 0);
    expect(pages[1]).toMatchObject({ key: 'lunch-set', name: 'ランチセット', categoryIds: ['c-l'] });
  });

  it('カテゴリが無くてもおすすめのタブは出す', () => {
    expect(nativePosPages([], 0).pages.map((p) => p.key)).toEqual([PICKS_PAGE_KEY]);
  });
});
