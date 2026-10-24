/**
 * レジの iPad がネット無しで動くための「オフラインの道具箱」（2026-10-24 Ronnie「net nachale pani print haru sabai kam、
 * net chalepaxi afai sync」）。iPad はネットのあるときに GET part=offlineKit でこれを受け取って保存し、
 * オフラインのときは、これと印字キット（lib/print-kit.ts → /print-kit.js）だけで
 *   値段・合計の計算 → 厨房伝票・会計伝票・レシート・取消伝票の印字（LAN 9100 / Bluetooth）
 * をする。ここは純粋な関数と型だけ（DB・Next・Node 非依存。印字キットにも入る）。
 *
 * 振り分け・合計は、サーバー（SQL の claim_kitchen_items・recalc_order_totals、print-actions の getCloudPrntPrinter）と
 * 同じ決まりにしてある。サーバーを変えたらここも合わせる（tests/native-offline-kit.test.ts）。
 */
import { dynamicUnitPrice, type DynamicPriceRule } from './dynamic-pricing';
import { pickDefaultPrinter, pickPrinterForFloor } from './printer-floors';
import type { KitchenTicketSettings } from './kitchen-ticket';

export type OfflineMaker = 'star' | 'escpos';

export interface OfflinePrinter {
  id: string;
  name: string;
  /** receipt（レジ）/ kitchen（厨房・ドリンク）/ そのほか */
  usage: string;
  /** 印字の言葉（Star は StarPRNT、それ以外は ESC/POS） */
  maker: OfflineMaker;
  paperWidth: 58 | 80;
  /** 厨房機の持ち場（kitchen / drink …） */
  stations: string[];
  /** 担当フロア（空＝既定） */
  floorIds: string[];
  upsideDown: boolean;
  /** 厨房（ドリンク）機から会計伝票も出す */
  billSlips: boolean;
  /** レジ機：会計のあとレシートを自動で出す */
  autoPrint: boolean;
  drawerKick: boolean;
  drawerCommand: string | null;
  /** お店の LAN のアドレス（iPad から 9100 番で直接送れる）。無ければ null（Bluetooth でつないでいれば出せる） */
  lan: { host: string; port: number } | null;
}

export interface OfflineKitItem {
  categoryId: string | null;
  /** 厨房の持ち場（カテゴリの station。無ければ kitchen） */
  station: string;
  /** 設定の英語名（厨房伝票の英語） */
  nameEn: string | null;
  kana: string | null;
  itemType: string;
  /** 店内の値段（ダイナミックプライシング前） */
  price: number;
  taxRate: number;
  taxIncluded: boolean;
}

export interface NativeOfflineKit {
  /** 中身のハッシュ（変わったら iPad が入れ替える） */
  version: string;
  storeId: string;
  store: {
    name: string;
    address: string | null;
    phone: string | null;
    registrationNumber: string | null;
    headerMessage: string | null;
    footerMessage: string | null;
  };
  /** サービス料（％。0 なら無し） */
  serviceChargeRate: number;
  kitchen: KitchenTicketSettings & {
    /** 卓なしの伝票の扱いにするフロア（設定 > テーブル・フロア の最初に出すフロア） */
    defaultFloorId: string | null;
  };
  drawer: { autoOpenOnCash: boolean; openOnCashless: boolean };
  /** プリンター（登録の古い順。振り分けの「最初の1台」に使う） */
  printers: OfflinePrinter[];
  /** この iPad で選んだレシート機（Web の「このiPadのプリンター」） */
  preferredReceiptPrinterId: string | null;
  items: Record<string, OfflineKitItem>;
  /** カテゴリの持ち場（「その他（金額入力）」の行に使う） */
  categoryStations: Record<string, string>;
  /** 卓 → フロア（厨房機・会計伝票の振り分け） */
  tableFloors: Record<string, string | null>;
  dynamicRules: DynamicPriceRule[];
}

/**
 * 厨房機の振り分け（SQL の claim_kitchen_items と同じ）。
 * floorId は卓のフロア。卓なし（即会計）は defaultFloorId を渡す。
 */
export function kitchenPrintersFor(printers: readonly OfflinePrinter[], station: string, floorId: string | null): OfflinePrinter[] {
  const kitchen = printers.filter((p) => p.usage === 'kitchen');
  const hasStation = (p: OfflinePrinter) => p.stations.includes(station);
  const picked = kitchen.filter((p) => {
    if (!hasStation(p)) return false;
    if (p.floorIds.length > 0) return !!floorId && p.floorIds.includes(floorId);
    if (!floorId) return true;
    return !kitchen.some((o) => o.id !== p.id && hasStation(o) && o.floorIds.includes(floorId));
  });
  if (picked.length > 0) return picked;
  // どのプリンターにも当たらない（全部フロア指定で、そのフロアの機械が無い）→ その持ち場で最初に登録した1台
  const first = kitchen.find(hasStation);
  return first ? [first] : [];
}

/** レシート・ドロアのプリンター（この iPad で選んだ機械 → 担当フロアの無いレジ機 → 先頭） */
export function receiptPrinterFor(printers: readonly OfflinePrinter[], preferredId: string | null): OfflinePrinter | null {
  const rows = printers.filter((p) => p.usage === 'receipt');
  return (preferredId ? rows.find((p) => p.id === preferredId) : undefined) ?? pickDefaultPrinter(rows);
}

/** 会計伝票のプリンター（選んだ機械 → その卓のフロア担当 → 既定。レジ機と「会計伝票も出す」厨房機から） */
export function slipPrinterFor(printers: readonly OfflinePrinter[], floorId: string | null, preferredId: string | null): OfflinePrinter | null {
  const rows = printers
    .filter((p) => p.usage === 'receipt' || p.billSlips)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Number(b.p.usage === 'receipt') - Number(a.p.usage === 'receipt') || a.i - b.i)
    .map((x) => x.p);
  return (preferredId ? rows.find((p) => p.id === preferredId) : undefined) ?? pickPrinterForFloor(rows, floorId);
}

export interface OfflineTotalsLine {
  lineTotal: number;
  taxRate: number;
  taxIncluded: boolean;
}

export interface OfflineTotals {
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  total: number;
}

/** 伝票の合計（SQL の recalc_order_totals と同じ：内税は gross − floor(gross / (1+率))、外税は floor(額×率)、サービス料は floor(税込×率)） */
export function offlineTotals(lines: readonly OfflineTotalsLine[], serviceChargeRate: number, discount = 0, rounding = 0): OfflineTotals {
  let gross = 0;
  let tax = 0;
  for (const l of lines) {
    let g = Math.round(l.lineTotal);
    let t: number;
    if (l.taxIncluded) {
      t = g - Math.floor((g * 100) / (100 + l.taxRate));
    } else {
      t = Math.floor((g * l.taxRate) / 100);
      g += t;
    }
    gross += g;
    tax += t;
  }
  const service = serviceChargeRate > 0 ? Math.floor((gross * serviceChargeRate) / 100) : 0;
  return { subtotal: gross - tax, taxTotal: tax, serviceCharge: service, total: Math.max(0, gross + service - discount + rounding) };
}

/** オフラインで入れる品の単価（店内の値段にダイナミックプライシング、選択肢の追加料金を足す。addItem と同じ） */
export function offlineUnitPrice(kit: Pick<NativeOfflineKit, 'items' | 'dynamicRules'>, menuItemId: string, optionExtra: number, at: Date): number | null {
  const item = kit.items[menuItemId];
  if (!item) return null;
  const base = kit.dynamicRules.length
    ? dynamicUnitPrice(kit.dynamicRules, { id: menuItemId, categoryId: item.categoryId, itemType: item.itemType }, item.price, at).price
    : item.price;
  return base + optionExtra;
}
