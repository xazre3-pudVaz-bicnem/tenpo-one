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
  | { type: 'orderCustomer'; orderId: string; customerId: string | null }
  // ここから詳細の「編集・その他」（Web の /app/customers/[id] と同じ。2026-10-24）
  | { type: 'customerBasic'; id: string; name: string; nameKana: string; phone: string; email: string; birthday: string; gender: string; postalCode: string; address: string }
  | { type: 'customerConsent'; id: string; consentType: 'privacy' | 'marketing_email' | 'marketing_line'; granted: boolean }
  | { type: 'customerTagAttach' | 'customerTagDetach'; id: string; tagId: string }
  | { type: 'customerTagCreate'; id: string; name: string; color: string }
  | { type: 'customerMemberNo'; id: string; memberNo: string }
  | { type: 'customerMemberRank'; id: string; rank: string }
  | { type: 'customerPoints'; id: string; delta: number; reason: string }
  | { type: 'customerMerge'; id: string; mergeIds: string[] }
  | { type: 'customerAnonymize' | 'customerDelete'; id: string; reason: string };

export type NativeCustomerActionType = NativeCustomerAction['type'];
export const NATIVE_CUSTOMER_ACTION_TYPES: readonly NativeCustomerActionType[] = [
  'customerCreate', 'customerAttributes', 'customerNote', 'customerRecalc', 'orderCustomer',
  'customerBasic', 'customerConsent', 'customerTagAttach', 'customerTagDetach', 'customerTagCreate',
  'customerMemberNo', 'customerMemberRank', 'customerPoints', 'customerMerge', 'customerAnonymize', 'customerDelete',
];

/** 操作ごとに要る権限（Web の Server Action の requirePermission と同じ） */
export function nativeCustomerPermission(type: NativeCustomerActionType): 'pos.order' | 'customers.write' | 'customers.delete' | 'cash.approve' | 'org.settings' {
  if (type === 'orderCustomer') return 'pos.order';
  if (type === 'customerMerge' || type === 'customerDelete') return 'customers.delete';
  if (type === 'customerPoints') return 'cash.approve';
  if (type === 'customerAnonymize') return 'org.settings';
  return 'customers.write';
}

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
    case 'customerBasic': {
      if (!isUuid(b.id)) return { ok: false, error: '内容が正しくありません' };
      const name = s(b.name, 100);
      if (!name.trim()) return { ok: false, error: '名前を入力してください' };
      const birthday = s(b.birthday, 10);
      if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return { ok: false, error: '誕生日が正しくありません' };
      const gender = s(b.gender, 10);
      if (gender && !['male', 'female', 'other'].includes(gender)) return { ok: false, error: '性別が正しくありません' };
      return {
        ok: true,
        action: { type: 'customerBasic', id: b.id, name, nameKana: s(b.nameKana, 100), phone: s(b.phone, 30), email: s(b.email, 200), birthday, gender, postalCode: s(b.postalCode, 10), address: s(b.address, 300) },
      };
    }
    case 'customerConsent':
      if (!isUuid(b.id) || !['privacy', 'marketing_email', 'marketing_line'].includes(b.consentType as string) || typeof b.granted !== 'boolean') {
        return { ok: false, error: '内容が正しくありません' };
      }
      return { ok: true, action: { type: 'customerConsent', id: b.id, consentType: b.consentType as 'privacy' | 'marketing_email' | 'marketing_line', granted: b.granted } };
    case 'customerTagAttach':
    case 'customerTagDetach':
      if (!isUuid(b.id) || !isUuid(b.tagId)) return { ok: false, error: '内容が正しくありません' };
      return { ok: true, action: { type: b.type, id: b.id, tagId: b.tagId } };
    case 'customerTagCreate': {
      if (!isUuid(b.id)) return { ok: false, error: '内容が正しくありません' };
      const name = s(b.name, 40);
      if (!name.trim()) return { ok: false, error: 'タグ名を入力してください' };
      const color = s(b.color, 7);
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, error: '色が正しくありません' };
      return { ok: true, action: { type: 'customerTagCreate', id: b.id, name, color } };
    }
    case 'customerMemberNo':
      if (!isUuid(b.id)) return { ok: false, error: '内容が正しくありません' };
      return { ok: true, action: { type: 'customerMemberNo', id: b.id, memberNo: s(b.memberNo, 50) } };
    case 'customerMemberRank':
      if (!isUuid(b.id) || !['regular', 'silver', 'gold', 'vip'].includes(b.rank as string)) return { ok: false, error: '内容が正しくありません' };
      return { ok: true, action: { type: 'customerMemberRank', id: b.id, rank: b.rank as string } };
    case 'customerPoints': {
      if (!isUuid(b.id)) return { ok: false, error: '内容が正しくありません' };
      if (typeof b.delta !== 'number' || !Number.isInteger(b.delta) || b.delta === 0 || Math.abs(b.delta) > 10_000_000) return { ok: false, error: '増減ポイントを入力してください' };
      const reason = s(b.reason, 500);
      if (!reason.trim()) return { ok: false, error: '理由を入力してください' };
      return { ok: true, action: { type: 'customerPoints', id: b.id, delta: b.delta, reason } };
    }
    case 'customerMerge':
      if (!isUuid(b.id) || !Array.isArray(b.mergeIds) || b.mergeIds.length === 0 || b.mergeIds.length > 20 || !b.mergeIds.every(isUuid) || b.mergeIds.includes(b.id)) {
        return { ok: false, error: '統合する顧客を選んでください' };
      }
      return { ok: true, action: { type: 'customerMerge', id: b.id, mergeIds: b.mergeIds as string[] } };
    case 'customerAnonymize':
    case 'customerDelete': {
      if (!isUuid(b.id)) return { ok: false, error: '内容が正しくありません' };
      const reason = s(b.reason, 500);
      if (!reason.trim()) return { ok: false, error: '理由を入力してください' };
      return { ok: true, action: { type: b.type, id: b.id, reason } };
    }
    default:
      return { ok: false, error: '内容が正しくありません' };
  }
}
