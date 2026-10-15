/**
 * 金額計算（円単位の整数のみ扱う）。浮動小数の金額を作らないこと。
 */

export type RoundingMode = 'floor' | 'ceil' | 'round';

export function roundYen(value: number, mode: RoundingMode = 'floor'): number {
  switch (mode) {
    case 'ceil':
      return Math.ceil(value);
    case 'round':
      return Math.round(value);
    default:
      return Math.floor(value);
  }
}

/**
 * 税込金額から内税額を求める（税額 = 税込 - floor(税込×100 / (100+率))）。
 * 1100/1.1 のような浮動小数の誤差を避けるため整数演算で計算する。
 */
export function taxFromInclusive(grossYen: number, ratePercent: number): number {
  if (!Number.isInteger(grossYen)) throw new Error('金額は整数（円）で指定してください');
  return grossYen - Math.floor((grossYen * 100) / (100 + ratePercent));
}

/** 税抜金額に対する外税額 */
export function taxFromExclusive(netYen: number, ratePercent: number): number {
  if (!Number.isInteger(netYen)) throw new Error('金額は整数（円）で指定してください');
  return Math.floor((netYen * ratePercent) / 100);
}

export interface OrderLine {
  unitPrice: number;
  quantity: number;
  taxRate: number; // 10 or 8
  taxIncluded: boolean;
  modifiersTotal?: number; // 1個あたりのオプション追加額
}

export interface OrderTotals {
  /** 税込商品合計（値引き前） */
  grossItems: number;
  /** 税抜合計 */
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discount: number;
  total: number;
}

/**
 * 注文合計の計算。supabase/migrations/00002 の recalc_order_totals と同一ロジック。
 * 変更時は必ず両方を更新し、tests/money.test.ts を通すこと。
 */
export function calcOrderTotals(
  lines: OrderLine[],
  opts: { discount?: number; serviceChargeRate?: number; rounding?: RoundingMode } = {}
): OrderTotals {
  let gross = 0;
  let tax = 0;
  for (const line of lines) {
    const lineBase = (line.unitPrice + (line.modifiersTotal ?? 0)) * line.quantity;
    if (line.taxIncluded) {
      gross += lineBase;
      tax += taxFromInclusive(lineBase, line.taxRate);
    } else {
      const lineTax = taxFromExclusive(lineBase, line.taxRate);
      gross += lineBase + lineTax;
      tax += lineTax;
    }
  }
  const serviceCharge =
    opts.serviceChargeRate && opts.serviceChargeRate > 0
      ? roundYen((gross * opts.serviceChargeRate) / 100, opts.rounding ?? 'floor')
      : 0;
  const discount = Math.min(opts.discount ?? 0, gross + serviceCharge);
  const total = Math.max(0, gross + serviceCharge - discount);
  return { grossItems: gross, subtotal: gross - tax, taxTotal: tax, serviceCharge, discount, total };
}

/** 支払リストの合計が請求額と一致するか */
export function validatePayments(total: number, payments: { amount: number }[]): boolean {
  const sum = payments.reduce((acc, p) => acc + p.amount, 0);
  return sum === total && payments.every((p) => Number.isInteger(p.amount) && p.amount > 0);
}

/** 現金お釣り計算 */
export function calcChange(amountDue: number, tendered: number): number {
  return Math.max(0, tendered - amountDue);
}

/**
 * 現金で払う額＝お預かりと残り（この現金で払うべき額）の小さいほう。
 * お預かりが足りなければ、払えたのはお預かりの分だけ（残りは残額として残り、会計完了は押せない）。
 * 2026-10-14 宮崎さん（御茶ノ水）「お会計のときに金額が足りなくても会計ができてしまう」
 * （お預かり ¥1,080 で ¥5,280 の会計が完了し、おつり ¥0 になった）
 */
export function cashPaidAmount(tendered: number, due: number): number {
  const t = Number.isFinite(tendered) ? Math.max(0, Math.floor(tendered)) : 0;
  const d = Number.isFinite(due) ? Math.max(0, Math.floor(due)) : 0;
  return Math.min(t, d);
}

/** 現金のお預かりが、その現金で払う額に足りているか（お預かりを入れていない行は「ちょうど」とみなす） */
export function isCashCovered(p: { method: string; amount: number; tendered?: number | null }): boolean {
  if (p.method !== 'cash') return true;
  if (p.tendered == null) return true;
  return p.tendered >= p.amount;
}
