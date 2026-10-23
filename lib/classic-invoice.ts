import type { ReceiptData } from './receipts';
import { wrapText, yen } from './receipt-layout';

/** Shared logical canvas for browser and printer. No demo/store-specific data. */
export type InvoicePrimitive =
  | { kind: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; align?: 'left' | 'right' | 'center'; width: number }
  | { kind: 'line'; x: number; y: number; width: number }
  | { kind: 'box'; x: number; y: number; width: number; height: number };
export interface ClassicInvoiceOptions {
  recipientName?: string | null;
  purpose?: string | null;
  amount?: number;
  tax?: number;
  label?: string;
}
export function classicInvoiceLayout(receipt: ReceiptData, options: ClassicInvoiceOptions = {}) {
  const width = 1080;
  const items: InvoicePrimitive[] = [];
  const text = (x: number, y: number, value: string, size: number, maxWidth: number, align: 'left' | 'right' | 'center' = 'left', bold = false) => {
    items.push({ kind: 'text', x, y, text: value, size, width: maxWidth, align, bold });
  };
  const rule = (x: number, y: number, w: number) => items.push({ kind: 'line', x, y, width: w });
  text(540, 24, '領 収 書', 38, 260, 'center', true);
  text(1045, 20, `会計日時 ${receipt.issuedAt}`, 18, 400, 'right');
  text(1045, 47, `No.${receipt.orderNo}${options.label ? ` ${options.label}` : ''}`, 18, 400, 'right');
  if (receipt.isReissue) text(35, 24, '※ 再発行', 19, 180);
  const recipient = (options.recipientName ?? '').trim();
  const recipientLines = recipient ? wrapText(`${recipient} 様`, 56) : ['様'];
  recipientLines.forEach((s, i) => text(845, 100 + i * 32, s, 27, 810, 'right'));
  const shift = Math.max(0, recipientLines.length - 1) * 32;
  rule(35, 139 + shift, 820);
  rule(35, 164 + shift, 1010);
  text(50, 188 + shift, '領収金額', 23, 250);
  text(940, 180 + shift, `${yen(options.amount ?? receipt.netPaid)}−`, 42, 640, 'right', true);
  text(1040, 204 + shift, '（税込）', 17, 100, 'right');
  rule(35, 245 + shift, 1010);
  const purposeLines = wrapText(`但し ${(options.purpose ?? '').trim() || '飲食代として'}`, 54);
  purposeLines.forEach((s, i) => text(35, 267 + shift + i * 27, s, 20, 610));
  text(1045, 269 + shift, '上記正に領収いたしました', 17, 380, 'right');
  const bottom = 324 + shift + Math.max(0, purposeLines.length - 1) * 27;
  items.push({ kind: 'box', x: 35, y: bottom, width: 140, height: 190 });
  ['収入印紙', '貼付欄', '（必要時）'].forEach((s, i) => text(105, bottom + 17 + i * 24, s, 16, 128, 'center'));
  // Space after the stamp is intentionally empty for physical cancellation.
  const taxX = 225;
  rule(taxX, bottom, 305);
  text(taxX, bottom + 10, '税率', 16, 65);
  text(440, bottom + 10, '対象額（税込）', 16, 145, 'right');
  text(530, bottom + 10, '消費税額', 16, 90, 'right');
  rule(taxX, bottom + 40, 305);
  let y = bottom + 51;
  if (options.label) {
    text(taxX, y, '内消費税', 17, 160);
    text(530, y, yen(options.tax ?? 0), 17, 140, 'right');
    y += 29;
    text(taxX, y, `合計 ${yen(receipt.netPaid)} のうち`, 16, 305);
    y += 29;
  } else {
    for (const row of receipt.taxRows) {
      text(taxX, y, `${row.rate}%`, 17, 65);
      text(440, y, yen(row.taxable), 17, 145, 'right');
      text(530, y, yen(row.tax), 17, 90, 'right');
      y += 29;
    }
  }
  y += 14;
  for (const s of wrapText(`お支払方法：${receipt.payments.map(p => p.label).join(' / ')}`, 32)) {
    text(taxX, y, s, 17, 305); y += 27;
  }
  if (receipt.staffName) for (const s of wrapText(`担当：${receipt.staffName}`, 32)) {
    text(taxX, y, s, 17, 305); y += 27;
  }
  let issuerY = bottom;
  for (const s of wrapText(receipt.storeName, 31)) {
    text(570, issuerY, s, 25, 385, 'left', true); issuerY += 36;
  }
  issuerY += 9;
  const details = [receipt.storeAddress, receipt.storePhone ? `TEL ${receipt.storePhone}` : null,
    receipt.registrationNumber ? `登録番号 ${receipt.registrationNumber}` : null].filter((s): s is string => !!s);
  for (const detail of details) for (const s of wrapText(detail, 42)) {
    text(570, issuerY, s, 17, 385); issuerY += 25;
  }
  if (receipt.registrationNumber) {
    text(570, issuerY + 12, '（適格簡易請求書・登録番号記載）', 13, 385); issuerY += 35;
  }
  // Clear right edge beside issuer for an optional shop seal; no printed 印 box.
  return { width, height: Math.max(bottom + 215, y + 22, issuerY + 22), items };
}
