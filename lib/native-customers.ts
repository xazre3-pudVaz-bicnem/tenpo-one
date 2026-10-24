import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの「顧客台帳」（Web の /app/customers・/app/customers/[id] と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=customers / part=customer&id=、操作は POST { type: 'customer…' }。
 * 中身は Web と同じ Server Action（app/app/customers/actions.ts）。ここは純粋な型と検証だけ。
 */
export type NativeCustomerAction =
  | { type: 'customerCreate'; name: string; nameKana: string; phone: string; email: string; birthday: string; allergyNote: string; preferenceNote: string; serviceNote: string }
  | { type: 'customerAttributes'; id: string; allergyNote: string; dislikeNote: string; preferenceNote: string; seatPreference: string; anniversaryNote: string; serviceNote: string }
  | { type: 'customerNote'; id: string; body: string }
  | { type: 'customerRecalc'; id: string }
  /** 伝票にお客様を付ける（来店登録の「顧客名 設定」。null で外す。Web の setOrderCustomer と同じ） */
  | { type: 'orderCustomer'; orderId: string; customerId: string | null };

export type NativeCustomerActionType = NativeCustomerAction['type'];
export const NATIVE_CUSTOMER_ACTION_TYPES: readonly NativeCustomerActionType[] = ['customerCreate', 'customerAttributes', 'customerNote', 'customerRecalc', 'orderCustomer'];

export function isNativeCustomerActionType(v: unknown): v is NativeCustomerActionType {
  return typeof v === 'string' && (NATIVE_CUSTOMER_ACTION_TYPES as readonly string[]).includes(v);
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function parseNativeCustomerAction(raw: unknown): { ok: true; action: NativeCustomerAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'customerCreate': {
      const name = s(b.name, 100);
      if (!name.trim()) return { ok: false, error: '名前を入力してください' };
      const birthday = s(b.birthday, 10);
      if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return { ok: false, error: '誕生日が正しくありません' };
      return {
        ok: true,
        action: { type: 'customerCreate', name, nameKana: s(b.nameKana, 100), phone: s(b.phone, 30), email: s(b.email, 200), birthday, allergyNote: s(b.allergyNote, 1000), preferenceNote: s(b.preferenceNote, 1000), serviceNote: s(b.serviceNote, 2000) },
      };
    }
    case 'customerAttributes':
      if (!isUuid(b.id)) return { ok: false, error: '内容が正しくありません' };
      return {
        ok: true,
        action: { type: 'customerAttributes', id: b.id, allergyNote: s(b.allergyNote, 1000), dislikeNote: s(b.dislikeNote, 1000), preferenceNote: s(b.preferenceNote, 1000), seatPreference: s(b.seatPreference, 500), anniversaryNote: s(b.anniversaryNote, 500), serviceNote: s(b.serviceNote, 2000) },
      };
    case 'customerNote': {
      if (!isUuid(b.id)) return { ok: false, error: '内容が正しくありません' };
      const body = s(b.body, 2000);
      if (!body.trim()) return { ok: false, error: 'メモ内容を入力してください' };
      return { ok: true, action: { type: 'customerNote', id: b.id, body } };
    }
    case 'orderCustomer':
      if (!isUuid(b.orderId) || (b.customerId != null && !isUuid(b.customerId))) return { ok: false, error: '内容が正しくありません' };
      return { ok: true, action: { type: 'orderCustomer', orderId: b.orderId, customerId: (b.customerId as string | null | undefined) ?? null } };
    case 'customerRecalc':
      if (!isUuid(b.id)) return { ok: false, error: '内容が正しくありません' };
      return { ok: true, action: { type: 'customerRecalc', id: b.id } };
    default:
      return { ok: false, error: '内容が正しくありません' };
  }
}
