import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { kitchenDesign, cancelBillDesign, type CancelBillData } from '@/lib/ticket-design';
import { renderTicketImage, ticketImagePayload } from '@/lib/ticket-design-server';
import { groupKitchenTickets, type KitchenTicket } from '@/lib/kitchen-ticket';
import { eposXmlToEscPos } from '@/lib/escpos';
const ticket: KitchenTicket = { orderId: 'demo', orderNo: '8550', tableName: 'T-1', guestCount: 3, clerkName: 'Bimal', lines: [
  { name: 'マトンカレー', nameEn: 'Mutton Curry', delta: -2, modifiers: ['Very Hot', 'Goma Nan'], memo: 'No coriander', cancelReason: 'お客様のご都合によりキャンセル' },
] };
const opts = { title: 'キッチン 伝票', printedAt: '18:02', textSize: 'medium' as const, language: 'en' as const };
const bill: CancelBillData = { storeName: 'MEAT CROWN 新横浜', address: '神奈川県横浜市港北区新横浜3-17-15 リバティー新横浜ビル3F', phone: '045-548-5040', registration: 'T6040001126529', orderNo: 'DEMO', tableName: 'T-1', guestCount: 3, staffName: 'Bimal', cancelledBy: 'Bimal', orderedAt: '2026/10/24 00:18', cancelledAt: '2026/10/24 00:35', reason: 'お客様のご都合によりキャンセル', items: [
  { name: '本日のカレーセット', quantity: 1, amount: 1050, taxRate: 10, taxIncluded: true },
  { name: 'チキンカレーセット', quantity: 1, amount: 1100, taxRate: 10, taxIncluded: true },
] };
const texts = (d: ReturnType<typeof kitchenDesign>) => d.rows.flatMap(r => r.cells.map(c => c.text)).join('\n');
describe('approved kitchen and cancellation print designs', () => {
  it('centers the table, left-aligns time and right-aligns actual quantities, with small saved cancellation reasons', () => {
    const d = kitchenDesign(ticket, opts);
    expect(d.rows[1].cells[1]).toMatchObject({ text: 'T-1', align: 'center' });
    expect(d.rows[2].cells[0]).toMatchObject({ text: opts.printedAt, align: 'left', size: 36 });
    expect(d.rows.find(r => r.black)?.cells[0].text).toBe('取消 / CANCEL');
    expect(d.rows.find(r => r.cells[0].text.startsWith('取消理由'))?.size).toBe(15);
    expect(d.rows.find(r => r.cells[0].text === 'Mutton Curry')?.cells[1]).toMatchObject({ text: '2', align: 'right' });
    expect(texts(d)).not.toMatch(/[○★]|1102|1110|1111/);
    expect(texts(d)).toContain('No coriander');
  });
  it.each([384, 576] as const)('keeps only the time-row separator black in the actual %s-dot printer payload', async width => {
    const d = kitchenDesign({ ...ticket, lines: [{ ...ticket.lines[0], delta: 12 }] }, { ...opts, textSize: 'normal' });
    const item = d.rows.find(r => r.cells[0].text === 'Mutton Curry')!;
    expect(item.size).toBeGreaterThanOrEqual(40);
    expect(item.cells[1]).toMatchObject({ text: '12', align: 'right', share: 2 });
    expect(item.rule).toBeUndefined();
    expect(d.rows[0].cells).toEqual([{ text: 'キッチン', align: 'center', share: 1 }]);
    const rules = d.rows.filter(r => r.rule);
    expect(rules).toHaveLength(1);
    expect(rules[0].cells.some(c => c.text === opts.printedAt)).toBe(true);
    const png = await renderTicketImage({ serif: d.serif, rows: rules }, width);
    const payload = await ticketImagePayload([png]);
    const blocks = [...payload.epos.matchAll(/<image[^>]*>([^<]+)<\/image>/g)];
    const raster = Buffer.concat(blocks.map(m => Buffer.from(m[1], 'base64')));
    const rowBytes = width / 8;
    let solidRows = 0;
    for (let y = 0; y < raster.length / rowBytes; y++) {
      let black = 0;
      for (let x = 12; x < width - 12; x++) if (raster[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7))) black++;
      if (black === width - 24) solidRows++;
    }
    expect(solidRows).toBeGreaterThanOrEqual(2);
  });
  it('does not mix cancellation reasons when grouping identical products', () => {
    const base = { order_id: 'a', order_no: 1, table_name: 'T-1', guest_count: 2, clerk_name: null, item_name: 'Curry', modifiers: [], memo: null, station: 'kitchen', delta: -1 };
    const grouped = groupKitchenTickets([{ ...base, cancelReason: 'Wrong item' }, { ...base, cancelReason: 'Guest left' }]);
    expect(grouped[0].lines).toHaveLength(2);
    expect(texts(kitchenDesign(grouped[0], opts))).toContain('Guest left');
  });
  it('distinguishes additions from cancellations and keeps course details', () => {
    const d = kitchenDesign({ ...ticket, lines: [...ticket.lines, { ...ticket.lines[0], delta: 1, cancelReason: null }] }, opts);
    expect(d.rows.filter(r => r.black)).toHaveLength(1);
    expect(d.rows.filter(r => r.cells[0].text === 'Mutton Curry')).toHaveLength(2);
  });
  it('uses cancelled-item amounts and tax rates, with bilingual title and reversed total', () => {
    const d = cancelBillDesign(bill);
    expect(d.rows.filter(r => r.black).map(r => r.cells[0].text)).toEqual(['取消会計伝票 / CANCEL', '取消合計']);
    expect(texts(d)).toContain('¥2,150'); expect(texts(d)).toContain('¥1,954'); expect(texts(d)).toContain('¥196');
    expect(texts(cancelBillDesign({ ...bill, items: [{ ...bill.items[0], amount: 1000, taxRate: 8, taxIncluded: false }] }))).toContain('¥1,080');
  });
  it.each([384, 576] as const)('renders %s-dot Japanese/serif output with matching printer payloads and a single buzzer', async width => {
    const png = await renderTicketImage(kitchenDesign(ticket, opts), width);
    const meta = await sharp(png).metadata(); expect(meta.width).toBe(width);
    const payload = await ticketImagePayload([png], 'drawer1');
    const star = Buffer.from(payload.starprnt, 'base64'); expect(star.at(-1)).toBe(7);
    expect(payload.epos.match(/<pulse /g)).toHaveLength(1);
    expect(payload.epos.match(/<cut /g)).toHaveLength(1);
    expect(eposXmlToEscPos(payload.epos).length).toBeGreaterThan(100);
    // First monochrome block is byte-identical across transport formats.
    const match = payload.epos.match(/<image[^>]*>([^<]+)<\/image>/)!;
    const bits = Buffer.from(match[1], 'base64'); expect(star.subarray(11, 11 + bits.length)).toEqual(bits);
    const reversed = await renderTicketImage(kitchenDesign(ticket, opts), width, true);
    expect(await sharp(reversed).raw().toBuffer()).toEqual(await sharp(png).rotate(180).raw().toBuffer());
    if (width === 576 && process.env.TICKET_PREVIEW_DIR) {
      await writeFile(`${process.env.TICKET_PREVIEW_DIR}/kitchen-cancel.png`, png);
      await writeFile(`${process.env.TICKET_PREVIEW_DIR}/kitchen-normal.png`, await renderTicketImage(kitchenDesign({ ...ticket, lines: ticket.lines.map(l => ({ ...l, delta: 2, cancelReason: null })) }, opts), width));
      await writeFile(`${process.env.TICKET_PREVIEW_DIR}/cancel-bill.png`, await renderTicketImage(cancelBillDesign(bill), width));
    }
  }, 20_000);
  it('wraps long names and escaped reasons without cropping or treating text as markup', async () => {
    const short = await renderTicketImage(kitchenDesign(ticket, opts), 384);
    const long = await renderTicketImage(kitchenDesign({ ...ticket, lines: [{ ...ticket.lines[0], nameEn: 'A very long dish name '.repeat(8), cancelReason: '<b>&理由</b>'.repeat(20) }] }, opts), 384);
    expect((await sharp(long).metadata()).height).toBeGreaterThan((await sharp(short).metadata()).height!);
  });
});
