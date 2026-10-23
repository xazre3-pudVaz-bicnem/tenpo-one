import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { receiptToStarPrnt, orderSlipStarPrnt } from '@/lib/starprnt';
import { receiptToStarMarkup, orderSlipMarkup } from '@/lib/receipt-markup';
import { receiptToEposXml, orderSlipEposXml } from '@/lib/epos-print';
import { baseReceipt } from './fixtures/receipt';

const receipt = { ...baseReceipt, registerName: 'STAR MC3 レシートレジ', footerMessage: '古い営業時間 LUNCH DINNER',
  guestCount: 3, payments: [{ label: '現金', amount: 11300 }], tendered: 12000, change: 700,
  refundTotal: 300, netPaid: 11000, isRefundReceipt: true, isReissue: true };
const slip = { storeName: receipt.storeName, orderNo: receipt.orderNo, tableName: receipt.tableName,
  guestCount: 3, clerkName: receipt.staffName, issuedAt: receipt.issuedAt, lines: receipt.lines,
  subtotal: receipt.subtotal, taxTotal: 1073, serviceCharge: 0, discount: 500, total: receipt.total };
const decode = (b: Buffer) => iconv.decode(b, 'cp932').replace(/\\/g, '¥');
describe('approved customer receipt design across all print transports', () => {
  it.each([58, 80] as const)('preserves financial and metadata fields on %smm paid receipts', paperWidth => {
    for (const text of [decode(receiptToStarPrnt(receipt, { paperWidth })), receiptToStarMarkup(receipt, { paperWidth }), receiptToEposXml(receipt, { paperWidth })]) {
      expect(text).toContain('会計レシート');
      expect(text).toContain('ご来店ありがとうございました');
      expect(text.replace(/<[^>]*>/g, '').replace(/&#10;|\n/g, '')).toContain('またのご来店をお待ちしております');
      expect(text).not.toContain('TENPO ONE');
      expect(text).not.toContain('STAR MC3');
      expect(text).not.toContain('LUNCH');
      expect(text).not.toContain('照会番号');
      expect(text).toContain('人数 3名');
      expect(text).toContain('¥11,300');
      expect(text).toContain('¥12,000');
      expect(text).toContain('¥700');
      expect(text).toContain('¥300');
      expect(text).toContain('¥11,000');
      expect(text).toContain('再発行');
      expect(text).toContain(receipt.registrationNumber);
    }
  });
  it.each([58, 80] as const)('prepayment bills have no payment or thank-you footer (%smm)', paperWidth => {
    for (const text of [decode(orderSlipStarPrnt(slip, { paperWidth })), orderSlipMarkup(slip, { paperWidth }), orderSlipEposXml(slip, { paperWidth })]) {
      expect(text).toContain('お会計伝票');
      expect(text).toContain('会計前のご確認用');
      expect(text).toContain('人数 3名');
      expect(text).not.toContain('領収書ではありません');
      expect(text).not.toContain('ありがとうございました');
      expect(text).not.toContain('TENPO ONE');
      expect(text).not.toContain('お釣り');
      expect(text).toContain('¥11,300');
      expect(text).toContain('¥500');
    }
  });
});
