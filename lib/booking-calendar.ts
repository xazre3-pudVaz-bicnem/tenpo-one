/**
 * ご予約完了ページの「カレンダーに追加」「Googleマップで見る」（2026-10-19 Ronnie
 * 「QR から予約したあと、カレンダーに追加と Google マップへ、も出す」）。
 * 日時は日本時間（JST・夏時間なし）。予約の中身はサーバーに問い合わせず、完了ページの URL（d・t・m・n）から作る。
 */

export interface CalendarVisit {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:MM' */
  time: string;
  /** 滞在（分） */
  minutes: number;
  title: string;
  location: string | null;
  details: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 完了ページの URL の値を確かめる（おかしければ null＝カレンダーのボタンを出さない） */
export function parseVisitParams(p: { d?: string; t?: string; m?: string; n?: string }): {
  date: string;
  time: string;
  minutes: number;
  party: number | null;
} | null {
  if (!p.d || !p.t || !DATE_RE.test(p.d) || !TIME_RE.test(p.t)) return null;
  if (Number.isNaN(new Date(`${p.d}T00:00:00Z`).getTime())) return null;
  const m = Number(p.m);
  const minutes = Number.isInteger(m) && m >= 15 && m <= 720 ? m : 120;
  const n = Number(p.n);
  const party = Number.isInteger(n) && n >= 1 && n <= 500 ? n : null;
  return { date: p.d, time: p.t, minutes, party };
}

/** 日本時間の日時 → UTC の 'YYYYMMDDTHHMMSSZ' */
function utcStamp(date: string, time: string, addMinutes = 0): string {
  const ms = Date.parse(`${date}T${time}:00+09:00`) + addMinutes * 60000;
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Google カレンダーの「予定を作る」画面の URL */
export function googleCalendarUrl(v: CalendarVisit): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: v.title,
    dates: `${utcStamp(v.date, v.time)}/${utcStamp(v.date, v.time, v.minutes)}`,
    details: v.details,
    ctz: 'Asia/Tokyo',
  });
  if (v.location) q.set('location', v.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** iPhone・Outlook など用の .ics（iCalendar） */
export function icsText(v: CalendarVisit & { uid: string; now?: Date }): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = (v.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TENPO ONE//Booking//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${v.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${utcStamp(v.date, v.time)}`,
    `DTEND:${utcStamp(v.date, v.time, v.minutes)}`,
    `SUMMARY:${esc(v.title)}`,
    ...(v.location ? [`LOCATION:${esc(v.location)}`] : []),
    `DESCRIPTION:${esc(v.details)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT2H',
    `DESCRIPTION:${esc(v.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Google マップでお店を探す URL（店名＋住所） */
export function googleMapsUrl(storeName: string, address: string | null): string {
  // 〒 と郵便番号は外す（地図の検索では店名＋住所のほうが当たる）
  const addr = address?.replace(/〒?\s*\d{3}-?\d{4}\s*/, '').trim() || null;
  const query = [storeName, addr].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
