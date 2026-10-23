import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの「小口現金」「締め履歴」タブ（Web の /app/cash?tab=petty / tab=closings と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=petty / part=closings、操作は POST { type: 'petty…' | 'closing…' }。
 * 中身は Web と同じ Server Action（app/app/cash/actions.ts）。ここは純粋な型と検証だけ。
 */

export type NativePettyKind = 'petty_in' | 'petty_out' | 'petty_advance' | 'petty_settlement';

export type NativePettyAction =
  /** 小口現金の入出金・立替・精算（承認待ちで登録。用途の文は Web と同じ組み立てをアプリで済ませて送る） */
  | { type: 'pettyAdd'; kind: NativePettyKind; amount: number; purpose: string; expenseAccountId: string | null }
  | { type: 'pettyApprove'; id: string }
  | { type: 'pettyReject'; id: string; reason: string }
  /** 開始残高（店舗設定） */
  | { type: 'pettyOpening'; amount: number }
  /** 実残高を数える（実査） */
  | { type: 'pettyCount'; countDate: string; expectedAmount: number; countedAmount: number; note: string | null }
  | { type: 'pettyCountApprove'; id: string }
  /** 締めの承認・締め後修正・店舗日次締めの再オープン */
  | { type: 'closingApprove'; id: string }
  | { type: 'closingReopen'; id: string; reason: string }
  | { type: 'closingReopenStoreDay'; storeId: string; businessDate: string; reason: string };

export type NativePettyActionType = NativePettyAction['type'];

export const NATIVE_PETTY_ACTION_TYPES: readonly NativePettyActionType[] = [
  'pettyAdd',
  'pettyApprove',
  'pettyReject',
  'pettyOpening',
  'pettyCount',
  'pettyCountApprove',
  'closingApprove',
  'closingReopen',
  'closingReopenStoreDay',
];

export function isNativePettyActionType(v: unknown): v is NativePettyActionType {
  return typeof v === 'string' && (NATIVE_PETTY_ACTION_TYPES as readonly string[]).includes(v);
}

/** 操作に要る権限（Web の Server Action の requirePermission と同じ。店舗日次締めの再オープンは役割で見る） */
export function nativePettyPermission(type: NativePettyActionType): 'cash.write' | 'cash.approve' | 'register.approve' | null {
  switch (type) {
    case 'pettyAdd':
    case 'pettyCount':
      return 'cash.write';
    case 'pettyApprove':
    case 'pettyReject':
    case 'pettyOpening':
    case 'pettyCountApprove':
      return 'cash.approve';
    case 'closingApprove':
    case 'closingReopen':
      return 'register.approve';
    case 'closingReopenStoreDay':
      return null;
  }
}

type Parsed = { ok: true; action: NativePettyAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });
const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};
const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const KINDS: readonly NativePettyKind[] = ['petty_in', 'petty_out', 'petty_advance', 'petty_settlement'];

export function parseNativePettyAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'pettyAdd': {
      if (!KINDS.includes(b.kind as NativePettyKind)) return bad('区分が正しくありません');
      const amount = int(b.amount, 1, 99_999_999);
      if (amount == null) return bad('金額は1円以上の整数で入力してください');
      const purpose = str(b.purpose, 300);
      if (!purpose) return bad('用途・メモを入力してください');
      if (b.expenseAccountId != null && !isUuid(b.expenseAccountId)) return bad('勘定科目が正しくありません');
      return { ok: true, action: { type: 'pettyAdd', kind: b.kind as NativePettyKind, amount, purpose, expenseAccountId: (b.expenseAccountId as string | null | undefined) ?? null } };
    }
    case 'pettyApprove':
    case 'pettyCountApprove':
    case 'closingApprove':
      if (!isUuid(b.id)) return bad();
      return { ok: true, action: { type: b.type, id: b.id } };
    case 'pettyReject':
    case 'closingReopen': {
      if (!isUuid(b.id)) return bad();
      const reason = str(b.reason, 500);
      if (!reason) return bad(b.type === 'pettyReject' ? '差戻し理由を入力してください' : '修正理由を入力してください');
      return { ok: true, action: { type: b.type, id: b.id, reason } };
    }
    case 'pettyOpening': {
      const amount = int(b.amount, 0, 99_999_999);
      if (amount == null) return bad('開始残高は0以上の整数で入力してください');
      return { ok: true, action: { type: 'pettyOpening', amount } };
    }
    case 'pettyCount': {
      if (!isDate(b.countDate)) return bad('実査日を入力してください');
      const expectedAmount = int(b.expectedAmount, -99_999_999, 99_999_999);
      const countedAmount = int(b.countedAmount, 0, 99_999_999);
      if (expectedAmount == null) return bad();
      if (countedAmount == null) return bad('実残高は0以上の整数で入力してください');
      return { ok: true, action: { type: 'pettyCount', countDate: b.countDate, expectedAmount, countedAmount, note: str(b.note, 500) } };
    }
    case 'closingReopenStoreDay': {
      if (!isUuid(b.storeId) || !isDate(b.businessDate)) return bad();
      const reason = str(b.reason, 500);
      if (!reason) return bad('再オープン理由を入力してください');
      return { ok: true, action: { type: 'closingReopenStoreDay', storeId: b.storeId, businessDate: b.businessDate, reason } };
    }
    default:
      return bad();
  }
}
