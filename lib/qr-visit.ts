/**
 * お客様QRの最初の画面：ご来店の人数（女性・男性）を選んでから注文へ進む
 * （2026-10-17 Ronnie「QR を読んだらすぐ注文ではなく、Air レジのように人数（Girls / Boys）を選んでから注文へ」）。
 * 純関数（画面と API の両方で使う）。
 */

/** 1つの欄（女性・男性）で選べる最大の人数 */
export const QR_GUEST_MAX = 30;

export interface QrGuestCounts {
  female: number;
  male: number;
}

/** 受け取った人数を確かめる。0〜30 の整数で、合計 1名以上。だめなら null */
export function parseQrGuestCounts(female: unknown, male: unknown): (QrGuestCounts & { total: number }) | null {
  const f = typeof female === 'number' ? female : Number.NaN;
  const m = typeof male === 'number' ? male : Number.NaN;
  if (!Number.isInteger(f) || !Number.isInteger(m)) return null;
  if (f < 0 || m < 0 || f > QR_GUEST_MAX || m > QR_GUEST_MAX) return null;
  const total = f + m;
  if (total < 1) return null;
  return { female: f, male: m, total };
}

/** 操作履歴などに残す書き方（例: 女性2・男性1） */
export function qrGuestLabel(c: QrGuestCounts): string {
  return `女性${c.female}・男性${c.male}`;
}

/** +/- で人数を変える（0〜30 に収める） */
export function stepGuest(n: number, delta: number): number {
  return Math.min(QR_GUEST_MAX, Math.max(0, n + delta));
}
