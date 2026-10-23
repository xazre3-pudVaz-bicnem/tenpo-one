import { describe, it, expect } from 'vitest';
import { receiptTableLines, dispWidth, STAR_WIDTH_OPTIONS } from '../lib/receipt-layout';
describe('compact receipt table', () => {
  it.each([32, 48])('fits %i columns and omits options without losing item total', (width) => {
    const rows = receiptTableLines([{ name: '長い商品名 Butter Chicken Curry Set', quantity: 2, unitPrice: 1000, lineTotal: 2200, modifiers: [{ name: 'Mild', price: 100 }] }], width);
    expect(rows.join('\n')).toContain('商品名');
    expect(rows.join('\n')).toContain('¥2,200');
    expect(rows.join('\n')).not.toContain('Mild');
    expect(rows.join('\n')).toContain('数');
    expect(rows.join('\n')).not.toMatch(/QT|MENU|PRICE/);
    expect(rows.every((row) => dispWidth(row) <= width)).toBe(true);
  });
});

it.each([32, 48])('Japanese Star table headings fit %i columns', (width) => {
  const rows = receiptTableLines([], width, STAR_WIDTH_OPTIONS);
  expect(rows.every((row) => dispWidth(row, STAR_WIDTH_OPTIONS) <= width)).toBe(true);
});

it.each([28, 32, 42, 48])('keeps name/count/amount on one row without truncating values (%s columns)', width => {
  const fullName = '北海道産ほうれん草と国産鶏もも肉の濃厚バターチキンカレーセット';
  const input = [{ name: fullName, quantity: 1234, unitPrice: 1000, lineTotal: 1234567, modifiers: [{ name: '有料選択肢', price: 100 }] }];
  for (const options of [{}, STAR_WIDTH_OPTIONS, { yenFullWidth: true }]) {
    const rows = receiptTableLines(input, width, options);
    expect(rows).toHaveLength(3); // header, thin rule, one complete product row
    expect(rows[2]).toContain('...');
    expect(rows[2]).toContain('1234');
    expect(rows[2]).toContain('¥1,234,567');
    expect(rows[2].indexOf('1234')).toBeLessThan(rows[2].indexOf('¥1,234,567'));
    expect(rows.every(row => dispWidth(row, options) <= width)).toBe(true);
    expect(rows.join('\n')).not.toMatch(/[|+]/);
    expect(rows.join('\n')).not.toContain('有料選択肢');
    expect(input[0].name).toBe(fullName);
    expect(input[0].lineTotal).toBe(1234567);
  }
});
