/**
 * 予約台帳設定（2026-09-28 Ronnie「予約台帳設定の中に グルメ連携・SNS連携・Google連携 を全部」）の純粋な部分。
 * - SNS・Google からの予約リンク: 公開予約URLに ?src=<経路> を付けて配る → その経路で予約が記録される
 * - Google カレンダー連携: 台帳の予約を iCal（.ics）で配信する（購読URLは token 付き）
 */

export type LinkChannelKey = 'instagram' | 'line' | 'facebook' | 'x' | 'google';

export interface LinkChannel {
  key: LinkChannelKey;
  /** reservation_sources.code */
  sourceCode: string;
  label: string;
  en: string;
  /** どこに貼るか */
  howTo: string;
  /** そのSNSの管理画面 */
  adminUrl: string | null;
}

export const SNS_CHANNELS: LinkChannel[] = [
  {
    key: 'instagram', sourceCode: 'instagram', label: 'Instagram', en: 'Instagram',
    howTo: 'プロフィールの「ウェブサイト」欄、または「アクションボタン」→「予約する」にこのリンクを入れます。ストーリーズのリンクスタンプにも使えます。',
    adminUrl: 'https://www.instagram.com/accounts/edit/',
  },
  {
    key: 'line', sourceCode: 'line', label: 'LINE公式アカウント', en: 'LINE Official',
    howTo: 'LINE Official Account Manager →「リッチメニュー」や「あいさつメッセージ」にこのリンクを入れます。',
    adminUrl: 'https://manager.line.biz/',
  },
  {
    key: 'facebook', sourceCode: 'facebook', label: 'Facebook', en: 'Facebook',
    howTo: 'ページの「アクションボタン」→「予約する」にこのリンクを入れます。',
    adminUrl: 'https://www.facebook.com/',
  },
  {
    key: 'x', sourceCode: 'x', label: 'X（Twitter）', en: 'X',
    howTo: 'プロフィールの「ウェブサイト」欄、固定ポストにこのリンクを入れます。',
    adminUrl: 'https://x.com/settings/profile',
  },
];

export const GOOGLE_CHANNEL: LinkChannel = {
  key: 'google', sourceCode: 'google', label: 'Google ビジネスプロフィール', en: 'Google Business Profile',
  howTo: 'Google ビジネスプロフィール →「予約」→「予約リンクを追加」にこのリンクを入れると、Google 検索・マップの店舗情報に「予約」ボタンが出ます。',
  adminUrl: 'https://business.google.com/',
};

const SRC_TO_SOURCE: Record<string, string> = {
  instagram: 'instagram',
  line: 'line',
  facebook: 'facebook',
  x: 'x',
  google: 'google',
  tabelog: 'tabelog',
  hotpepper: 'hotpepper',
};

/** 公開予約ページの ?src= から予約経路のコードへ（知らない値は web） */
export function sourceCodeFromSrc(src: string | null | undefined): string {
  if (!src) return 'web';
  return SRC_TO_SOURCE[src.trim().toLowerCase()] ?? 'web';
}

/** 経路付きの予約リンク */
export function bookingLinkWithSrc(bookingUrl: string, channel: LinkChannelKey): string {
  const sep = bookingUrl.includes('?') ? '&' : '?';
  return `${bookingUrl}${sep}src=${channel}`;
}

/** 店舗ごとの設定（store_settings.settings.reservationBook） */
export interface ReservationBookSettings {
  /** Google カレンダー購読用 token（無ければ未発行） */
  icalToken: string | null;
  /** SNS のアカウントURL（公開予約ページに出す・控え） */
  sns: Partial<Record<Exclude<LinkChannelKey, 'google'>, string>>;
}

export function reservationBookSettingsFrom(settings: Record<string, unknown> | null | undefined): ReservationBookSettings {
  const raw = (settings?.reservationBook ?? {}) as Partial<ReservationBookSettings>;
  const sns = (raw.sns && typeof raw.sns === 'object' ? raw.sns : {}) as ReservationBookSettings['sns'];
  return {
    icalToken: typeof raw.icalToken === 'string' && raw.icalToken ? raw.icalToken : null,
    sns: {
      instagram: typeof sns.instagram === 'string' ? sns.instagram : undefined,
      line: typeof sns.line === 'string' ? sns.line : undefined,
      facebook: typeof sns.facebook === 'string' ? sns.facebook : undefined,
      x: typeof sns.x === 'string' ? sns.x : undefined,
    },
  };
}

export function icalFeedUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/api/ical/reservations/${token}.ics`;
}

// ---------------------------------------------------------------------------
// iCal
// ---------------------------------------------------------------------------

export interface IcalReservation {
  id: string;
  code: string;
  guestName: string;
  partySize: number;
  startAt: string;
  endAt: string;
  status: string;
  tableNames?: string[];
  sourceName?: string | null;
  note?: string | null;
  updatedAt?: string | null;
}

function icsDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** 75 バイトで折り返す（RFC 5545） */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > 73) {
      out.push(cur);
      cur = ' ' + ch;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join('\r\n');
}

const STATUS_LABEL: Record<string, string> = {
  pending: '未確定',
  confirmed: '予約',
  waiting: '来店待ち',
  arrived: '来店',
  seated: '着席',
  billing: '会計',
  completed: '完了',
  cancelled: 'キャンセル',
  no_show: '無断キャンセル',
  waitlisted: 'ウェイティング',
};

/** 台帳の予約を iCal に。Google カレンダーが「URLで追加」で購読できる形 */
export function buildReservationsIcs(storeName: string, rows: IcalReservation[], now: Date = new Date()): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TENPO ONE//Reservations//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${icsEscape(`${storeName} ご予約`)}`),
    'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];
  for (const r of rows) {
    const cancelled = r.status === 'cancelled' || r.status === 'no_show';
    const title = `${cancelled ? '【取消】' : ''}${r.guestName} 様 ${r.partySize}名${r.tableNames?.length ? `（${r.tableNames.join('・')}）` : ''}`;
    const desc = [
      `状態: ${STATUS_LABEL[r.status] ?? r.status}`,
      r.sourceName ? `経路: ${r.sourceName}` : null,
      `予約コード: ${r.code}`,
      r.note ? `メモ: ${r.note}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      fold(`UID:tenpo-one-reservation-${r.id}`),
      `DTSTAMP:${icsDate(r.updatedAt ?? now.toISOString())}`,
      `DTSTART:${icsDate(r.startAt)}`,
      `DTEND:${icsDate(r.endAt)}`,
      fold(`SUMMARY:${icsEscape(title)}`),
      fold(`DESCRIPTION:${icsEscape(desc)}`),
      `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
