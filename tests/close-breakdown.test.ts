import { describe, expect, it } from 'vitest';
import { computeCloseBreakdown, monthRange, shiftDay, shiftMonth, WALK_IN_LABEL, type BreakdownItem, type BreakdownOrder } from '@/lib/close-breakdown';

const orders: BreakdownOrder[] = [
  { id: 'o1', total: 12000, guestCount: 4, clerkName: 'Ronnie', sourceName: '食べログ', orderType: 'dine_in' },
  { id: 'o2', total: 3000, guestCount: 1, clerkName: 'Xitri', sourceName: null, orderType: 'dine_in' },
  { id: 'o3', total: 5000, guestCount: 2, clerkName: null, sourceName: 'ホットペッパー', orderType: 'dine_in' },
  { id: 'o4', total: 1500, guestCount: 1, clerkName: 'Ronnie', sourceName: null, orderType: 'takeout' },
];

const items: BreakdownItem[] = [
  { orderId: 'o1', menuItemId: 'c1', name: '2H飲み放題付コース', unitPrice: 3000, quantity: 4, lineTotal: 12000, cancelled: false, itemType: 'course', station: null, includesDrinks: true },
  { orderId: 'o1', menuItemId: 'd1', name: '生ビール', unitPrice: 0, quantity: 6, lineTotal: 0, cancelled: false, itemType: 'drink', station: 'drink', includesDrinks: false },
  { orderId: 'o1', menuItemId: 'd2', name: 'ハイボール', unitPrice: 0, quantity: 3, lineTotal: 0, cancelled: false, itemType: 'drink', station: 'drink', includesDrinks: false },
  { orderId: 'o1', menuItemId: 'd3', name: 'プレミアムワイン', unitPrice: 800, quantity: 1, lineTotal: 800, cancelled: false, itemType: 'drink', station: 'drink', includesDrinks: false },
  { orderId: 'o2', menuItemId: 'f1', name: 'バターチキン', unitPrice: 1200, quantity: 2, lineTotal: 2400, cancelled: false, itemType: 'food', station: 'kitchen', includesDrinks: false },
  { orderId: 'o2', menuItemId: 'd1', name: '生ビール', unitPrice: 600, quantity: 1, lineTotal: 600, cancelled: false, itemType: 'drink', station: 'drink', includesDrinks: false },
  { orderId: 'o3', menuItemId: 'f1', name: 'バターチキン', unitPrice: 1200, quantity: 1, lineTotal: 1200, cancelled: true, itemType: 'food', station: 'kitchen', includesDrinks: false },
  { orderId: 'o3', menuItemId: 'f2', name: 'ナン', unitPrice: 500, quantity: 3, lineTotal: 1500, cancelled: false, itemType: 'food', station: 'kitchen', includesDrinks: false },
  { orderId: 'o3', menuItemId: 'p1', name: '大盛り', unitPrice: 100, quantity: 1, lineTotal: 100, cancelled: false, itemType: 'option', station: null, includesDrinks: false },
];

describe('レジクローズの売上内訳（2026-09-27 Ronnie）', () => {
  const b = computeCloseBreakdown(orders, items);

  it('予約経路別（グルメサイト・ウォークイン・テイクアウト）', () => {
    expect(b.bySource.map((r) => r.label)).toEqual(['食べログ', 'ホットペッパー', WALK_IN_LABEL, 'テイクアウト']);
    expect(b.bySource[0]).toMatchObject({ orders: 1, guests: 4, sales: 12000 });
    expect(b.totals).toEqual({ orders: 4, guests: 8, sales: 21500 });
  });

  it('担当者別（伝票数・客数・売上・品数）', () => {
    const ronnie = b.byClerk.find((r) => r.label === 'Ronnie')!;
    expect(ronnie).toMatchObject({ orders: 2, guests: 5, sales: 13500, items: 14 });
    expect(b.byClerk.find((r) => r.label === '担当なし')).toMatchObject({ orders: 1, sales: 5000 });
  });

  it('コース・フード・ドリンクの出数（取消は除く・オプションは入れない）', () => {
    expect(b.courses[0]).toMatchObject({ name: '2H飲み放題付コース', quantity: 4 });
    expect(b.foods.map((r) => r.name)).toEqual(['ナン', 'バターチキン']);
    expect(b.foods.find((r) => r.name === 'バターチキン')).toMatchObject({ quantity: 2, sales: 2400 });
    expect(b.drinks.find((r) => r.name === '生ビール')).toMatchObject({ quantity: 7 });
  });

  it('飲み放題: プラン数と 0 円ドリンクの杯数（有料ドリンクは数えない）', () => {
    expect(b.nomihoudai.planCount).toBe(4);
    expect(b.nomihoudai.orders).toBe(1);
    expect(b.nomihoudai.glasses).toBe(9);
    expect(b.nomihoudai.drinks).toEqual([
      { name: '生ビール', quantity: 6, sales: 0 },
      { name: 'ハイボール', quantity: 3, sales: 0 },
    ]);
  });

  it('日付の前後', () => {
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', toExclusive: '2027-01-01' });
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});
