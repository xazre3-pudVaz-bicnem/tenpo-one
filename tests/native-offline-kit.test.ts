import { describe, expect, it } from 'vitest';
import { kitchenPrintersFor, offlineTotals, offlineUnitPrice, receiptPrinterFor, slipPrinterFor, type OfflinePrinter } from '@/lib/native-offline-kit';

const P = (id: string, over: Partial<OfflinePrinter> = {}): OfflinePrinter => ({
  id, name: id, usage: 'kitchen', maker: 'escpos', paperWidth: 80, stations: ['kitchen'], floorIds: [],
  upsideDown: false, billSlips: false, autoPrint: false, drawerKick: false, drawerCommand: null, lan: null, ...over,
});
const ids = (ps: OfflinePrinter[]) => ps.map((p) => p.id);

describe('オフラインの厨房伝票の振り分け（claim_kitchen_items と同じ）', () => {
  it('フロア担当の機械 → そのフロア。担当の無い機械 → それ以外のフロア・卓なし', () => {
    const ps = [P('A'), P('B', { floorIds: ['F2'] })];
    expect(ids(kitchenPrintersFor(ps, 'kitchen', 'F2'))).toEqual(['B']);
    expect(ids(kitchenPrintersFor(ps, 'kitchen', 'F1'))).toEqual(['A']);
    expect(ids(kitchenPrintersFor(ps, 'kitchen', null))).toEqual(['A']);
  });

  it('持ち場（ドリンク）で分ける。レシート機は入らない', () => {
    const ps = [P('R', { usage: 'receipt', stations: ['kitchen', 'drink'] }), P('K'), P('D', { stations: ['drink'] })];
    expect(ids(kitchenPrintersFor(ps, 'drink', null))).toEqual(['D']);
    expect(ids(kitchenPrintersFor(ps, 'kitchen', null))).toEqual(['K']);
  });

  it('どの機械にも当たらない（全部フロア指定）→ その持ち場で最初に登録した1台', () => {
    const ps = [P('A', { floorIds: ['F1'] }), P('B', { floorIds: ['F2'] })];
    expect(ids(kitchenPrintersFor(ps, 'kitchen', 'F3'))).toEqual(['A']);
    expect(ids(kitchenPrintersFor(ps, 'kitchen', null))).toEqual(['A']);
    expect(kitchenPrintersFor(ps, 'drink', 'F1')).toEqual([]);
  });

  it('同じ持ち場・同じ扱いの機械が2台なら両方', () => {
    expect(ids(kitchenPrintersFor([P('A'), P('B')], 'kitchen', 'F1'))).toEqual(['A', 'B']);
  });
});

describe('レジ機・会計伝票のプリンター（getCloudPrntPrinter と同じ）', () => {
  const ps = [P('K', { billSlips: true, floorIds: ['F2'] }), P('R2', { usage: 'receipt', floorIds: ['F3'] }), P('R', { usage: 'receipt' })];
  it('レシート：この iPad で選んだ機械 → 担当フロアの無いレジ機', () => {
    expect(receiptPrinterFor(ps, null)?.id).toBe('R');
    expect(receiptPrinterFor(ps, 'R2')?.id).toBe('R2');
    expect(receiptPrinterFor(ps, 'K')?.id).toBe('R');
  });
  it('会計伝票：卓のフロアの担当 → 既定（レジ機を先に）', () => {
    expect(slipPrinterFor(ps, 'F2', null)?.id).toBe('K');
    expect(slipPrinterFor(ps, 'F3', null)?.id).toBe('R2');
    expect(slipPrinterFor(ps, 'F1', null)?.id).toBe('R');
    expect(slipPrinterFor(ps, null, null)?.id).toBe('R');
  });
});

describe('合計（recalc_order_totals と同じ）', () => {
  it('内税10%・サービス料10%', () => {
    const t = offlineTotals([{ lineTotal: 1200, taxRate: 10, taxIncluded: true }, { lineTotal: 720, taxRate: 10, taxIncluded: true }], 10);
    expect(t).toEqual({ subtotal: 1744, taxTotal: 176, serviceCharge: 192, total: 2112 });
  });
  it('外税8%・値引き', () => {
    const t = offlineTotals([{ lineTotal: 1000, taxRate: 8, taxIncluded: false }], 0, 100);
    expect(t).toEqual({ subtotal: 1000, taxTotal: 80, serviceCharge: 0, total: 980 });
  });
});

describe('単価（addItem と同じ：時間帯の値段＋選択肢）', () => {
  const kit = {
    items: { m1: { categoryId: 'c1', station: 'drink', nameEn: null, kana: null, itemType: 'drink', price: 600, taxRate: 10, taxIncluded: true } },
    dynamicRules: [{ id: 'r', name: 'HH', enabled: true, days: [], start: '17:00', end: '19:00', target: 'all' as const, categoryIds: [], itemIds: [], kind: 'percent' as const, value: -20, roundTo10: false }],
  };
  it('ハッピーアワーは2割引き、それ以外は元の値段', () => {
    expect(offlineUnitPrice(kit, 'm1', 50, new Date('2026-10-24T09:00:00Z'))).toBe(530); // 18:00 JST
    expect(offlineUnitPrice(kit, 'm1', 0, new Date('2026-10-24T03:00:00Z'))).toBe(600); // 12:00 JST
    expect(offlineUnitPrice(kit, 'nope', 0, new Date())).toBeNull();
  });
});
