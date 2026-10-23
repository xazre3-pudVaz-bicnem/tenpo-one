import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { classicInvoiceLayout } from '@/lib/classic-invoice';
import { renderClassicInvoice } from '@/lib/classic-invoice-server';
import { eposXmlToEscPos } from '@/lib/escpos';
import { baseReceipt } from './fixtures/receipt';

describe('classic invoice', () => {
  it('uses the original settled timestamp, net paid amount and store data without internal register name', () => {
    const text = classicInvoiceLayout({ ...baseReceipt, refundTotal: 300, netPaid: 11000 }).items
      .filter(x => x.kind === 'text').map(x => x.text).join('\n');
    expect(text).toContain('¥11,000−');
    expect(text).toContain(`会計日時 ${baseReceipt.issuedAt}`);
    expect(text).toContain(baseReceipt.registrationNumber);
    expect(text).not.toContain(baseReceipt.registerName);
    expect(text).not.toContain('TENPO ONE');
  });
  it('retains long recipient and address text, increasing canvas height without clipping', () => {
    const name = '長い会社名のお客様'.repeat(16);
    const address = '神奈川県横浜市港北区新横浜'.repeat(18);
    const result = classicInvoiceLayout({ ...baseReceipt, storeAddress: address }, { recipientName: name });
    const text = result.items.filter(x => x.kind === 'text').map(x => x.text).join('');
    expect(text).toContain(name + ' 様');
    expect(text).toContain(address);
    for (const item of result.items) expect(item.y).toBeLessThan(result.height);
  });
  it('does not present full-order taxable totals as this split receipt amount', () => {
    const text = classicInvoiceLayout(baseReceipt, { amount: 5650, tax: 536, label: '(1/2)' }).items
      .filter(x => x.kind === 'text').map(x => x.text).join('\n');
    expect(text).toContain('¥5,650−');
    expect(text).toContain('¥536');
    expect(text).not.toContain('¥1,073');
  });
  it.each([58, 80] as const)('renders Japanese and emits equivalent raster payloads for %smm', async paper => {
    const r = await renderClassicInvoice(baseReceipt, { recipientName: '株式会社テスト' }, paper);
    const width = paper === 58 ? 384 : 576;
    expect(r.starprnt.subarray(0, 6)).toEqual(Buffer.from([27, 64, 27, 29, 83, 1]));
    const rowBytes = r.starprnt.readUInt16LE(6), height = r.starprnt.readUInt16LE(8);
    expect(rowBytes * 8).toBe(width);
    expect(r.starprnt.length).toBe(11 + rowBytes * height + 3);
    const esc = eposXmlToEscPos(r.epos);
    expect(esc.subarray(2, 6)).toEqual(Buffer.from([29, 118, 48, 0]));
    expect(esc.subarray(10, 10 + rowBytes * height)).toEqual(r.starprnt.subarray(11, 11 + rowBytes * height));
    expect(r.markup).toContain('data:image/png;base64,');
    const m = await sharp(r.landscape).metadata();
    expect(m.width).toBeGreaterThan(m.height!);
    if (process.env.INVOICE_PREVIEW_PATH) await writeFile(process.env.INVOICE_PREVIEW_PATH, r.landscape);
  });
  it('rejects corrupt raster XML rather than silently skipping or sending malformed image bytes', () => {
    expect(() => eposXmlToEscPos('<image width="576" height="2">AA==</image>')).toThrow('データ長');
  });
});
