/**
 * 卓の時間制（テーブル一覧の残り時間・色）。
 *
 * お店で決める「時間制」（コースの時間・来店登録やレジの「席の時間」）はラストオーダーの時刻。
 * お客様の席の終わりは、その 30 分あと（例：2 時間制＝L.O. 2:00・終わり 2:30＝「2.5H」のコース）。
 * 卓の箱は、L.O. まではふつうの色、L.O.〜終わりは黄（L.O.済）、終わりを過ぎたら赤（時間超過）。
 * 2026-10-25 19:14 Ronnie「suruko jikan ra 30 min jodera total 時間 時間制 ho」「Last order 時間マイナス garera 時間制 hune hoina」
 * 「30 分前まで color change hudaina・Last order time ma yellow ani 時間 sakiyepaxi rato」
 *
 * 時間制でない卓（予約の終わりだけ・店の滞在時間）は今まで通り（終わり＝その時刻）。
 */

/** ラストオーダーから席の終わりまで（分） */
export const LAST_ORDER_TO_END_MINUTES = 30;

const MIN = 60_000;

/** コースの時間（＝L.O.）から、席の時間の合計（分）。卓の箱の「時間制 N分」はこの合計 */
export function courseTotalMinutes(courseMinutes: number): number {
  return courseMinutes + LAST_ORDER_TO_END_MINUTES;
}

export interface TableEndInput {
  /** 伝票を開いた時刻 ms */
  openedAtMs: number;
  /** 予約のコースの時間（分）。無ければ null */
  courseMinutes: number | null;
  /** 予約の開始・終了 ms（予約が無ければ NaN） */
  resvStartMs: number;
  resvEndMs: number;
  /** 店の既定の滞在時間（分） */
  stayMinutes: number;
}

/**
 * 席の終わり（ms）。
 *   1. 予約の開始＝伝票の開始（来店登録・レジの「席の時間」で決めた時間制）→ 予約の終わり（＝L.O.）＋30 分
 *   2. コースの時間がある → 開始＋コースの時間（＝L.O.）＋30 分
 *   3. 予約の終わりがある（予約客が遅れて来た等）→ 予約の終わり（今まで通り）
 *   4. どれも無い → 開始＋店の滞在時間（今まで通り）
 */
export function tableEndAtMs(input: TableEndInput): number {
  const { openedAtMs, courseMinutes, resvStartMs, resvEndMs, stayMinutes } = input;
  const seatTimeSet =
    Number.isFinite(resvStartMs) && Math.abs(resvStartMs - openedAtMs) < MIN && Number.isFinite(resvEndMs) && resvEndMs > openedAtMs;
  if (seatTimeSet) return resvEndMs + LAST_ORDER_TO_END_MINUTES * MIN;
  if (courseMinutes != null && courseMinutes > 0) return openedAtMs + courseTotalMinutes(courseMinutes) * MIN;
  if (Number.isFinite(resvEndMs) && resvEndMs > openedAtMs) return resvEndMs;
  return openedAtMs + stayMinutes * MIN;
}
