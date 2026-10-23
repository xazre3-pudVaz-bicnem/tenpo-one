import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの「通知」（Web の /app/notifications と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=notices&type&store&status、操作は POST { type: 'noticeRead' | 'noticeReadAll' }。
 */
export type NativeNoticeAction = { type: 'noticeRead'; id: string } | { type: 'noticeReadAll' };
export type NativeNoticeActionType = NativeNoticeAction['type'];
export const NATIVE_NOTICE_ACTION_TYPES: readonly NativeNoticeActionType[] = ['noticeRead', 'noticeReadAll'];

export function isNativeNoticeActionType(v: unknown): v is NativeNoticeActionType {
  return typeof v === 'string' && (NATIVE_NOTICE_ACTION_TYPES as readonly string[]).includes(v);
}

export function parseNativeNoticeAction(raw: unknown): { ok: true; action: NativeNoticeAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if (b.type === 'noticeReadAll') return { ok: true, action: { type: 'noticeReadAll' } };
  if (b.type === 'noticeRead' && isUuid(b.id)) return { ok: true, action: { type: 'noticeRead', id: b.id } };
  return { ok: false, error: '内容が正しくありません' };
}
