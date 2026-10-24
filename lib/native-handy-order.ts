import { isUuid } from '@/lib/native-pos';
import { HANDY_EXTEND_OPTIONS } from '@/lib/handy-cancel';

/**
 * iPhone アプリのネイティブのハンディ：卓の画面と注文の画面（2026-10-25 01:38 Ronnie「iPhone も native に」）。
 *   GET  ?part=handyTable&tableId=  … 卓の伝票・明細・呼び出し（Web の /handy/[tableId] と同じ中身）
 *   GET  ?part=handyMenu&orderId=   … 注文の画面のメニュー（Web の /handy/[tableId]/order と同じ loadHandyMenu）
 *   POST handyOpenOrder / handySubmit / handyGuests / handyExtend / handyCancelItem / handyPrintBill
 * 中身は Web のハンディと同じ Server Action（app/app/handy/actions.ts）。ここは入力の確認だけ（DB・Next 非依存・テスト対象）。
 */

export const HANDY_MAX_LINES = 50;
export const HANDY_MAX_QTY = 20; // components/handy/logic.ts の MAX_LINE_QUANTITY と同じ
const MAX_MEMO = 100;
const MAX_PRICE = 9_999_999;

export interface NativeHandyLine {
  menuItemId: string;
  optionItemIds: string[];
  quantity: number;
  name: string;
  openPrice: number | null;
  memo: string | null;
  custom?: { categoryId: string | null; price: number; memo: string | null };
}

export type NativeHandyOrderAction =
  | { type: 'handyOpenOrder'; tableId: string }
  | { type: 'handySubmit'; orderId: string; lines: NativeHandyLine[] }
  | { type: 'handyGuests'; orderId: string; guestCount: number }
  | { type: 'handyExtend'; orderId: string; minutes: number }
  | { type: 'handyCancelItem'; orderId: string; orderItemId: string }
  | { type: 'handyPrintBill'; orderId: string };

export const NATIVE_HANDY_ORDER_TYPES = ['handyOpenOrder', 'handySubmit', 'handyGuests', 'handyExtend', 'handyCancelItem', 'handyPrintBill'] as const;

type Parsed = { ok: true; action: NativeHandyOrderAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t ? t : null;
}

/** カートの 1 行。おかしければ null */
export function parseHandyLine(raw: unknown): NativeHandyLine | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const quantity = r.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > HANDY_MAX_QTY) return null;
  const name = text(r.name, 80) ?? '商品';
  if (r.custom && typeof r.custom === 'object') {
    const c = r.custom as Record<string, unknown>;
    const price = c.price;
    if (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > MAX_PRICE) return null;
    const categoryId = c.categoryId == null ? null : isUuid(c.categoryId) ? c.categoryId : undefined;
    if (categoryId === undefined) return null;
    // 「その他」の行の menuItemId はカートの仮の id（サーバーでは使わない）
    const menuItemId = typeof r.menuItemId === 'string' && r.menuItemId ? r.menuItemId.slice(0, 64) : 'custom';
    return { menuItemId, optionItemIds: [], quantity, name, openPrice: null, memo: null, custom: { categoryId, price, memo: text(c.memo, MAX_MEMO) } };
  }
  if (!isUuid(r.menuItemId)) return null;
  const opts = Array.isArray(r.optionItemIds) ? r.optionItemIds : [];
  if (opts.length > 30 || !opts.every((o) => isUuid(o))) return null;
  let openPrice: number | null = null;
  if (r.openPrice != null) {
    if (typeof r.openPrice !== 'number' || !Number.isInteger(r.openPrice) || r.openPrice < 0 || r.openPrice > MAX_PRICE) return null;
    openPrice = r.openPrice;
  }
  return { menuItemId: r.menuItemId, optionItemIds: opts as string[], quantity, name, openPrice, memo: text(r.memo, MAX_MEMO) };
}

export function parseNativeHandyOrderAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'handyOpenOrder':
      if (!isUuid(b.tableId)) return bad('卓の指定が正しくありません');
      return { ok: true, action: { type: 'handyOpenOrder', tableId: b.tableId } };
    case 'handySubmit': {
      if (!isUuid(b.orderId)) return bad('伝票の指定が正しくありません');
      if (!Array.isArray(b.lines) || b.lines.length === 0) return bad('注文する商品がありません');
      if (b.lines.length > HANDY_MAX_LINES) return bad(`一度に送信できる商品は${HANDY_MAX_LINES}種類までです`);
      const lines: NativeHandyLine[] = [];
      for (const l of b.lines) {
        const line = parseHandyLine(l);
        if (!line) return bad('商品の指定が正しくありません');
        lines.push(line);
      }
      return { ok: true, action: { type: 'handySubmit', orderId: b.orderId, lines } };
    }
    case 'handyGuests': {
      const n = b.guestCount;
      if (!isUuid(b.orderId)) return bad('伝票の指定が正しくありません');
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 999) return bad('人数は1〜999で入力してください');
      return { ok: true, action: { type: 'handyGuests', orderId: b.orderId, guestCount: n } };
    }
    case 'handyExtend': {
      const m = b.minutes;
      if (!isUuid(b.orderId)) return bad('伝票の指定が正しくありません');
      if (typeof m !== 'number' || !(HANDY_EXTEND_OPTIONS as readonly number[]).includes(m)) return bad('延長は30〜120分で選んでください');
      return { ok: true, action: { type: 'handyExtend', orderId: b.orderId, minutes: m } };
    }
    case 'handyCancelItem':
      if (!isUuid(b.orderId) || !isUuid(b.orderItemId)) return bad('品目の指定が正しくありません');
      return { ok: true, action: { type: 'handyCancelItem', orderId: b.orderId, orderItemId: b.orderItemId } };
    case 'handyPrintBill':
      if (!isUuid(b.orderId)) return bad('伝票の指定が正しくありません');
      return { ok: true, action: { type: 'handyPrintBill', orderId: b.orderId } };
    default:
      return bad();
  }
}

/** order_items.modifiers（[{name, price}]）から「大盛り・チーズ」 */
export function handyModifierLabel(modifiers: unknown): string | null {
  if (!Array.isArray(modifiers) || modifiers.length === 0) return null;
  const names = modifiers
    .map((m) => (m && typeof m === 'object' && 'name' in m ? String((m as { name: unknown }).name) : ''))
    .filter(Boolean);
  return names.length > 0 ? names.join('・') : null;
}
