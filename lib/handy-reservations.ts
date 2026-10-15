/**
 * ハンディの予約（RESERVATION）の日付まわり（2026-10-15 Ronnie「ハンディの予約でほかの日も見られるように。予約の追加もハンディで」）。
 * ここは純粋な関数だけ（DB・React 非依存・テスト対象）。
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 'YYYY-MM-DD' として正しい日付か */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** URL の ?date= を読む。無い・壊れているときは今日 */
export function parseHandyDate(raw: string | string[] | undefined | null, today: string): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isIsoDate(v) ? v : today;
}

/** n 日ずらした日付（'YYYY-MM-DD'） */
export function shiftDate(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** 曜日（日〜土） */
export function weekdayOf(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) return '';
  return WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
}

/** 「10/16（木）」 */
export function handyDayLabel(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  return `${Number(m[2])}/${Number(m[3])}（${weekdayOf(date)}）`;
}

/** 画面の見出し：今日の予約・明日の予約・昨日の予約・10/20（火）の予約 */
export function handyReservationsTitle(date: string, today: string): string {
  if (date === today) return '今日の予約';
  if (date === shiftDate(today, 1)) return '明日の予約';
  if (date === shiftDate(today, -1)) return '昨日の予約';
  return `${handyDayLabel(date)}の予約`;
}

/** 一覧の URL（今日は ?date を付けない） */
export function handyReservationsHref(date: string, today: string): string {
  return date === today ? '/handy/reservations' : `/handy/reservations?date=${date}`;
}

/** 予約を追加する画面の URL */
export function handyNewReservationHref(date: string): string {
  return `/handy/reservations/new?date=${date}`;
}

/** 予約がないときの文 */
export function handyEmptyText(date: string, today: string): string {
  return date === today ? '今日の予約はありません。' : `${handyDayLabel(date)}の予約はありません。`;
}
