/**
 * iPad アプリがネットの無いときに自分で印字するための「印字キット」（2026-10-24 Ronnie「net nachale pani print haru sabai kam、
 * Claude le app bhitrai」）。サーバーの印字と同じ関数（Codex の lib/kitchen-ticket・ticket-design・starprnt・epos-print・escpos・receipts）を
 * そのまま束ねて、scripts/build-print-kit.mjs で public/print-kit.js（JavaScriptCore で動く1ファイル）にする。
 * iPad はネットがあるときにこれを取って保存し、オフラインのときに呼ぶ。デザインはサーバーと同じ（二重に作らない）。
 *
 * 返すもの：
 *   - TicketDesign（厨房伝票・取消伝票）… iPad が CoreText で白黒の画像にして rasterBytes に渡す（サーバーの renderTicketImage →
 *     ticketImagePayload と同じ形。StarPRNT のラスター、ESC/POS は ePOS の <image> → GS v 0）
 *   - バイト列 base64（レシート・会計伝票・ドロア）… Star は StarPRNT、それ以外は ESC/POS
 * どのプリンターに出すか・合計・値段は lib/native-offline-kit.ts（サーバーと同じ決まり）。
 * ここは純粋な関数だけ（DB・Next・Node 非依存）。
 */
import {
  groupKitchenTickets,
  ticketSlips,
  STATION_LABELS,
  type ClaimedKitchenItem,
  type KitchenStation,
  type KitchenTicketBuzzer,
  type KitchenTicketLanguage,
  type KitchenTicketSplit,
  type KitchenTicketTextSize,
} from './kitchen-ticket';
import { kitchenDesign, cancelBillDesign, type CancelBillData, type TicketDesign } from './ticket-design';
import { buildReceipt, type BuildReceiptInput } from './receipts';
import { receiptToStarPrnt, orderSlipStarPrnt, buzzerStarPrnt, drawerKickStarPrnt, type OrderSlipData } from './starprnt';
import { receiptToEposXml, orderSlipEposXml, drawerKickEpos } from './epos-print';
import { eposXmlToEscPos } from './escpos';
import { METHOD_LABELS } from '@/components/cash/labels';
import {
  kitchenPrintersFor,
  offlineTotals,
  offlineUnitPrice,
  receiptPrinterFor,
  slipPrinterFor,
  type NativeOfflineKit,
  type OfflinePrinter,
  type OfflineMaker,
  type OfflineTotalsLine,
} from './native-offline-kit';

export const PRINT_KIT_VERSION = 3;

export type PrintKitMaker = OfflineMaker;

export interface KitchenDesignInput {
  rows: ClaimedKitchenItem[];
  /** このプリンターの持ち場（kitchen / drink …） */
  stations: string[];
  split: KitchenTicketSplit;
  textSize: KitchenTicketTextSize;
  language: KitchenTicketLanguage;
  /** 表示用の発行時刻（例 18:21） */
  printedAt: string;
}

/** 厨房伝票：差分行（作る数＋、取消−）→ 1枚ずつの TicketDesign（サーバーの generateKitchenJobs の画像と同じ見出し・並び） */
export function kitchenDesigns(input: KitchenDesignInput): TicketDesign[] {
  const tickets = groupKitchenTickets(input.rows);
  const stations = (input.stations.length > 0 ? input.stations : ['kitchen']) as KitchenStation[];
  const title = `${stations.map((s) => STATION_LABELS[s] ?? s).join('・')} 伝票`;
  const drinkTitle = `${STATION_LABELS.drink} 伝票`;
  const out: TicketDesign[] = [];
  for (const t of tickets) {
    for (const slip of ticketSlips(t, input.split)) {
      out.push(
        kitchenDesign(slip, {
          title: slip.drinkSlip ? drinkTitle : title,
          printedAt: input.printedAt,
          textSize: input.textSize,
          language: input.language,
        })
      );
    }
  }
  return out;
}

/** 取消伝票（レジに出す「取消会計伝票」）の TicketDesign */
export function cancelDesign(data: CancelBillData): TicketDesign {
  return cancelBillDesign(data);
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** レシート（会計のあと）。Star は StarPRNT、それ以外は ESC/POS。methodLabels は Web と同じ */
export function receiptBytes(input: { receipt: Omit<BuildReceiptInput, 'methodLabels'>; maker: PrintKitMaker; paperWidth: 58 | 80 }): string {
  const receipt = buildReceipt({ ...input.receipt, methodLabels: METHOD_LABELS });
  const paperWidth = input.paperWidth === 58 ? 58 : 80;
  return input.maker === 'star'
    ? toBase64(receiptToStarPrnt(receipt, { paperWidth }))
    : toBase64(eposXmlToEscPos(receiptToEposXml(receipt, { paperWidth })));
}

/** 会計伝票（お会計前の確認用）。Star は StarPRNT、それ以外は ESC/POS */
export function orderSlipBytes(input: { slip: OrderSlipData; maker: PrintKitMaker; paperWidth: 58 | 80 }): string {
  const paperWidth = input.paperWidth === 58 ? 58 : 80;
  return input.maker === 'star'
    ? toBase64(orderSlipStarPrnt(input.slip, { paperWidth }))
    : toBase64(eposXmlToEscPos(orderSlipEposXml(input.slip, { paperWidth })));
}

/** ドロアを開ける（会計の現金） */
export function drawerBytes(input: { maker: PrintKitMaker; command: string | null }): string {
  return input.maker === 'star'
    ? toBase64(drawerKickStarPrnt(input.command ?? ''))
    : toBase64(eposXmlToEscPos(drawerKickEpos(input.command)));
}

export interface RasterImage {
  width: number;
  height: number;
  /** 1ビット白黒（1＝黒）、左上から1行ずつ、行は ceil(width/8) バイト（MSB が左） */
  bits: string;
}

/**
 * iPad で描いた白黒の画像 → プリンターのバイト列（サーバーの ticketImagePayload と同じ組み方：
 * Star は ESC @ ＋ 256行ずつの ESC GS S ＋ ESC d 3、ESC/POS は ePOS の <image> を GS v 0 に）。ブザーは最後に1回。
 */
export function rasterBytes(input: { images: RasterImage[]; buzzer?: KitchenTicketBuzzer | null; maker: PrintKitMaker }): string {
  const star: Uint8Array[] = [];
  const xml: string[] = [];
  for (const img of input.images) {
    const rowBytes = Math.ceil(img.width / 8);
    const all = Buffer.from(img.bits, 'base64');
    star.push(Buffer.from([27, 64]));
    for (let top = 0; top < img.height; top += 256) {
      const height = Math.min(256, img.height - top);
      const bits = Buffer.alloc(rowBytes * height);
      all.copy(bits, 0, top * rowBytes, Math.min(all.length, (top + height) * rowBytes));
      star.push(Buffer.from([27, 29, 83, 1, rowBytes & 255, rowBytes >> 8, height & 255, height >> 8, 0]), bits);
      xml.push(`<image width="${img.width}" height="${height}" color="color_1" mode="mono">${bits.toString('base64')}</image>`);
    }
    star.push(Buffer.from([27, 100, 3]));
    xml.push('<cut type="feed"/>');
  }
  const buzzer = input.buzzer ?? undefined;
  if (input.maker === 'star') {
    star.push(buzzerStarPrnt(buzzer));
    return toBase64(Buffer.concat(star));
  }
  if (buzzer === 'drawer1' || buzzer === 'drawer2') xml.push(`<pulse drawer="${buzzer === 'drawer1' ? 'drawer_1' : 'drawer_2'}" time="pulse_100"/>`);
  return toBase64(eposXmlToEscPos(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${xml.join('')}</epos-print>`));
}

/** 厨房伝票のあとに鳴らすブザー（Star だけ。ESC/POS は rasterBytes の中で <pulse>） */
export function buzzerBytes(buzzer: KitchenTicketBuzzer): string {
  return toBase64(buzzerStarPrnt(buzzer));
}

// ─── オフラインの道具箱（NativeOfflineKit）を使う高いところの関数 ───

/** iPad に返すプリンター（送り先と描き方） */
export interface KitPrinter {
  printerId: string;
  printerName: string;
  maker: PrintKitMaker;
  paperWidth: 58 | 80;
  /** 画像の幅（58mm=384 / 80mm=576） */
  dots: 384 | 576;
  upsideDown: boolean;
  lan: { host: string; port: number } | null;
}

const kitPrinter = (p: OfflinePrinter): KitPrinter => ({
  printerId: p.id,
  printerName: p.name,
  maker: p.maker,
  paperWidth: p.paperWidth,
  dots: p.paperWidth === 58 ? 384 : 576,
  upsideDown: p.upsideDown,
  lan: p.lan,
});

export interface OfflineKitchenLine {
  /** 商品（「その他」は categoryId で持ち場を決める） */
  menuItemId: string | null;
  categoryId?: string | null;
  name: string;
  modifiers: { name: string; name_en?: string | null }[];
  memo: string | null;
  /** 正＝作る数、負＝取消 */
  delta: number;
  cancelReason?: string | null;
}

export interface OfflineKitchenInput {
  order: { id: string; orderNo: string; tableId: string | null; tableName: string | null; guestCount: number | null; clerkName: string | null };
  lines: OfflineKitchenLine[];
  printedAt: string;
}

/** 厨房伝票：プリンターごとの TicketDesign（振り分けは claim_kitchen_items と同じ） */
export function kitchenJobs(kit: NativeOfflineKit, input: OfflineKitchenInput): { printer: KitPrinter; designs: TicketDesign[]; buzzer: KitchenTicketBuzzer }[] {
  const floorId = input.order.tableId ? (kit.tableFloors[input.order.tableId] ?? null) : kit.kitchen.defaultFloorId;
  const byPrinter = new Map<string, { printer: OfflinePrinter; rows: ClaimedKitchenItem[] }>();
  for (const l of input.lines) {
    if (!l.delta) continue;
    const item = l.menuItemId ? kit.items[l.menuItemId] : undefined;
    const station = item?.station ?? (l.categoryId ? kit.categoryStations[l.categoryId] : undefined) ?? 'kitchen';
    const row: ClaimedKitchenItem = {
      order_id: input.order.id,
      order_no: input.order.orderNo,
      table_name: input.order.tableName,
      guest_count: input.order.guestCount,
      clerk_name: input.order.clerkName,
      item_name: l.name,
      item_name_en: item?.nameEn ?? null,
      item_name_kana: item?.kana ?? null,
      modifiers: l.modifiers,
      memo: l.memo,
      cancelReason: l.cancelReason ?? null,
      station,
      delta: l.delta,
    };
    for (const p of kitchenPrintersFor(kit.printers, station, floorId)) {
      const entry = byPrinter.get(p.id) ?? { printer: p, rows: [] };
      entry.rows.push(row);
      byPrinter.set(p.id, entry);
    }
  }
  const out: { printer: KitPrinter; designs: TicketDesign[]; buzzer: KitchenTicketBuzzer }[] = [];
  for (const { printer, rows } of byPrinter.values()) {
    const designs = kitchenDesigns({
      rows,
      stations: printer.stations,
      split: kit.kitchen.split,
      textSize: kit.kitchen.textSize,
      language: kit.kitchen.language,
      printedAt: input.printedAt,
    });
    if (designs.length) out.push({ printer: kitPrinter(printer), designs, buzzer: kit.kitchen.buzzer });
  }
  return out;
}

/** 取消会計伝票（レジ機へ）。店の名前・住所・登録番号は道具箱から */
export function cancelJob(
  kit: NativeOfflineKit,
  input: Omit<CancelBillData, 'storeName' | 'address' | 'phone' | 'registration'>
): { printer: KitPrinter; designs: TicketDesign[] } | null {
  const printer = receiptPrinterFor(kit.printers, kit.preferredReceiptPrinterId);
  if (!printer) return null;
  const design = cancelBillDesign({
    ...input,
    storeName: kit.store.name,
    address: kit.store.address,
    phone: kit.store.phone,
    registration: kit.store.registrationNumber,
  });
  return { printer: kitPrinter(printer), designs: [design] };
}

/** 会計伝票（その卓のフロアのプリンターへ） */
export function slipJob(kit: NativeOfflineKit, input: { slip: Omit<OrderSlipData, 'storeName'>; tableId: string | null }): { printer: KitPrinter; data: string } | null {
  const floorId = input.tableId ? (kit.tableFloors[input.tableId] ?? null) : null;
  const printer = slipPrinterFor(kit.printers, floorId, kit.preferredReceiptPrinterId);
  if (!printer) return null;
  return {
    printer: kitPrinter(printer),
    data: orderSlipBytes({ slip: { ...input.slip, storeName: kit.store.name }, maker: printer.maker, paperWidth: printer.paperWidth }),
  };
}

/**
 * レシート（レジ機へ）。drawer＝現金ならドロアも開ける（プリンターのドロア設定が ON のとき）。
 * print: 'auto'＝レジ機の「自動印刷」が ON のときだけ（会計のあと。サーバーの checkout と同じ）、true＝いつも（再発行）
 */
export function receiptJob(
  kit: NativeOfflineKit,
  input: { receipt: Omit<BuildReceiptInput, 'methodLabels' | 'store'>; drawer: boolean; print: boolean | 'auto' }
): { printer: KitPrinter; data: string } | null {
  const printer = receiptPrinterFor(kit.printers, kit.preferredReceiptPrinterId);
  if (!printer) return null;
  const parts: Buffer[] = [];
  if (input.drawer && printer.drawerKick) parts.push(Buffer.from(drawerBytes({ maker: printer.maker, command: printer.drawerCommand }), 'base64'));
  if (input.print === true || (input.print === 'auto' && printer.autoPrint)) {
    parts.push(
      Buffer.from(receiptBytes({ receipt: { ...input.receipt, store: kit.store }, maker: printer.maker, paperWidth: printer.paperWidth }), 'base64')
    );
  }
  if (!parts.length) return null;
  return { printer: kitPrinter(printer), data: toBase64(Buffer.concat(parts)) };
}

/** 伝票の合計（recalc_order_totals と同じ） */
export function totals(kit: NativeOfflineKit, input: { lines: OfflineTotalsLine[]; discount?: number }) {
  return offlineTotals(input.lines, kit.serviceChargeRate, input.discount ?? 0);
}

/** オフラインで入れる品の単価（addItem と同じ。at は ISO） */
export function unitPrice(kit: NativeOfflineKit, input: { menuItemId: string; optionExtra: number; at: string }) {
  return offlineUnitPrice(kit, input.menuItemId, input.optionExtra, new Date(input.at));
}

/** 道具箱のプリンターが、この iPad からオフラインで出せるか（LAN か Bluetooth） */
export function kitPrinters(kit: NativeOfflineKit): (KitPrinter & { usage: string })[] {
  return kit.printers.map((p) => ({ ...kitPrinter(p), usage: p.usage }));
}

/** JavaScriptCore から呼ぶ入口（引数・返り値は JSON 文字列。道具箱は setKit で1回入れておく） */
let currentKit: NativeOfflineKit | null = null;
const needKit = (): NativeOfflineKit => {
  if (!currentKit) throw new Error('offline kit not loaded');
  return currentKit;
};
const api = {
  version: PRINT_KIT_VERSION,
  setKit: (json: string) => {
    currentKit = JSON.parse(json) as NativeOfflineKit;
    return currentKit.version;
  },
  kitchenDesigns: (json: string) => JSON.stringify(kitchenDesigns(JSON.parse(json) as KitchenDesignInput)),
  cancelDesign: (json: string) => JSON.stringify(cancelDesign(JSON.parse(json) as CancelBillData)),
  receiptBytes: (json: string) => receiptBytes(JSON.parse(json)),
  orderSlipBytes: (json: string) => orderSlipBytes(JSON.parse(json)),
  drawerBytes: (json: string) => drawerBytes(JSON.parse(json)),
  rasterBytes: (json: string) => rasterBytes(JSON.parse(json)),
  buzzerBytes: (buzzer: string) => buzzerBytes(buzzer as KitchenTicketBuzzer),
  kitchenJobs: (json: string) => JSON.stringify(kitchenJobs(needKit(), JSON.parse(json))),
  cancelJob: (json: string) => JSON.stringify(cancelJob(needKit(), JSON.parse(json))),
  slipJob: (json: string) => JSON.stringify(slipJob(needKit(), JSON.parse(json))),
  receiptJob: (json: string) => JSON.stringify(receiptJob(needKit(), JSON.parse(json))),
  totals: (json: string) => JSON.stringify(totals(needKit(), JSON.parse(json))),
  unitPrice: (json: string) => JSON.stringify(unitPrice(needKit(), JSON.parse(json))),
  printers: () => JSON.stringify(kitPrinters(needKit())),
};

(globalThis as unknown as { TenpoPrintKit: typeof api }).TenpoPrintKit = api;
