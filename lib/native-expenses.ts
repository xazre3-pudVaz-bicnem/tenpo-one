import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの仕入・経費（2026-10-24 Ronnie「レジの画面は全部ネイティブに」）。
 * 読み込み GET ?part=expenses、操作 POST { type: 'expense…' }。
 * 中身は Web の /app/expenses と同じ Server Action（addExpense・createInvoice・approveExpense・rejectExpense・seedExpenseAccounts）。
 */
export const PAID_VIA = ['petty_cash', 'register', 'bank', 'personal'] as const;
export type NativePaidVia = (typeof PAID_VIA)[number];

export type NativeExpenseAction =
  | {
      type: 'expenseAdd';
      expenseAccountId: string;
      amount: number;
      taxAmount: number;
      paidVia: NativePaidVia;
      vendorName: string;
      memo: string;
      businessDate: string;
    }
  | { type: 'expenseBill'; vendorId: string | null; vendorName: string; amount: number; date: string; memo: string | null }
  | { type: 'expenseApprove'; id: string }
  | { type: 'expenseReject'; id: string; reason: string }
  | { type: 'expenseSeed' };

export type NativeExpenseActionType = NativeExpenseAction['type'];
export const NATIVE_EXPENSE_ACTION_TYPES: readonly NativeExpenseActionType[] = ['expenseAdd', 'expenseBill', 'expenseApprove', 'expenseReject', 'expenseSeed'];

export function isNativeExpenseActionType(v: unknown): v is NativeExpenseActionType {
  return typeof v === 'string' && (NATIVE_EXPENSE_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeExpenseAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, min: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 1_000_000_000;

export function parseNativeExpenseAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'expenseAdd':
      if (!isUuid(b.expenseAccountId)) return bad('勘定科目を選択してください');
      if (!int(b.amount, 1)) return bad('金額は1円以上の整数で入力してください');
      if (!int(b.taxAmount ?? 0, 0)) return bad('税額は0以上の整数で入力してください');
      if (!(PAID_VIA as readonly unknown[]).includes(b.paidVia)) return bad('支払元を選んでください');
      if (typeof b.businessDate !== 'string' || !DATE.test(b.businessDate)) return bad('営業日を入力してください');
      return {
        ok: true,
        action: {
          type: 'expenseAdd',
          expenseAccountId: b.expenseAccountId as string,
          amount: b.amount as number,
          taxAmount: (b.taxAmount as number | undefined) ?? 0,
          paidVia: b.paidVia as NativePaidVia,
          vendorName: str(b.vendorName, 120),
          memo: str(b.memo, 500),
          businessDate: b.businessDate,
        },
      };
    case 'expenseBill': {
      const vendorName = str(b.vendorName, 120);
      if (!vendorName) return bad('仕入先を選ぶか、名前を入れてください');
      if (!int(b.amount, 1)) return bad('金額は1円以上の整数で入力してください');
      if (typeof b.date !== 'string' || !DATE.test(b.date)) return bad('日付を入力してください');
      const vendorId = b.vendorId == null || b.vendorId === '' ? null : isUuid(b.vendorId) ? (b.vendorId as string) : undefined;
      if (vendorId === undefined) return bad();
      return { ok: true, action: { type: 'expenseBill', vendorId, vendorName, amount: b.amount as number, date: b.date, memo: str(b.memo, 500) || null } };
    }
    case 'expenseApprove':
      if (!isUuid(b.id)) return bad();
      return { ok: true, action: { type: 'expenseApprove', id: b.id as string } };
    case 'expenseReject': {
      if (!isUuid(b.id)) return bad();
      const reason = str(b.reason, 300);
      if (!reason) return bad('差戻し理由を入力してください');
      return { ok: true, action: { type: 'expenseReject', id: b.id as string, reason } };
    }
    case 'expenseSeed':
      return { ok: true, action: { type: 'expenseSeed' } };
    default:
      return bad();
  }
}
