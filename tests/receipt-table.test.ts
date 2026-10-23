import { describe, it, expect } from 'vitest';
import { receiptTableLines, dispWidth, STAR_WIDTH_OPTIONS } from '../lib/receipt-layout';
describe('compact receipt table', () => {
  it.each([32, 48])('fits %i columns and omits options without losing item total', (width) => {
    const rows = receiptTableLines([{ name: '長い商品名 Butter Chicken Curry Set', quantity: 2, unitPrice: 1000, lineTotal: 2200, modifiers: [{ name: 'Mild', price: 100 }] }], width);
    expect(rows.join('\n')).toContain('商品名');
    expect(rows.join('\n')).toContain('¥2,200');
    expect(rows.join('\n')).not.toContain('Mild');
    expect(rows.join('\n')).toContain('数量');
    expect(rows.join('\n')).not.toMatch(/QT|MENU|PRICE/);
    expect(rows.every((row) => dispWidth(row) <= width)).toBe(true);
  });
});

it.each([32, 48])('Japanese Star table headings fit %i columns', (width) => {
  const rows = receiptTableLines([], width, STAR_WIDTH_OPTIONS);
  expect(rows.every((row) => dispWidth(row, STAR_WIDTH_OPTIONS) <= width)).toBe(true);
});
