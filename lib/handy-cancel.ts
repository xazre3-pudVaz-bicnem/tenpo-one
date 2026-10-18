/**
 * ハンディの「注文した品の取消（−）」と「時間延長」の決まり。純関数・テスト対象。
 *
 * 2026-10-18 Ronnie「送った品も間違えることがある。送ってから5分以内なら − で取消できるように。
 * 伝票ごとの取消はハンディではできない」「人数変更・時間延長もハンディで」。
 */

/** 送ってから − で取り消せる時間 */
export const HANDY_CANCEL_WINDOW_MS = 5 * 60_000;
/** 端末と DB の時計のずれ・押すまでの時間の余裕 */
const CLOCK_SLACK_MS = 15_000;

/** まだ − で取り消せるか（orderedAtMs＝伝票に入れた時刻） */
export function canHandyCancel(orderedAtMs: number | null | undefined, nowMs: number): boolean {
  if (orderedAtMs == null || !Number.isFinite(orderedAtMs)) return false;
  const age = nowMs - orderedAtMs;
  return age >= -CLOCK_SLACK_MS && age <= HANDY_CANCEL_WINDOW_MS + CLOCK_SLACK_MS;
}

/** 取り消せる残りの秒（表示用。過ぎていれば 0） */
export function handyCancelSecondsLeft(orderedAtMs: number | null | undefined, nowMs: number): number {
  if (orderedAtMs == null || !Number.isFinite(orderedAtMs)) return 0;
  return Math.max(0, Math.ceil((orderedAtMs + HANDY_CANCEL_WINDOW_MS - nowMs) / 1000));
}

/** 時間延長のボタン（分） */
export const HANDY_EXTEND_OPTIONS = [30, 60, 90, 120] as const;

/** 延長後の時間（分）。席の時間は 15分〜8時間（lib/seat-time と同じ範囲）に収める */
export function extendedStayMinutes(currentMinutes: number, addMinutes: number): number {
  const next = Math.round(currentMinutes) + addMinutes;
  return Math.min(480, Math.max(15, next));
}

/** ハンディで打てるメモ（フリーテキスト）の長さ。厨房伝票の「※…」の行に出る */
export const HANDY_MEMO_MAX = 40;

export function normalizeHandyMemo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\s　]+/g, ' ').trim();
  return s ? [...s].slice(0, HANDY_MEMO_MAX).join('') : null;
}
