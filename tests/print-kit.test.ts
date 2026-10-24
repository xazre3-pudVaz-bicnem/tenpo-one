import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildReceipt } from '@/lib/receipts';
import { receiptToStarPrnt, orderSlipStarPrnt } from '@/lib/starprnt';
import { receiptToEposXml } from '@/lib/epos-print';
import { eposXmlToEscPos } from '@/lib/escpos';
import { METHOD_LABELS } from '@/components/cash/labels';
import { kitchenDesigns } from '@/lib/print-kit';
import { kitchenDesign, cancelBillDesign } from '@/lib/ticket-design';
import { renderTicketImage, ticketImagePayload } from '@/lib/ticket-design-server';
import sharp from 'sharp';
import type { NativeOfflineKit } from '@/lib/native-offline-kit';

type Kit = {
  version: number;
  setKit: (json: string) => string;
  rasterBytes: (json: string) => string;
  kitchenJobs: (json: string) => string;
  cancelJob: (json: string) => string;
  slipJob: (json: string) => string;
  receiptJob: (json: string) => string;
  totals: (json: string) => string;
  unitPrice: (json: string) => string;
  kitchenDesigns: (json: string) => string;
  cancelDesign: (json: string) => string;
  receiptBytes: (json: string) => string;
  orderSlipBytes: (json: string) => string;
};

let kit: Kit;

beforeAll(() => {
  // JavaScriptCore と同じく、Node の機能（Buffer・require）が無いところで動くか
  execFileSync('node', ['scripts/build-print-kit.mjs'], { stdio: 'pipe' });
  const code = readFileSync('public/print-kit.js', 'utf8');
  const ctx: Record<string, unknown> = { console };
  ctx.globalThis = ctx;
  vm.runInNewContext(code, ctx);
  kit = ctx.TenpoPrintKit as Kit;
}, 60_000);

const receiptInput = {
  store: { name: 'Ronnies Shop', address: '東京都新宿区1-2-3', phone: '03-0000-0000', registrationNumber: 'T1234567890123', headerMessage: null, footerMessage: 'またお越しください' },
  order: { orderNo: 'オフライン-1', closedAt: '2026-10-24T06:00:00.000Z', openedAt: '2026-10-24T05:00:00.000Z', subtotal: 1745, taxTotal: 175, serviceCharge: 0, discountTotal: 0, total: 1920 },
  items: [
    { name: '生ビール', quantity: 2, unitPrice: 600, lineTotal: 1200, taxRate: 10, modifiers: [] },
    { name: '唐揚げ', quantity: 1, unitPrice: 720, lineTotal: 720, taxRate: 10, modifiers: [{ name: '大盛り', price: 0 }] },
  ],
  payments: [{ method: 'cash', amount: 1920, tendered: 2000, change: 80 }],
  staffName: 'Ronnie',
  guestCount: 2,
  tableName: 'T1',
};

describe('オフライン印字キット（iPad の JavaScriptCore で動く1ファイル）', () => {
  it('Node の機能なしで読み込める', () => {
    expect(kit.version).toBe(3);
  });

  it('レシートはサーバーと同じバイト列（Star・ESC/POS）', () => {
    const receipt = buildReceipt({ ...receiptInput, methodLabels: METHOD_LABELS });
    const star = kit.receiptBytes(JSON.stringify({ receipt: receiptInput, maker: 'star', paperWidth: 80 }));
    expect(star).toBe(receiptToStarPrnt(receipt, { paperWidth: 80 }).toString('base64'));
    const esc = kit.receiptBytes(JSON.stringify({ receipt: receiptInput, maker: 'escpos', paperWidth: 58 }));
    expect(esc).toBe(eposXmlToEscPos(receiptToEposXml(receipt, { paperWidth: 58 })).toString('base64'));
  });

  it('会計伝票もサーバーと同じ', () => {
    const slip = { storeName: 'Ronnies Shop', orderNo: '12', tableName: 'T2', guestCount: 3, clerkName: null, issuedAt: '14:20', lines: [{ name: '枝豆', quantity: 1, unitPrice: 390, lineTotal: 390, modifiers: [] }], subtotal: 355, taxTotal: 35, serviceCharge: 0, discount: 0, total: 390 };
    expect(kit.orderSlipBytes(JSON.stringify({ slip, maker: 'star', paperWidth: 80 }))).toBe(orderSlipStarPrnt(slip, { paperWidth: 80 }).toString('base64'));
  });

  it('厨房伝票の TicketDesign（取消は取消の見出し）', () => {
    const rows = [
      { order_id: 'o1', order_no: 'オフライン-1', table_name: 'T1', guest_count: 2, clerk_name: 'Ronnie', item_name: '唐揚げ', item_name_en: 'Karaage', modifiers: null, memo: null, station: 'kitchen', delta: 2 },
      { order_id: 'o1', order_no: 'オフライン-1', table_name: 'T1', guest_count: 2, clerk_name: 'Ronnie', item_name: '枝豆', item_name_en: 'Edamame', modifiers: null, memo: null, station: 'kitchen', delta: -1, cancelReason: '担当: Ronnie' },
    ];
    const input = { rows, stations: ['kitchen'], split: 'item' as const, textSize: 'medium' as const, language: 'both' as const, printedAt: '14:20' };
    const designs = JSON.parse(kit.kitchenDesigns(JSON.stringify(input)));
    expect(designs).toEqual(JSON.parse(JSON.stringify(kitchenDesigns({ ...input, rows: rows as never }))));
    expect(JSON.stringify(designs)).toContain('取消 / CANCEL');
    expect(JSON.stringify(designs)).toContain('T1');
  });

  it('取消伝票の TicketDesign', () => {
    const d = JSON.parse(kit.cancelDesign(JSON.stringify({
      storeName: 'Ronnies Shop', address: null, phone: null, registration: null, orderNo: 'オフライン-1', tableName: 'T1', guestCount: 2, staffName: 'Ronnie',
      orderedAt: '2026/10/24 14:00', cancelledAt: '2026/10/24 14:10', cancelledBy: 'Ronnie', reason: null,
      items: [{ name: '枝豆', quantity: 1, amount: 390, taxRate: 10, taxIncluded: true }],
    })));
    expect(JSON.stringify(d)).toContain('取消会計伝票');
  });

  it('白黒の画像 → サーバーの ticketImagePayload と同じバイト列（Star・ESC/POS・ブザー）', async () => {
    const design = kitchenDesign(
      { orderId: 'o1', orderNo: '7', tableName: 'T3', guestCount: 2, clerkName: 'Ronnie', lines: [{ name: '唐揚げ', nameEn: 'Karaage', delta: 2, modifiers: [], memo: null }] },
      { title: 'キッチン 伝票', printedAt: '14:20', textSize: 'medium', language: 'both' }
    );
    const png = await renderTicketImage(design, 576);
    const server = await ticketImagePayload([png], 'drawer1');
    const { data, info } = await sharp(png).flatten({ background: '#fff' }).greyscale().threshold(170).raw().toBuffer({ resolveWithObject: true });
    const rowBytes = Math.ceil(info.width / 8);
    const bits = Buffer.alloc(rowBytes * info.height);
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 128) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    const images = [{ width: info.width, height: info.height, bits: bits.toString('base64') }];
    expect(kit.rasterBytes(JSON.stringify({ images, buzzer: 'drawer1', maker: 'star' }))).toBe(server.starprnt);
    expect(kit.rasterBytes(JSON.stringify({ images, buzzer: 'drawer1', maker: 'escpos' }))).toBe(eposXmlToEscPos(server.epos).toString('base64'));
  }, 30_000);

  it('道具箱を入れると、プリンターの振り分け・レシート・会計伝票・取消・合計まで出せる', () => {
    const base = { usage: 'kitchen', paperWidth: 80 as const, stations: ['kitchen'], floorIds: [], upsideDown: false, billSlips: false, autoPrint: false, drawerKick: false, drawerCommand: null };
    const offline: NativeOfflineKit = {
      version: 'v1', storeId: 's1',
      store: { name: 'Ronnies Shop', address: '東京都新宿区1-2-3', phone: '03-0000-0000', registrationNumber: 'T1234567890123', headerMessage: null, footerMessage: null },
      serviceChargeRate: 0,
      kitchen: { split: 'order', textSize: 'medium', language: 'both', buzzer: 'drawer1', defaultFloorId: null },
      drawer: { autoOpenOnCash: true, openOnCashless: false },
      printers: [
        { ...base, id: 'K', name: '厨房', maker: 'escpos', lan: { host: '192.168.1.50', port: 9100 } },
        { ...base, id: 'D', name: 'ドリンク', maker: 'escpos', stations: ['drink'], lan: { host: '192.168.1.51', port: 9100 } },
        { ...base, id: 'R', name: 'レジ', usage: 'receipt', maker: 'star', drawerKick: true, drawerCommand: 'drawer1', lan: null },
      ],
      preferredReceiptPrinterId: null,
      items: {
        m1: { categoryId: 'c1', station: 'kitchen', nameEn: 'Karaage', kana: null, itemType: 'food', price: 720, taxRate: 10, taxIncluded: true },
        m2: { categoryId: 'c2', station: 'drink', nameEn: 'Draft Beer', kana: null, itemType: 'drink', price: 600, taxRate: 10, taxIncluded: true },
      },
      categoryStations: { c1: 'kitchen', c2: 'drink' },
      tableFloors: { t1: null },
      dynamicRules: [],
    };
    expect(kit.setKit(JSON.stringify(offline))).toBe('v1');
    const jobs = JSON.parse(kit.kitchenJobs(JSON.stringify({
      order: { id: 'off-1', orderNo: 'オフライン-1', tableId: 't1', tableName: 'T1', guestCount: 2, clerkName: 'Ronnie' },
      lines: [
        { menuItemId: 'm1', name: '唐揚げ', modifiers: [], memo: null, delta: 1 },
        { menuItemId: 'm2', name: '生ビール', modifiers: [], memo: null, delta: 2 },
      ],
      printedAt: '14:20',
    })));
    expect(jobs.map((j: { printer: { printerId: string } }) => j.printer.printerId).sort()).toEqual(['D', 'K']);
    const drink = jobs.find((j: { printer: { printerId: string } }) => j.printer.printerId === 'D');
    expect(JSON.stringify(drink.designs)).toContain('Draft Beer');
    expect(JSON.stringify(drink.designs)).not.toContain('Karaage');
    expect(drink.printer).toMatchObject({ dots: 576, lan: { host: '192.168.1.51', port: 9100 }, maker: 'escpos' });

    // 自動印刷 OFF のレジ機：'auto' はドロアだけ
    const drawerOnly = JSON.parse(kit.receiptJob(JSON.stringify({ receipt: { ...receiptInput, store: undefined }, drawer: true, print: 'auto' })));
    expect(Buffer.from(drawerOnly.data, 'base64')).toEqual(Buffer.from([7]));
    const receipt = JSON.parse(kit.receiptJob(JSON.stringify({ receipt: { ...receiptInput, store: undefined }, drawer: true, print: true })));
    expect(receipt.printer.printerId).toBe('R');
    const built = buildReceipt({ ...receiptInput, methodLabels: METHOD_LABELS });
    const expected = Buffer.concat([Buffer.from([7]), receiptToStarPrnt(built, { paperWidth: 80 })]);
    expect(Buffer.from(receipt.data, 'base64').subarray(-50)).toEqual(expected.subarray(-50));

    const slip = JSON.parse(kit.slipJob(JSON.stringify({ tableId: 't1', slip: { orderNo: 'オフライン-1', tableName: 'T1', guestCount: 2, clerkName: null, issuedAt: '14:20', lines: [], subtotal: 0, taxTotal: 0, serviceCharge: 0, discount: 0, total: 0 } })));
    expect(slip.printer.printerId).toBe('R');

    const cancel = JSON.parse(kit.cancelJob(JSON.stringify({ orderNo: 'オフライン-1', tableName: 'T1', guestCount: 2, staffName: 'Ronnie', orderedAt: '2026/10/24 14:00', cancelledAt: '2026/10/24 14:10', cancelledBy: 'Ronnie', reason: null, items: [{ name: '枝豆', quantity: 1, amount: 390, taxRate: 10, taxIncluded: true }] })));
    expect(cancel.designs[0]).toEqual(JSON.parse(JSON.stringify(cancelBillDesign({ storeName: 'Ronnies Shop', address: '東京都新宿区1-2-3', phone: '03-0000-0000', registration: 'T1234567890123', orderNo: 'オフライン-1', tableName: 'T1', guestCount: 2, staffName: 'Ronnie', orderedAt: '2026/10/24 14:00', cancelledAt: '2026/10/24 14:10', cancelledBy: 'Ronnie', reason: null, items: [{ name: '枝豆', quantity: 1, amount: 390, taxRate: 10, taxIncluded: true }] }))));

    expect(JSON.parse(kit.totals(JSON.stringify({ lines: [{ lineTotal: 1920, taxRate: 10, taxIncluded: true }] })))).toEqual({ subtotal: 1745, taxTotal: 175, serviceCharge: 0, total: 1920 });
    expect(JSON.parse(kit.unitPrice(JSON.stringify({ menuItemId: 'm2', optionExtra: 100, at: '2026-10-24T05:00:00Z' })))).toBe(700);
  });
});
