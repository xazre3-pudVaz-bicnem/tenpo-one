/** 表示フォーマット（日本時間・円） */

export function yen(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `¥${amount.toLocaleString('ja-JP')}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
}

/** 'YYYY-MM-DD'（JSTの今日） */
export function todayJst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/** JSTのn日前 'YYYY-MM-DD' */
export function daysAgoJst(n: number): string {
  return new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
/**
 * 曜日（日本語）。サーバーTZに依存せず「JSTのカレンダー日付」の曜日を返す。
 * 注意: getDay() はローカルTZ評価のため本番（UTC）では1日ズレる。必ずUTC演算で求める。
 */
export function weekdayJa(value: string | Date): string {
  if (typeof value === 'string') {
    // 'YYYY-MM-DD' はカレンダー日付として解釈（TZ非依存）
    return WEEKDAYS[new Date(`${value.slice(0, 10)}T00:00:00Z`).getUTCDay()];
  }
  // Date は JST の日付に変換してから曜日を取る
  return WEEKDAYS[new Date(value.getTime() + 9 * 3600000).getUTCDay()];
}
