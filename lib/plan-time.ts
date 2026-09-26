/**
 * プラン（飲み放題・食べ放題・コース）の時間切れ判定。
 *
 * 2026-09-25 店舗要望（FULL MOoN 御茶ノ水）:
 * 「飲み放題の時間が終わってもオーダーできてしまうので、時間が終わったらオーダーできないように」。
 * 終了予定（reservations.end_at）を過ぎた卓では、QR（お客様のセルフオーダー）から
 * プラン・放題の中身を注文できないようにする。
 *
 * 決めごと:
 *   - 止めるのは QR だけ。レジ・ハンディ（スタッフ）は延長や追加のために今までどおり使える
 *   - 止めるのはプラン・放題の中身だけ。単品（有料のアラカルト）は時間後も注文できる
 *   - 時間制でない卓（end_at が無い）は何も変わらない
 * ここは純粋な関数だけ（DB・React 非依存・テスト対象）。
 */

/** 終了予定を過ぎたか。時間制でなければ常に false */
export function isPlanTimeOver(endAtMs: number | null | undefined, nowMs: number): boolean {
  if (endAtMs == null || !Number.isFinite(endAtMs)) return false;
  return nowMs > endAtMs;
}

/** 残り時間（分）。過ぎていれば 0、時間制でなければ null */
export function planMinutesLeft(endAtMs: number | null | undefined, nowMs: number): number | null {
  if (endAtMs == null || !Number.isFinite(endAtMs)) return null;
  return Math.max(0, Math.ceil((endAtMs - nowMs) / 60_000));
}

/** ISO文字列をミリ秒に。空・不正は null */
export function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
