import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { addCartLine, cartTotal, repriceCart, type HandyCartLine } from '@/components/handy/logic';
import { optionPriceLookup, repriceLines } from '@/lib/cart-reprice';

/**
 * メニュー設定で値段を変えたら全部の場所で変わる（2026-09-28 Ronnie）
 * →「これから入れる注文から変わる」（注文済みの明細の値段は変えない）
 * - ハンディ・レジのメニュー：menu_items の Realtime（migration 00089）と30秒ごとの読み直し
 * - ハンディ・レジのカート（まだ注文していない品）：いまの値段で出す（lib/cart-reprice.ts）
 * - 注文したときの値段はサーバーがメニューから決める（addItem）
 */

function tabsWith(items: { id: string; price: number }[]) {
  return [
    {
      pages: [
        {
          categories: [
            {
              items: items.map((i) => ({ ...i })),
            },
          ],
        },
      ],
    },
  ] as unknown as Parameters<typeof repriceCart>[1];
}

function line(menuItemId: string, unitPrice: number, quantity = 1, optionItemIds: string[] = []): HandyCartLine {
  return addCartLine(
    [],
    { menuItemId, name: menuItemId, nameEn: null, unitPrice, optionItemIds, optionLabel: '' },
    quantity
  )[0];
}

describe('repriceCart（カートの値段を、いまのメニューの値段で出す）', () => {
  it('値段が変わった商品は新しい値段になる（数量はそのまま）', () => {
    const cart = [line('beer', 650, 2)];
    const next = repriceCart(cart, tabsWith([{ id: 'beer', price: 590 }]), {});
    expect(next[0].unitPrice).toBe(590);
    expect(next[0].quantity).toBe(2);
    expect(cartTotal(next)).toBe(1180);
  });

  it('選択肢の追加料金は足したまま', () => {
    const cart = [line('curry', 1100, 1, ['big'])];
    const options = { curry: [{ items: [{ id: 'big', price: 100 }] }] };
    const next = repriceCart(cart, tabsWith([{ id: 'curry', price: 1200 }]), options);
    expect(next[0].unitPrice).toBe(1300);
  });

  it('変わっていなければ同じ配列を返す（画面を無駄に描き直さない）', () => {
    const cart = [line('beer', 590)];
    expect(repriceCart(cart, tabsWith([{ id: 'beer', price: 590 }]), {})).toBe(cart);
  });

  it('メニューに無い商品・見つからない選択肢の行はそのまま', () => {
    const cart = [line('gone', 500), line('curry', 1100, 1, ['missing'])];
    const next = repriceCart(cart, tabsWith([{ id: 'curry', price: 1200 }]), { curry: [{ items: [] }] });
    expect(next).toBe(cart);
  });
});

describe('migration 00089（menu_items を Realtime に載せる。注文済みの明細は変えない）', () => {
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '00089_menu_price_sync.sql'), 'utf8');

  it('menu_items を Realtime に載せる', () => {
    expect(sql).toContain('alter publication supabase_realtime add table public.menu_items');
  });

  it('注文済みの伝票の値段は変えない（trigger も update も無い）', () => {
    expect(sql).not.toMatch(/create\s+trigger/i);
    expect(sql).not.toMatch(/update\s+public\.order_items/i);
  });
});

describe('ハンディ・レジは menu_items の変更で読み直す', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it('ハンディ', () => {
    expect(read('components/handy/handy-chrome.tsx')).toContain("'service_calls', 'menu_items'");
    expect(read('components/handy/handy-order-screen.tsx')).toContain('repriceCart(cart, tabs, optionGroupsByItem)');
  });
  it('レジ（iPad）', () => {
    const src = read('components/pos/pos-screen.tsx');
    expect(src).toContain("tables: ['order_items', 'menu_items']");
    expect(src).toContain('pricedCart.map((l) =>');
    expect(src).toContain('Number(isTakeoutLike ? (m.takeout_price ?? m.price) : m.price)');
  });
});

describe('repriceLines（レジ iPad のカートと共通）', () => {
  const lines = [
    { menuItemId: 'a', optionItemIds: [], unitPrice: 800, quantity: 2 },
    { menuItemId: 'b', optionItemIds: ['x'], unitPrice: 1100, quantity: 1 },
  ];
  it('いまの値段＋選択肢の追加料金にする', () => {
    const prices: Record<string, number> = { a: 590, b: 1000 };
    const next = repriceLines(lines, (id) => prices[id], optionPriceLookup({ b: [{ items: [{ id: 'x', price: 150 }] }] }));
    expect(next.map((l) => l.unitPrice)).toEqual([590, 1150]);
    expect(next[0].quantity).toBe(2);
  });
  it('値段が分からない商品はそのまま・変わらなければ同じ配列', () => {
    expect(repriceLines(lines, () => undefined, () => 0)).toBe(lines);
    expect(repriceLines(lines, (id) => (id === 'a' ? 800 : 1000), () => 100)).toBe(lines);
  });
});
