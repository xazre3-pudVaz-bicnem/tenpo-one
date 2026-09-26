/**
 * レジ（オーダー・会計）の画面で「席の時間・コース」を直す。
 *
 * 2026-09-22 店舗要望（FULL MOoN 御茶ノ水）: 伝票画面の上（卓・人数・担当・顧客の並び）で、
 * 席の時間やコースを編集したい。
 *   - 開始時間 … 伝票の開始時刻（orders.opened_at）＝フロア・ハンディの経過時間の起点
 *   - 時間（分）… 終了予定＝開始＋時間（reservations.end_at）。フロアの残り時間・L.O.・超過に使う
 *   - コース … reservations.course_id（コースの所要時間があれば、時間の既定値にする）
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */
import { DURATION_MAX_MINUTES, DURATION_MIN_MINUTES, durationLabel } from './handy-visit';

export { DURATION_MAX_MINUTES, DURATION_MIN_MINUTES, durationLabel };

/** ワンタップで選べる時間（分） */
export const SEAT_DURATION_CHOICES: readonly number[] = [60, 90, 120, 150, 180];

const JST_OFFSET_MS = 9 * 60 * 60_000;

/** 'HH:MM'（日本時間）にする */
export function jstHm(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export interface SeatCourseOption {
  id: string;
  name: string;
  /** コースの所要時間（分）。無ければ null */
  durationMinutes: number | null;
}

export interface SeatTimeState {
  /** 開始（ms） */
  startMs: number;
  /** 終了予定（ms）。無ければ null（時間制なし） */
  endMs: number | null;
  courseId: string | null;
  /** 人数。渡すとダイアログで人数も一緒に直せる（2026-09-26 店舗要望） */
  guestCount?: number;
}

/** 人数として受け付ける範囲（setGuestCount と同じ） */
export const GUEST_COUNT_MAX = 999;
export function isGuestCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= GUEST_COUNT_MAX;
}

/** 開始と終了予定から「時間（分）」。終了予定が無い・逆転していれば null */
export function seatDurationMinutes(s: Pick<SeatTimeState, 'startMs' | 'endMs'>): number | null {
  if (s.endMs == null || s.endMs <= s.startMs) return null;
  return Math.round((s.endMs - s.startMs) / 60_000);
}

/** 時間（分）として受け付けるか（15分〜8時間、1分単位） */
export function isSeatDuration(minutes: unknown): minutes is number {
  return (
    typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= DURATION_MIN_MINUTES &&
    minutes <= DURATION_MAX_MINUTES
  );
}

/**
 * コースを選び直したときの時間の既定値。
 * コースに所要時間があればそれ、無ければ今の時間のまま（今の時間も無ければ null）。
 */
export function durationForCourse(
  course: SeatCourseOption | null | undefined,
  currentMinutes: number | null
): number | null {
  if (course?.durationMinutes && isSeatDuration(course.durationMinutes)) return course.durationMinutes;
  return currentMinutes;
}

/** 伝票画面の上に出す短い表示（例: 18:03〜20:03・3h 3980 course） */
export function seatBadgeLabel(s: SeatTimeState, courses: readonly SeatCourseOption[]): string {
  const range = s.endMs != null && s.endMs > s.startMs ? `${jstHm(s.startMs)}〜${jstHm(s.endMs)}` : `${jstHm(s.startMs)}〜`;
  const course = s.courseId ? courses.find((c) => c.id === s.courseId) : null;
  return course ? `${range}・${course.name}` : range;
}
