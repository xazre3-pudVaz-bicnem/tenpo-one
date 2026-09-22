import { describe, it, expect } from 'vitest';
import { adjustPriceByPercent, applyBulkOp, bulkPatchProblem, diffBulkRows, filterBulkRows, type BulkRow } from '@/lib/menu-bulk';

const rows: BulkRow[] = [
  { id: 'a', name: '枝豆', nameEn: 'Edamame', categoryId: 'c1', itemType: 'food', price: 490, takeoutPrice: null, status: 'active', isSoldOut: false },
  { id: 'b', name: '生ビール', nameEn: 'Beer', categoryId: 'c2', itemType: 'drink', price: 600, takeoutPrice: 550, status: 'active', isSoldOut: false },
  { id: 'c', name: 'ハイボール', nameEn: '', categoryId: null, itemType: 'drink', price: 500, takeoutPrice: null, status: 'hidden', isSoldOut: true },
];

describe('メニュー一括編集（2026-09-23）', () => {
  it('変わった行・項目だけを保存する', () => {
    const next = rows.map((r) => (r.id === 'b' ? { ...r, price: 650, nameEn: ' Beer ' } : r));
    expect(diffBulkRows(rows, next)).toEqual([{ id: 'b', price: 650 }]);
    expect(diffBulkRows(rows, rows)).toEqual([]);
  });

  it('選んだ行にまとめてかける', () => {
    const sel = new Set(['a', 'b']);
    expect(applyBulkOp(rows, sel, { kind: 'pricePercent', percent: 10, roundTo10: true }).map((r) => r.price)).toEqual([540, 660, 500]);
    expect(applyBulkOp(rows, sel, { kind: 'priceAdd', yen: -500 }).map((r) => r.price)).toEqual([0, 100, 500]);
    expect(applyBulkOp(rows, sel, { kind: 'category', categoryId: 'c9' }).map((r) => r.categoryId)).toEqual(['c9', 'c9', null]);
    expect(applyBulkOp(rows, new Set(['c']), { kind: 'soldOut', soldOut: false })[2].isSoldOut).toBe(false);
    expect(adjustPriceByPercent(555, -10, false)).toBe(500);
  });

  it('絞り込み', () => {
    expect(filterBulkRows(rows, { categoryId: 'all', itemType: 'drink', search: '' }).map((r) => r.id)).toEqual(['b', 'c']);
    expect(filterBulkRows(rows, { categoryId: 'uncategorized', itemType: 'all', search: '' }).map((r) => r.id)).toEqual(['c']);
    expect(filterBulkRows(rows, { categoryId: 'all', itemType: 'all', search: 'beer' }).map((r) => r.id)).toEqual(['b']);
  });

  it('保存前のチェック', () => {
    expect(bulkPatchProblem({ id: 'a', name: ' ' })).toContain('商品名');
    expect(bulkPatchProblem({ id: 'a', price: -1 })).toContain('価格');
    expect(bulkPatchProblem({ id: 'a', price: 1.5 })).toContain('価格');
    expect(bulkPatchProblem({ id: 'a', itemType: 'x' })).toContain('種別');
    expect(bulkPatchProblem({ id: 'a', takeoutPrice: null, status: 'hidden' })).toBeNull();
  });
});
