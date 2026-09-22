import { describe, expect, it } from 'vitest';
import {
  normalizeFloorIds,
  pickDefaultPrinter,
  pickPrinterForFloor,
  printerServesFloor,
  printsBillSlips,
} from '@/lib/printer-floors';

// SHUNKA 新宿: 4F=レジ（既定）、3F・5F に会計伝票のプリンター
const regi4f = { id: 'regi', floorIds: [] as string[] };
const p3f = { id: 'p3', floorIds: ['f3'] };
const p5f = { id: 'p5', floorIds: ['f5'] };
const all = [regi4f, p3f, p5f];

describe('pickPrinterForFloor（会計伝票をどのプリンターから出すか）', () => {
  it('担当フロアのプリンターから出す', () => {
    expect(pickPrinterForFloor(all, 'f3')?.id).toBe('p3');
    expect(pickPrinterForFloor(all, 'f5')?.id).toBe('p5');
  });
  it('担当のいないフロア・フロア未割当・卓なしは既定プリンター', () => {
    expect(pickPrinterForFloor(all, 'f4')?.id).toBe('regi');
    expect(pickPrinterForFloor(all, null)?.id).toBe('regi');
    expect(pickPrinterForFloor(all, undefined)?.id).toBe('regi');
  });
  it('既定プリンターが無ければ先頭', () => {
    expect(pickPrinterForFloor([p3f, p5f], 'f4')?.id).toBe('p3');
    expect(pickPrinterForFloor([], 'f3')).toBeNull();
  });
  it('担当フロアを設定していない店は今まで通り（先頭の既定）', () => {
    const a = { id: 'a', floorIds: [] };
    const b = { id: 'b', floorIds: [] };
    expect(pickPrinterForFloor([a, b], 'f3')?.id).toBe('a');
    expect(pickDefaultPrinter([a, b])?.id).toBe('a');
  });
  it('レシート（会計確定）は担当フロアのない既定プリンター', () => {
    expect(pickDefaultPrinter([p3f, regi4f, p5f])?.id).toBe('regi');
  });
});

describe('printerServesFloor（QR注文のお会計伝票の自動印刷）', () => {
  it('担当フロアのプリンターは自分のフロアだけ', () => {
    expect(printerServesFloor(p3f, 'f3', all)).toBe(true);
    expect(printerServesFloor(p3f, 'f5', all)).toBe(false);
    expect(printerServesFloor(p3f, null, all)).toBe(false);
  });
  it('既定プリンターは担当のいないフロアと未割当の卓', () => {
    expect(printerServesFloor(regi4f, 'f3', all)).toBe(false);
    expect(printerServesFloor(regi4f, 'f4', all)).toBe(true);
    expect(printerServesFloor(regi4f, null, all)).toBe(true);
  });
  it('1枚の伝票はちょうど1台から出る', () => {
    for (const f of ['f3', 'f4', 'f5', null]) {
      expect(all.filter((p) => printerServesFloor(p, f, all))).toHaveLength(1);
    }
  });
});

describe('normalizeFloorIds', () => {
  it('null・重複・空・許可外を捨てる', () => {
    expect(normalizeFloorIds(null)).toEqual([]);
    expect(normalizeFloorIds(['f3', 'f3', '', 5, 'f5'])).toEqual(['f3', 'f5']);
    expect(normalizeFloorIds(['f3', 'x'], new Set(['f3']))).toEqual(['f3']);
  });
});

describe('printsBillSlips（会計伝票を出せるか）', () => {
  it('レシート機は常に、厨房機は「会計伝票も出す」のときだけ', () => {
    expect(printsBillSlips({ usage: 'receipt' })).toBe(true);
    expect(printsBillSlips({ usage: 'kitchen', bill_slips: true })).toBe(true);
    expect(printsBillSlips({ usage: 'kitchen', bill_slips: false })).toBe(false);
    expect(printsBillSlips({ usage: 'kitchen' })).toBe(false);
    expect(printsBillSlips({ usage: 'label', bill_slips: true })).toBe(false);
  });
});

describe('SHUNKA 新宿の構成（ドリンク機は各階、キッチン・焼き場は 4F の1台ずつ）', () => {
  const drink4 = { id: 'd4', floorIds: [] as string[] };
  const drink3 = { id: 'd3', floorIds: ['f3'] };
  const drink5 = { id: 'd5', floorIds: ['f5'] };
  const drinks = [drink4, drink3, drink5];
  it('ドリンク伝票は卓の階のドリンク機1台から', () => {
    expect(drinks.filter((p) => printerServesFloor(p, 'f3', drinks)).map((p) => p.id)).toEqual(['d3']);
    expect(drinks.filter((p) => printerServesFloor(p, 'f5', drinks)).map((p) => p.id)).toEqual(['d5']);
    expect(drinks.filter((p) => printerServesFloor(p, 'f4', drinks)).map((p) => p.id)).toEqual(['d4']);
  });
  it('焼き場・キッチンは1台だけなので全フロアの伝票を出す', () => {
    const grill = { id: 'g', floorIds: [] as string[] };
    for (const f of ['f3', 'f4', 'f5', null]) expect(printerServesFloor(grill, f, [grill])).toBe(true);
  });
  it('会計伝票: 3F・5F の卓はその階のドリンク機、4F はレジ機', () => {
    const regi = { id: 'regi', floorIds: [] as string[] };
    const billers = [regi, drink3, drink5];
    expect(pickPrinterForFloor(billers, 'f3')?.id).toBe('d3');
    expect(pickPrinterForFloor(billers, 'f5')?.id).toBe('d5');
    expect(pickPrinterForFloor(billers, 'f4')?.id).toBe('regi');
  });
});
