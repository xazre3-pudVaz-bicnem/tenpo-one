/**
 * 予約のキャンセルの種類（2026-10-20 Ronnie）。
 *   お客様キャンセル … お客様から連絡があってキャンセル
 *   店舗キャンセル   … お店の都合でキャンセル（担当を必ず選ぶ）
 *   無断キャンセル   … 連絡が無い・連絡が取れない（状態は no_show）
 * キャンセルの理由（reservations.cancel_reason）の先頭にこの名前を入れる（データベースは変えない）。
 * ハンディ・レジの予約台帳・メッセージで同じ名前を使う。
 */

export type CancelKind = 'guest' | 'store' | 'no_show';

export const CANCEL_KINDS: readonly { key: CancelKind; label: string; hint: string; en: string }[] = [
  { key: 'guest', label: 'お客様キャンセル', hint: '連絡ありのキャンセル', en: 'Guest' },
  { key: 'store', label: '店舗キャンセル', hint: '担当を選んでください', en: 'Store' },
  { key: 'no_show', label: '無断キャンセル', hint: '連絡なし・連絡が取れない', en: 'No-show' },
];

/** キャンセルの理由の文。店舗キャンセルは担当の名前が必要 */
export function cancelReasonText(kind: CancelKind, opts: { staffName?: string | null; note?: string | null } = {}): string {
  const note = opts.note?.trim();
  const tail = note ? `：${note}` : '';
  if (kind === 'guest') return `お客様キャンセル（連絡あり）${tail}`;
  if (kind === 'no_show') return `無断キャンセル（連絡なし）${tail}`;
  const staff = opts.staffName?.trim();
  if (!staff) throw new Error('店舗キャンセルは担当を選んでください');
  return `店舗キャンセル（担当: ${staff}）${tail}`;
}

/** 店舗キャンセルなのに担当が入っていない（サーバーで止める） */
export function storeCancelMissingStaff(reason: string): boolean {
  const r = reason.trim();
  return r.startsWith('店舗キャンセル') && !/（担当: [^）]+）/.test(r);
}

/** 理由の文・状態から種類を読む（メッセージの見出し用）。古い理由（貴店都合・お客様都合）も読む */
export function cancelKindOf(status: string, reason: string | null | undefined): CancelKind | null {
  if (status === 'no_show') return 'no_show';
  const r = (reason ?? '').trim();
  if (r.startsWith('店舗キャンセル') || r.startsWith('貴店都合')) return 'store';
  if (r.startsWith('お客様キャンセル') || r.startsWith('お客様都合')) return 'guest';
  if (r.startsWith('無断キャンセル')) return 'no_show';
  return null;
}

/** 種類の名前（分からなければ「キャンセル」） */
export function cancelKindLabel(kind: CancelKind | null): string {
  return CANCEL_KINDS.find((k) => k.key === kind)?.label ?? 'キャンセル';
}
