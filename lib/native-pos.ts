/**
 * iPad アプリのネイティブ画面（オーダー・会計）とサーバーの決まりごと（2026-10-13 Ronnie「Airレジのように全部ネイティブ。
 * まずネットがある時に Airレジと同じように」）。
 *
 * - アプリは Web と同じログイン（Cookie）で /api/app/v1/pos を呼ぶ。
 * - 金額の計算・在庫・厨房伝票・会計は Web と同じサーバーの処理（app/app/pos/actions.ts）をそのまま使う（二重に計算しない）。
 * - 他のサイトから勝手に呼ばれないよう、アプリは必ず `x-tenpo-app: 1` を付ける（付いていない POST は受け付けない）。
 *
 * ここは純粋な型と検証だけ（DB・Next 非依存・テスト対象）。
 */

export const NATIVE_APP_HEADER = 'x-tenpo-app';

/** おすすめ・売れ筋のタブ（Web のレジと同じ id） */
export const NATIVE_FAVORITES_TAB = '__favorites__';
export const NATIVE_BESTSELLERS_TAB = '__bestsellers__';

export interface NativePosCategory {
  id: string;
  name: string;
  sub: string | null;
}

export interface NativePosItem {
  id: string;
  categoryId: string | null;
  name: string;
  kana: string | null;
  english: string | null;
  /** 税込の表示価格（テイクアウトの伝票はテイクアウト価格） */
  price: number;
  soldOut: boolean;
  recommended: boolean;
  /** 売れ筋の順位（0 が1位）。売れ筋でなければ null */
  bestRank: number | null;
  /** 選択肢（トッピング等）がある。最初の版はアプリから Web の画面で入れる */
  hasOptions: boolean;
  /** 金額をレジで打つ商品（¥0 の商品）。最初の版は Web の画面で入れる */
  openPrice: boolean;
}

export interface NativePosLine {
  id: string;
  menuItemId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** 厨房へ送信済み */
  sent: boolean;
}

export interface NativePosOrder {
  id: string;
  orderNo: number;
  orderType: string;
  tableName: string | null;
  guestCount: number;
  clerkId: string | null;
  customerName: string | null;
  seatFrom: string | null;
  seatTo: string | null;
  /** 来店経路（lib/handy-visit.ts の VISIT_SOURCES の id） */
  visitSourceId: string | null;
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountTotal: number;
  discountReason: string | null;
  total: number;
  lines: NativePosLine[];
}

export interface NativePosBrand {
  id: string;
  name: string;
}

export interface NativePosPayload {
  ok: true;
  store: { id: string; name: string };
  order: NativePosOrder;
  categories: NativePosCategory[];
  items: NativePosItem[];
  clerks: { id: string; name: string }[];
  /** 担当者が登録されている店では、注文確定・会計に担当者が必要 */
  clerkRequired: boolean;
  visitSources: { id: string; label: string }[];
  methodBrands: Record<string, NativePosBrand[]>;
  pointBrands: NativePosBrand[];
  discountPresets: { id: string; name: string; kind: 'percent' | 'amount' | 'manual'; value: number }[];
  steraTerminals: { id: string; name: string; online: boolean }[];
  steraPaymentTypes: { code: string; method: string; label: string }[];
  registerOpen: boolean;
  canCheckout: boolean;
  canDiscount: boolean;
}

/** 会計の支払い（app/app/pos/actions.ts の CheckoutPayment と同じ） */
export const NATIVE_PAY_METHODS = ['cash', 'credit', 'qr', 'emoney', 'points', 'site_points', 'external', 'other'] as const;
export type NativePayMethod = (typeof NATIVE_PAY_METHODS)[number];

export type NativePosAction =
  | { type: 'send'; orderId: string; lines: { menuItemId: string; quantity: number; optionItemIds: string[] }[] }
  | { type: 'qty'; orderId: string; lineId: string; delta: 1 | -1 }
  | { type: 'clerk'; orderId: string; clerkId: string | null }
  | { type: 'discount'; orderId: string; amount: number; reason: string }
  | {
      type: 'checkout';
      orderId: string;
      payments: { method: NativePayMethod; amount: number; tendered?: number; provider?: string | null }[];
      memo: string;
    }
  | { type: 'visitSource'; orderId: string; sourceId: string | null }
  | { type: 'steraStart'; orderId: string; terminalId: string; paymentType: string }
  | { type: 'steraCheck'; requestId: string }
  | { type: 'steraCancel'; requestId: string }
  /** 会計のあとドロアを開く（店の設定：現金は開く・キャッシュレスは設定しだい。Web のレジと同じ） */
  | { type: 'drawer'; orderId: string; methods: NativePayMethod[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** 金額の上限（1会計 1,000万円まで） */
const MAX_YEN = 10_000_000;
const isYen = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_YEN;

const SOURCE_ID = /^[a-z_]{1,24}$/;
const BRAND_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const STERA_TYPE = /^\d{2}(-\d{2})?$/;

type Parsed = { ok: true; action: NativePosAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

/** アプリから来た操作を確かめる（知らない形・範囲外の値は受け付けない） */
export function parseNativePosAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'send': {
      if (!isUuid(b.orderId) || !Array.isArray(b.lines) || b.lines.length > 100) return bad();
      const lines: { menuItemId: string; quantity: number; optionItemIds: string[] }[] = [];
      for (const l of b.lines as unknown[]) {
        if (!l || typeof l !== 'object') return bad();
        const r = l as Record<string, unknown>;
        const q = r.quantity;
        const opts = r.optionItemIds ?? [];
        if (!isUuid(r.menuItemId) || typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 99) return bad();
        if (!Array.isArray(opts) || opts.length > 30 || !opts.every(isUuid)) return bad();
        lines.push({ menuItemId: r.menuItemId, quantity: q, optionItemIds: opts as string[] });
      }
      return { ok: true, action: { type: 'send', orderId: b.orderId, lines } };
    }
    case 'qty':
      if (!isUuid(b.orderId) || !isUuid(b.lineId) || (b.delta !== 1 && b.delta !== -1)) return bad();
      return { ok: true, action: { type: 'qty', orderId: b.orderId, lineId: b.lineId, delta: b.delta } };
    case 'clerk':
      if (!isUuid(b.orderId) || !(b.clerkId === null || isUuid(b.clerkId))) return bad();
      return { ok: true, action: { type: 'clerk', orderId: b.orderId, clerkId: b.clerkId as string | null } };
    case 'discount': {
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 60) : '';
      if (!isUuid(b.orderId) || !isYen(b.amount)) return bad();
      if (b.amount > 0 && !reason) return bad('値引きの理由を入れてください');
      return { ok: true, action: { type: 'discount', orderId: b.orderId, amount: b.amount, reason } };
    }
    case 'checkout': {
      if (!isUuid(b.orderId) || !Array.isArray(b.payments) || b.payments.length > 10) return bad();
      const payments: { method: NativePayMethod; amount: number; tendered?: number; provider?: string | null }[] = [];
      for (const p of b.payments as unknown[]) {
        if (!p || typeof p !== 'object') return bad();
        const r = p as Record<string, unknown>;
        if (!(NATIVE_PAY_METHODS as readonly unknown[]).includes(r.method) || !isYen(r.amount)) return bad();
        if (r.tendered !== undefined && !isYen(r.tendered)) return bad();
        if (r.provider != null && (typeof r.provider !== 'string' || r.provider.length > 40)) return bad();
        payments.push({
          method: r.method as NativePayMethod,
          amount: r.amount,
          ...(r.tendered !== undefined ? { tendered: r.tendered as number } : {}),
          provider: (r.provider as string | null | undefined) ?? null,
        });
      }
      const memo = typeof b.memo === 'string' ? b.memo.slice(0, 200) : '';
      return { ok: true, action: { type: 'checkout', orderId: b.orderId, payments, memo } };
    }
    case 'visitSource':
      if (!isUuid(b.orderId) || !(b.sourceId === null || (typeof b.sourceId === 'string' && SOURCE_ID.test(b.sourceId)))) return bad();
      return { ok: true, action: { type: 'visitSource', orderId: b.orderId, sourceId: b.sourceId as string | null } };
    case 'steraStart':
      if (!isUuid(b.orderId) || !isUuid(b.terminalId) || typeof b.paymentType !== 'string' || !STERA_TYPE.test(b.paymentType)) return bad();
      return { ok: true, action: { type: 'steraStart', orderId: b.orderId, terminalId: b.terminalId, paymentType: b.paymentType } };
    case 'drawer': {
      if (!isUuid(b.orderId) || !Array.isArray(b.methods) || b.methods.length > 10) return bad();
      if (!b.methods.every((m) => (NATIVE_PAY_METHODS as readonly unknown[]).includes(m))) return bad();
      return { ok: true, action: { type: 'drawer', orderId: b.orderId, methods: b.methods as NativePayMethod[] } };
    }
    case 'steraCheck':
    case 'steraCancel':
      if (!isUuid(b.requestId)) return bad();
      return { ok: true, action: { type: b.type, requestId: b.requestId } };
    default:
      return bad();
  }
}

/** 支払方法の内訳の id（VISA → visa のような保存用の記号）として使えるか */
export function isBrandId(v: unknown): v is string {
  return typeof v === 'string' && BRAND_ID.test(v);
}

/** 'HH:MM'（日本時間） */
export function jstHm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}
