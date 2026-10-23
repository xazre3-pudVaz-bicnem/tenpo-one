import { isUuid } from '@/lib/native-pos';
import { QUICK_PAY_MAX_QUANTITY, quickPayProblem, type QuickPayDiscount, type QuickPayLine } from '@/lib/quick-pay';

/**
 * iPad アプリのネイティブの即会計（2026-10-24 Ronnie「レジの画面は全部ネイティブに」）。
 * 読み込みは GET /api/app/v1/pos?part=quick[&order=…]、操作は POST { type: 'quick…' }。
 * 中身は Web の即会計（app/app/quick-pay/actions.ts・startTakeout）と同じ。ここは純粋な型と検証だけ。
 */
export type NativeQuickAction =
  /** メニュー選択：即会計の伝票を作る（ネイティブの注文画面で開く） */
  | { type: 'quickStart'; guestCount: number }
  /** 会計する：電卓の行を伝票に入れて（無ければ作って）会計へ */
  | { type: 'quickCheckout'; orderId: string | null; guestCount: number; lines: QuickPayLine[]; discount: QuickPayDiscount | null }
  /** テイクアウトの伝票を作る */
  | { type: 'quickTakeout' };

export type NativeQuickActionType = NativeQuickAction['type'];
export const NATIVE_QUICK_ACTION_TYPES: readonly NativeQuickActionType[] = ['quickStart', 'quickCheckout', 'quickTakeout'];

export function isNativeQuickActionType(v: unknown): v is NativeQuickActionType {
  return typeof v === 'string' && (NATIVE_QUICK_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeQuickAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });
const guestsOf = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999 ? v : 1);

export function parseNativeQuickAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'quickStart':
      return { ok: true, action: { type: 'quickStart', guestCount: guestsOf(b.guestCount) } };
    case 'quickTakeout':
      return { ok: true, action: { type: 'quickTakeout' } };
    case 'quickCheckout': {
      const orderId = b.orderId == null || b.orderId === '' ? null : isUuid(b.orderId) ? (b.orderId as string) : undefined;
      if (orderId === undefined) return bad();
      if (!Array.isArray(b.lines)) return bad();
      const lines: QuickPayLine[] = b.lines.map((l) => ({
        amount: Number((l as Record<string, unknown>)?.amount),
        quantity: Number((l as Record<string, unknown>)?.quantity),
      }));
      const problem = quickPayProblem(lines);
      if (problem) return bad(problem);
      if (!orderId && lines.length === 0) return bad('金額を入れてください');
      let discount: QuickPayDiscount | null = null;
      const d = b.discount as Record<string, unknown> | null | undefined;
      if (d && (d.kind === 'yen' || d.kind === 'percent')) {
        const v = Number(d.value);
        if (!Number.isInteger(v) || v <= 0 || (d.kind === 'percent' && v > 100)) return bad('割引は 1〜100% で入れてください');
        discount = { kind: d.kind, value: v };
      }
      return { ok: true, action: { type: 'quickCheckout', orderId, guestCount: guestsOf(b.guestCount), lines, discount } };
    }
    default:
      return bad();
  }
}

export { QUICK_PAY_MAX_QUANTITY };
