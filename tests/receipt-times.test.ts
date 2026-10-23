import { describe, it, expect, vi } from 'vitest';
import iconv from 'iconv-lite';
import { buildReceipt, formatReceiptDateTime, type BuildReceiptInput } from '@/lib/receipts';
import { receiptToStarPrnt, orderSlipStarPrnt } from '@/lib/starprnt';
import { receiptToStarMarkup, orderSlipMarkup } from '@/lib/receipt-markup';
import { receiptToEposXml, orderSlipEposXml } from '@/lib/epos-print';
const input: BuildReceiptInput = {
  store: { name: 'テスト店' }, order: { orderNo: 123, openedAt: '2026-10-23T14:30:00Z', closedAt: '2026-10-23T16:05:00Z', subtotal: 1000, taxTotal: 100, serviceCharge: 0, discountTotal: 0, total: 1100 },
  items: [{ name: 'カレー', quantity: 1, unitPrice: 1100, lineTotal: 1100, taxRate: 10 }], payments: [], methodLabels: {},
};
const decode = (b: Buffer) => iconv.decode(b, 'cp932');
describe('table start and checkout timestamps', () => {
  it('uses saved opening/checkout dates across midnight in Japan and on reprint', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      const r = buildReceipt({ ...input, isReissue: true });
      expect(r.startedAt).toBe('2026/10/23 23:30'); expect(r.completedAt).toBe('2026/10/24 01:05');
      expect(r.issuedAt).toBe(r.completedAt);
    } finally { vi.useRealTimers(); }
  });
  it('never invents a start or checkout timestamp for missing/invalid data', () => {
    expect(formatReceiptDateTime('bad')).toBeNull(); expect(formatReceiptDateTime(null)).toBeNull();
    const r = buildReceipt({ ...input, order: { ...input.order, openedAt: null, closedAt: null } });
    expect(r.startedAt).toBeNull(); expect(r.completedAt).toBeNull();
    expect(receiptToStarMarkup(r)).not.toContain('会計日時');
  });
  it.each([58, 80] as const)('prints both labelled times on paid receipts for every %smm transport', paperWidth => {
    const r = buildReceipt(input);
    for (const body of [decode(receiptToStarPrnt(r, { paperWidth })), receiptToStarMarkup(r, { paperWidth }), receiptToEposXml(r, { paperWidth })]) {
      expect(body).toContain('開始日時'); expect(body).toContain('2026/10/23 23:30');
      expect(body).toContain('会計日時'); expect(body).toContain('2026/10/24 01:05');
      expect(body).toContain('No.123');
    }
  });
  it.each([58, 80] as const)('prints the table start rather than the print time on prepayment bills (%smm)', paperWidth => {
    const r = buildReceipt(input);
    const slip = { storeName: r.storeName, orderNo: r.orderNo, tableName: 'T-1', guestCount: 2, clerkName: null, startedAt: r.startedAt, issuedAt: '2030/01/01 09:00', lines: r.lines, subtotal: r.subtotal, taxTotal: 100, serviceCharge: 0, discount: 0, total: r.total };
    for (const body of [decode(orderSlipStarPrnt(slip, { paperWidth })), orderSlipMarkup(slip, { paperWidth }), orderSlipEposXml(slip, { paperWidth })]) {
      expect(body).toContain('開始日時'); expect(body).toContain('2026/10/23 23:30');
      expect(body).not.toContain('2030/01/01'); expect(body).not.toContain('会計日時');
    }
  });
});
