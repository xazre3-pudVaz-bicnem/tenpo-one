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
export function weekdayJa(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(`${value}T00:00:00+09:00`) : value;
  return WEEKDAYS[d.getDay()];
}
