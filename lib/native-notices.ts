import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの「通知」（Web の /app/notifications と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=notices&type&store&status、操作は POST { type: 'noticeRead' | 'noticeReadAll' }。
 */
export type NativeNoticeAction =
  | { type: 'noticeRead'; id: string }
  | { type: 'noticeReadAll' }
  /** お知らせ（Web の /app/announcements）：開封・作成・削除 */
  | { type: 'annRead'; id: string }
  | { type: 'annDelete'; id: string }
  | { type: 'annCreate'; title: string; body: string; isImportant: boolean; publishFrom: string | null; publishTo: string | null; allStores: boolean };
export type NativeNoticeActionType = NativeNoticeAction['type'];
export const NATIVE_NOTICE_ACTION_TYPES: readonly NativeNoticeActionType[] = ['noticeRead', 'noticeReadAll', 'annRead', 'annDelete', 'annCreate'];

const optDate = (v: unknown): string | null | false => (v == null || v === '' ? null : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : false);

export function isNativeNoticeActionType(v: unknown): v is NativeNoticeActionType {
  return typeof v === 'string' && (NATIVE_NOTICE_ACTION_TYPES as readonly string[]).includes(v);
}

export function parseNativeNoticeAction(raw: unknown): { ok: true; action: NativeNoticeAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if (b.type === 'noticeReadAll') return { ok: true, action: { type: 'noticeReadAll' } };
  if ((b.type === 'noticeRead' || b.type === 'annRead' || b.type === 'annDelete') && isUuid(b.id)) return { ok: true, action: { type: b.type, id: b.id } };
  if (b.type === 'annCreate') {
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
    const body = typeof b.body === 'string' ? b.body.trim().slice(0, 5000) : '';
    if (!title) return { ok: false, error: 'タイトルを入力してください' };
    if (!body) return { ok: false, error: '本文を入力してください' };
    const publishFrom = optDate(b.publishFrom);
    const publishTo = optDate(b.publishTo);
    if (publishFrom === false || publishTo === false) return { ok: false, error: '公開日が正しくありません' };
    return { ok: true, action: { type: 'annCreate', title, body, isImportant: b.isImportant === true, publishFrom, publishTo, allStores: b.allStores === true } };
  }
  return { ok: false, error: '内容が正しくありません' };
}
