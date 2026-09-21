/**
 * 予約台帳（日時変更・空席検索）の開始時刻・滞在時間の選択肢。
 * 現場の要望（2026-09-21）で 30分単位 → 15分単位にした。純粋関数のみ（テスト対象）。
 */

/** 時刻・滞在時間の刻み（分） */
export const RESERVATION_TIME_STEP = 15;

/** 1日の分数 */
const DAY_MINUTES = 24 * 60;

/** 'HH:MM' を 0〜1439 の分に直す。読めない値は null */
export function hmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 分を 'HH:MM' に直す（24時を超えた分は翌日側に回す） */
export function minutesToHm(total: number): string {
  const t = ((Math.round(total) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** 開始時刻の選択肢（00:00〜23:45 を15分ずつ） */
export const RESERVATION_TIME_OPTIONS: readonly string[] = Array.from(
  { length: DAY_MINUTES / RESERVATION_TIME_STEP },
  (_, i) => minutesToHm(i * RESERVATION_TIME_STEP)
);

/** 滞在時間の選択肢（分）: 30分〜5時間を15分ずつ */
export const STAY_MINUTE_OPTIONS: readonly number[] = Array.from(
  { length: (300 - 30) / RESERVATION_TIME_STEP + 1 },
  (_, i) => 30 + i * RESERVATION_TIME_STEP
);

/** 滞在時間として扱える範囲（分）。これ以外の値は選択肢に足さない */
export const STAY_MINUTES_MIN = 1;
export const STAY_MINUTES_MAX = DAY_MINUTES;

/**
 * 開始時刻の選択肢に、いまの予約の時刻を足す（15分単位でない既存の予約を開いたとき、
 * 日付だけ直して「変更する」を押しても時刻が勝手に丸められないように）。
 */
export function withCurrentTime(options: readonly string[], current: string): string[] {
  const total = hmToMinutes(current);
  const list = [...options];
  if (total === null) return list;
  const hm = minutesToHm(total);
  if (list.includes(hm)) return list;
  list.push(hm);
  return list.sort((a, b) => (hmToMinutes(a) ?? 0) - (hmToMinutes(b) ?? 0));
}

/** 滞在時間の選択肢に、いまの予約の滞在時間を足す（上と同じ理由） */
export function withCurrentStay(options: readonly number[], current: number): number[] {
  const list = [...options];
  if (!isValidStayMinutes(current) || list.includes(current)) return list;
  list.push(current);
  return list.sort((a, b) => a - b);
}

export function isValidStayMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= STAY_MINUTES_MIN && minutes <= STAY_MINUTES_MAX;
}

/** 選択肢の表示（105 → 105分（1:45）） */
export function stayOptionLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${minutes}分（${h}:${String(m).padStart(2, '0')}）`;
}
