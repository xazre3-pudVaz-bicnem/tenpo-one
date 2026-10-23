import { ordinalEn, singleCourseOf, type KitchenTicket, type KitchenLayoutOptions } from './kitchen-ticket';
import { formatReceiptAddress } from './receipt-layout';

export type TicketCell = { text: string; share?: number; align?: 'left' | 'center' | 'right'; size?: number; bold?: boolean };
export type TicketRow = { cells: TicketCell[]; size: number; bold?: boolean; black?: boolean; indent?: number; rule?: 'solid' | 'dotted'; gap?: number };
export type TicketDesign = { serif: boolean; rows: TicketRow[] };
const cell = (text: string, align: TicketCell['align'] = 'left', share = 1): TicketCell => ({ text, align, share });
const text = (value: string, size = 18, align: TicketCell['align'] = 'left'): TicketRow => ({ cells: [cell(value, align)], size });
const pair = (left: string, right: string, size = 18): TicketRow => ({ cells: [cell(left, 'left', 3), cell(right, 'right')], size });

/** One shared printable design, independent of printer protocol. No sample menu IDs. */
export function kitchenDesign(ticket: KitchenTicket, opts: KitchenLayoutOptions): TicketDesign {
  const size = opts.textSize === 'large' ? 28 : opts.textSize === 'normal' ? 21 : 24;
  const allCancel = ticket.lines.every(l => l.delta < 0);
  const part = ticket.part && ticket.part.total > 1 ? ` (${ticket.part.index}/${ticket.part.total})` : '';
  const rows: TicketRow[] = [
    { cells: [cell(opts.title.replace(/\s*伝票$/, '')), { ...cell(ticket.tableName ?? 'テイクアウト', 'center', 1.3), size: 36, bold: true }, cell(ticket.guestCount == null ? '' : `人数：${ticket.guestCount}名`, 'right')], size: 21, gap: 12 },
    { cells: [cell(`伝票No.${ticket.orderNo}${part}`), cell(opts.printedAt, 'center', .6), cell(ticket.clerkName ? `担当 ${ticket.clerkName}` : '', 'right')], size: 16, rule: 'solid', gap: 10 },
  ];
  if (allCancel) rows.push({ ...text('取消 / CANCEL', 28, 'center'), bold: true, black: true });
  const reasons = [...new Set(ticket.lines.filter(l => l.delta < 0).map(l => l.cancelReason?.trim()).filter((s): s is string => !!s))];
  // A shared reason belongs directly beneath the banner. Different reasons stay with each item.
  if (allCancel && reasons.length === 1) rows.push(text(`取消理由：${reasons[0]}`, 15));
  const course = singleCourseOf(ticket.lines);
  if (course) rows.push(text(course, 18));
  for (const l of ticket.lines) {
    if (!allCancel && l.delta < 0) rows.push({ ...text('取消 / CANCEL', 24, 'center'), black: true, bold: true });
    if (l.delta < 0 && l.cancelReason && (!allCancel || reasons.length > 1)) rows.push(text(`取消理由：${l.cancelReason}`, 15));
    const label = `${l.step ? ordinalEn(l.step.index) + ' ' : ''}${l.nameEn || l.name}`;
    rows.push({ cells: [cell(label, 'left', 9), cell(String(Math.abs(l.delta)), 'right')], size, bold: true, rule: 'dotted' });
    if (opts.language !== 'en' && l.nameEn && l.nameEn !== l.name) rows.push({ ...text(l.name, size - 3), indent: 14, rule: 'dotted' });
    if (l.step && !course) rows.push({ ...text(l.step.course, size - 3), indent: 14 });
    for (const m of l.modifiers) rows.push({ cells: [cell(m, 'left', 9), cell(String(Math.abs(l.delta)), 'right')], size: size - 2, indent: 14, rule: 'dotted' });
    if (l.memo) rows.push({ ...text(l.memo, size - 2), indent: 14, rule: 'dotted' });
  }
  return { serif: true, rows };
}

export interface CancelBillData {
  storeName: string; address: string | null; phone: string | null; registration: string | null;
  orderNo: string; tableName: string | null; guestCount: number | null; staffName: string | null;
  orderedAt: string; cancelledAt: string; cancelledBy: string | null; reason: string | null;
  items: { name: string; quantity: number; amount: number; taxRate: number; taxIncluded: boolean; modifiers?: string[]; memo?: string | null }[];
}
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
export function cancelBillDesign(data: CancelBillData): TicketDesign {
  const rows: TicketRow[] = [{ ...text(data.storeName, 25, 'center'), bold: true }];
  for (const line of formatReceiptAddress(data.address ?? '').split('\n')) if (line) rows.push(text(line, 15, 'center'));
  if (data.phone) rows.push(text(`TEL ${data.phone}`, 15, 'center'));
  if (data.registration) rows.push(text(`登録番号 ${data.registration}`, 15, 'center'));
  rows.push({ ...text('取消会計伝票 / CANCEL', 26, 'center'), bold: true, black: true, gap: 12 });
  if (data.reason?.trim()) rows.push(text(`取消理由：${data.reason.trim()}`, 15));
  rows.push(pair('卓番号', data.tableName ?? 'テイクアウト', 23), pair(`担当 ${data.staffName ?? '—'}`, data.guestCount == null ? '' : `人数 ${data.guestCount}名`),
    pair('元伝票番号', `No.${data.orderNo}`), pair('注文日時', data.orderedAt, 16), pair('取消日時', data.cancelledAt, 16));
  if (data.cancelledBy) rows.push(pair('取消担当', data.cancelledBy, 16));
  rows.push({ cells: [cell('商品名', 'left', 6), cell('数', 'right'), cell('金額', 'right', 2)], size: 18, rule: 'solid', gap: 8 });
  const taxes = new Map<number, number>(); let total = 0;
  for (const item of data.items) {
    const tax = item.taxIncluded ? item.amount - Math.floor(item.amount * 100 / (100 + item.taxRate)) : Math.floor(item.amount * item.taxRate / 100);
    const gross = item.amount + (item.taxIncluded ? 0 : tax); total += gross;
    taxes.set(item.taxRate, (taxes.get(item.taxRate) ?? 0) + tax);
    rows.push({ cells: [cell(item.name, 'left', 6), cell(String(item.quantity), 'right'), cell(yen(gross), 'right', 2)], size: 20 });
    for (const m of item.modifiers ?? []) rows.push({ ...text(m, 15), indent: 12 });
    if (item.memo) rows.push({ ...text(item.memo, 15), indent: 12 });
  }
  const taxTotal = [...taxes.values()].reduce((a, b) => a + b, 0);
  rows.push({ ...pair('小計（税抜）', yen(total - taxTotal), 17), gap: 10 });
  for (const [rate, tax] of taxes) rows.push(pair(`内消費税 ${rate}%`, yen(tax), 17));
  rows.push({ ...pair('取消合計', yen(total), 29), black: true, bold: true, gap: 12 });
  rows.push(text('この伝票は取消記録です。', 15, 'center'), text('領収書ではありません。', 15, 'center'));
  return { serif: false, rows };
}
