import { describe, expect, it } from 'vitest';
import { formatReceiptAddress } from '@/lib/receipt-layout';
import { classicInvoiceLayout } from '@/lib/classic-invoice';
import { receiptToStarMarkup } from '@/lib/receipt-markup';
import { baseReceipt } from './fixtures/receipt';

const street = '神奈川県横浜市港北区新横浜3-17-15';
const building = 'リバティー新横浜ビル3F';
describe('customer document address lines', () => {
  it.each([' ', '　', ''])('puts the complete building below the street with separator %j', gap => {
    expect(formatReceiptAddress(street + gap + building)).toBe(`${street}\n${building}`);
  });
  it('supports Japanese and full-width street numbers', () => {
    expect(formatReceiptAddress('東京都新宿区西新宿３丁目１７番１５号 第一ビル４F'))
      .toBe('東京都新宿区西新宿３丁目１７番１５号\n第一ビル４F');
  });
  it.each([street, '東京都新宿区', '123 Main Street', `${street}\n${building}`])('preserves address without a detected building or with explicit lines: %s', address => {
    expect(formatReceiptAddress(address)).toBe(address);
  });
  it('keeps the same address boundary in CloudPRNT and the classic invoice', () => {
    const receipt = { ...baseReceipt, storeAddress: `${street} ${building}` };
    expect(receiptToStarMarkup(receipt)).toContain(`${street}\n${building}`);
    const lines = classicInvoiceLayout(receipt).items.filter(x => x.kind === 'text').map(x => x.text);
    expect(lines).toContain(street);
    expect(lines).toContain(building);
  });
});
