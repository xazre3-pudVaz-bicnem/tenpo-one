import { describe, expect, it } from 'vitest';
import {
  addCartLine,
  cartCount,
  cartTotal,
  changeCartQuantity,
  itemQuantityInCart,
  MAX_LINE_QUANTITY,
  menuTabs,
  openServiceCall,
  parseServiceCalls,
  RECOMMENDED_TAB_ID,
  removeCartLine,
} from '@/components/qr-order/logic';
import {
  qrOrderErrorMessage,
  qrServiceCallErrorMessage,
  type CartLine,
  type QrMenuCategory,
  type QrMenuItem,
  type QrMenuModifier,
} from '@/components/qr-order/types';

function item(over: Partial<QrMenuItem> = {}): QrMenuItem {
  return {
    id: 'i1',
    name: 'チキンカレー',
    name_en: null,
    description: null,
    price: 980,
    is_sold_out: false,
    is_recommended: false,
    allergy_info: null,
    image_path: null,
    modifiers: [],
    ...over,
  };
}

function category(over: Partial<QrMenuCategory> = {}): QrMenuCategory {
  return { id: 'c1', name: 'カレー', name_en: null, color: null, items: [], ...over };
}

const large: QrMenuModifier = { id: 'm1', name: '大盛り', price: 150 };
const spicy: QrMenuModifier = { id: 'm2', name: '辛口', price: 0 };

describe('カートの計算', () => {
  it('点数と合計はオプション加算後の単価で積む', () => {
    let cart: CartLine[] = [];
    cart = addCartLine(cart, item(), 2, '', [large], 'k1');
    cart = addCartLine(cart, item({ id: 'i2', name: 'ラッシー', price: 400 }), 1, '', [], 'k2');
    expect(cartCount(cart)).toBe(3);
    expect(cartTotal(cart)).toBe((980 + 150) * 2 + 400);
  });

  it('同じ商品・同じメモ・同じオプションなら1行にまとめる（順不同でも同一とみなす）', () => {
    let cart = addCartLine([], item(), 1, '', [large, spicy], 'k1');
    cart = addCartLine(cart, item(), 2, '', [spicy, large], 'k2');
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
    expect(cart[0].key).toBe('k1');
  });

  it('メモが違えば別行にする', () => {
    let cart = addCartLine([], item(), 1, '', [], 'k1');
    cart = addCartLine(cart, item(), 1, 'ネギ抜き', [], 'k2');
    expect(cart).toHaveLength(2);
  });

  it('数量は上限（サーバー側と同じ20）を超えない', () => {
    let cart = addCartLine([], item(), MAX_LINE_QUANTITY, '', [], 'k1');
    cart = addCartLine(cart, item(), 5, '', [], 'k2');
    expect(cart[0].quantity).toBe(MAX_LINE_QUANTITY);
    cart = changeCartQuantity(cart, 'k1', 1);
    expect(cart[0].quantity).toBe(MAX_LINE_QUANTITY);
  });

  it('数量を0まで減らした行は消える', () => {
    let cart = addCartLine([], item(), 1, '', [], 'k1');
    cart = changeCartQuantity(cart, 'k1', -1);
    expect(cart).toHaveLength(0);
    expect(cartTotal(cart)).toBe(0);
  });

  it('削除は指定の行だけを消す', () => {
    let cart = addCartLine([], item(), 1, '', [], 'k1');
    cart = addCartLine(cart, item({ id: 'i2' }), 1, '', [], 'k2');
    expect(removeCartLine(cart, 'k1').map((l) => l.key)).toEqual(['k2']);
  });

  it('同じ商品の点数はメモ違いの行も合算して数える', () => {
    let cart = addCartLine([], item(), 2, '', [], 'k1');
    cart = addCartLine(cart, item(), 1, 'ネギ抜き', [], 'k2');
    expect(itemQuantityInCart(cart, 'i1')).toBe(3);
    expect(itemQuantityInCart(cart, 'i2')).toBe(0);
  });
});

describe('分類タブ', () => {
  it('商品が0件の分類は出さない', () => {
    const tabs = menuTabs(
      [category({ id: 'c1', items: [item()] }), category({ id: 'c2', items: [] })],
      null,
      'おすすめ'
    );
    expect(tabs.map((t) => t.id)).toEqual(['c1']);
  });

  it('おすすめ商品があるときだけ先頭に擬似分類を足す', () => {
    const recommended = item({ id: 'i9', is_recommended: true });
    const withRecommended = menuTabs([category({ items: [item(), recommended] })], null, 'おすすめ');
    expect(withRecommended[0].id).toBe(RECOMMENDED_TAB_ID);
    expect(withRecommended[0].recommended).toBe(true);
    expect(withRecommended[0].sections[0].items).toEqual([recommended]);

    const without = menuTabs([category({ items: [item()] })], null, 'おすすめ');
    expect(without[0].id).toBe('c1');
  });

  it('販売時間外などで全分類が空なら何も出さない', () => {
    expect(menuTabs([category({ items: [] })], null, 'おすすめ')).toEqual([]);
  });
});

describe('メニューブックのページ（タブのまとめ方）', () => {
  const soup = category({ id: 'soup', name: 'SOUP', items: [item({ id: 's1' })] });
  const appetizer = category({ id: 'app', name: 'APPETIZER', items: [item({ id: 'a1' }), item({ id: 'a2' })] });
  const salad = category({ id: 'salad', name: 'SALAD', items: [] });
  const beer = category({ id: 'beer', name: 'BEER', items: [item({ id: 'b1' })] });
  const fBeer = category({ id: 'fbeer', name: '(F) BEER', items: [item({ id: 'f1', price: 0 })] });

  it('同じページのカテゴリを1つのタブにまとめる（商品の無いカテゴリは外す）', () => {
    const tabs = menuTabs(
      [soup, appetizer, salad, beer],
      [
        { key: 'soup', name: null, categoryIds: ['soup', 'app', 'salad'] },
        { key: 'beer', name: 'ドリンク', categoryIds: ['beer'] },
      ],
      'おすすめ'
    );
    expect(tabs.map((t) => t.id)).toEqual(['page:soup', 'page:beer']);
    expect(tabs[0].sections.map((c) => c.id)).toEqual(['soup', 'app']);
    expect(tabs[0].itemCount).toBe(3);
    expect(tabs[0].name).toBeNull();
    expect(tabs[1].name).toBe('ドリンク');
  });

  it('ページに入っていないカテゴリは1カテゴリ1タブで後ろに出す', () => {
    const tabs = menuTabs([soup, beer], [{ key: 'soup', name: null, categoryIds: ['soup'] }], 'おすすめ');
    expect(tabs.map((t) => t.id)).toEqual(['page:soup', 'beer']);
  });

  it('おすすめは飲み放題・コースのページの後、ほかのページの前に入れる', () => {
    const withRecommended = category({ id: 'beer', name: 'BEER', items: [item({ id: 'b1', is_recommended: true })] });
    const tabs = menuTabs(
      [fBeer, withRecommended],
      [
        { key: 'fbeer', name: null, categoryIds: ['fbeer'], plan: true },
        { key: 'beer', name: null, categoryIds: ['beer'] },
      ],
      'おすすめ'
    );
    expect(tabs.map((t) => t.id)).toEqual(['page:fbeer', RECOMMENDED_TAB_ID, 'page:beer']);
  });
});

describe('呼び出しの状態', () => {
  it('会計希望と一般呼び出しは別種類として判定する', () => {
    const calls = parseServiceCalls([{ kind: 'checkout', created_at: '18:20' }]);
    expect(openServiceCall(calls, 'checkout')?.created_at).toBe('18:20');
    expect(openServiceCall(calls, 'staff')).toBeNull();
  });

  it('想定外の形の戻り値は呼び出し中として扱わない', () => {
    expect(parseServiceCalls(null)).toEqual([]);
    expect(parseServiceCalls([{ kind: 'unknown', created_at: '18:20' }, 'x', null])).toEqual([]);
    expect(parseServiceCalls([{ kind: 'staff' }])).toEqual([{ kind: 'staff', created_at: '' }]);
  });
});

describe('エラー文言', () => {
  it('呼び出しのエラーコードを日本語にする', () => {
    expect(qrServiceCallErrorMessage('NOT_IN_SERVICE')).toContain('受付が終了しています');
    expect(qrServiceCallErrorMessage('RATE_LIMITED: too many')).toContain('少しお待ちください');
  });

  it('未知のエラーや通信失敗でも成功に見せず失敗として伝える', () => {
    expect(qrServiceCallErrorMessage(null)).toContain('送信できませんでした');
    expect(qrServiceCallErrorMessage('SOMETHING_ELSE')).toContain('送信できませんでした');
  });

  it('注文のエラーコードも日本語にする', () => {
    expect(qrOrderErrorMessage('NOT_IN_SERVICE')).toContain('受付が終了しています');
    expect(qrOrderErrorMessage('ITEM_UNAVAILABLE')).toContain('品切れ');
    expect(qrOrderErrorMessage(null)).toContain('通信エラー');
  });
});
