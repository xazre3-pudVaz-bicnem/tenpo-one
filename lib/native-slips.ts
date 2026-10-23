import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの伝票明細（2026-10-24 Ronnie「レジの画面は全部ネイティブに」）。
 * 読み込み GET ?part=slips（一覧）／ ?part=slip&id=…（詳細）。操作 POST { type: 'slip…' }。
 * 中身は Web の伝票明細（app/app/orders）と同じ Server Action（refundOrder・reopenOrder・enqueueReceiptPrint）。
 */
export const REFUND_METHODS = ['cash', 'credit', 'qr', 'emoney', 'voucher', 'on_account', 'other'] as const;
export type NativeRefundMethod = (typeof REFUND_METHODS)[number];

export type NativeSlipAction =
  /** 返金・取消（VOID）。items があれば商品単位返金 */
  | {
      type: 'slipRefund';
      orderId: string;
      amount: number;
      method: NativeRefundMethod;
      reason: string;
      kind: 'refund' | 'void';
      items: { orderItemId: string; quantity: number; amount: number; restock: boolean }[] | null;
    }
  /** 再会計（全額返金済みの伝票を複製して開く） */
  | { type: 'slipReopen'; orderId: string; reason: string }
  /** 領収書（宛名・但し書き・分割）。一度きり */
  | { type: 'slipRyoshusho'; orderId: string; recipientName: string | null; purpose: string | null; splitAmounts: number[] | null }
  /** レシートの再発行 */
  | { type: 'slipReceipt'; orderId: string };

export type NativeSlipActionType = NativeSlipAction['type'];
export const NATIVE_SLIP_ACTION_TYPES: readonly NativeSlipActionType[] = ['slipRefund', 'slipReopen', 'slipRyoshusho', 'slipReceipt'];

export function isNativeSlipActionType(v: unknown): v is NativeSlipActionType {
  return typeof v === 'string' && (NATIVE_SLIP_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeSlipAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });
const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};
const posInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 100_000_000;

export function parseNativeSlipAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  if (!isUuid(b.orderId)) return bad('伝票が正しくありません');
  const orderId = b.orderId as string;
  switch (b.type) {
    case 'slipRefund': {
      if (!posInt(b.amount)) return bad('返金額は1円以上で入力してください');
      if (!(REFUND_METHODS as readonly unknown[]).includes(b.method)) return bad('返金方法を選んでください');
      const reason = str(b.reason, 200);
      if (!reason) return bad('返金理由を入力してください');
      const kind = b.kind === 'void' ? 'void' : 'refund';
      let items: NonNullable<Extract<NativeSlipAction, { type: 'slipRefund' }>['items']> | null = null;
      if (Array.isArray(b.items) && b.items.length > 0) {
        items = [];
        for (const raw of b.items) {
          const it = raw as Record<string, unknown>;
          if (!isUuid(it.orderItemId) || typeof it.quantity !== 'number' || !(it.quantity > 0) || !posInt(it.amount)) return bad('選んだ品目を確かめてください');
          items.push({ orderItemId: it.orderItemId as string, quantity: it.quantity, amount: it.amount as number, restock: it.restock === true });
        }
      }
      return { ok: true, action: { type: 'slipRefund', orderId, amount: b.amount as number, method: b.method as NativeRefundMethod, reason, kind, items } };
    }
    case 'slipReopen': {
      const reason = str(b.reason, 200);
      if (!reason) return bad('再会計理由を入力してください');
      return { ok: true, action: { type: 'slipReopen', orderId, reason } };
    }
    case 'slipRyoshusho': {
      let split: number[] | null = null;
      if (Array.isArray(b.splitAmounts) && b.splitAmounts.length > 1) {
        if (b.splitAmounts.length > 20 || !b.splitAmounts.every(posInt)) return bad('分ける金額を確かめてください');
        split = b.splitAmounts as number[];
      }
      return { ok: true, action: { type: 'slipRyoshusho', orderId, recipientName: str(b.recipientName, 60), purpose: str(b.purpose, 60), splitAmounts: split } };
    }
    case 'slipReceipt':
      return { ok: true, action: { type: 'slipReceipt', orderId } };
    default:
      return bad();
  }
}
