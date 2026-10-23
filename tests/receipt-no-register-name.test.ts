import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { receiptToStarPrnt } from '@/lib/starprnt';
import { receiptToStarMarkup } from '@/lib/receipt-markup';
import { receiptToEposXml } from '@/lib/epos-print';
import { baseReceipt } from './fixtures/receipt';

describe('customer receipts omit internal register names', () => {
  for (const paperWidth of [58, 80] as const) {
    it(`preserves clerk, order and table on ${paperWidth}mm without register name`, () => {
      const receipt = { ...baseReceipt, registerName: 'STAR MC3 レシートレジ', staffName: 'Bimal' };
      const outputs = [
        iconv.decode(receiptToStarPrnt(receipt, { paperWidth }), 'cp932'),
        receiptToStarMarkup(receipt, { paperWidth }),
        receiptToEposXml(receipt, { paperWidth }),
      ];
      for (const output of outputs) {
        expect(output).not.toContain('STAR MC3');
        expect(output).not.toContain('レシートレジ');
        expect(output).toContain('Bimal');
        expect(output).toContain(baseReceipt.orderNo);
        expect(output).toContain(baseReceipt.tableName!);
      }
    });
  }
});
