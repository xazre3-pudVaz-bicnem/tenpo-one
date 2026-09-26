/**
 * グルメサイト連携（メール取り込み）— 純粋な部分（サイト一覧・メールの判定・本文の読み取り）。
 * 2026-09-27 Ronnie「日本の全部のグルメサイトとつながる予約台帳。新規・変更・キャンセルが自動で入るように」。
 *
 * 仕組み（レストランボード・TableCheck と同じ「メール取り込み」方式）:
 *   1. 店舗ごとに取り込み専用メールアドレス（rsv-<token>@<ドメイン>）を出す
 *   2. 各グルメサイトの店舗管理画面で、予約通知メールの送り先にそのアドレスを登録する
 *   3. 届いたメール（新規・変更・キャンセル）をサーバーで読んで、ご予約台帳に自動で入れる
 * ここは DB・React に依存しない（テスト対象）。DB へ書くのは lib/gourmet-mail-server.ts。
 */

export type GourmetSiteKey =
  | 'tabelog'
  | 'hotpepper'
  | 'gurunavi'
  | 'ikyu'
  | 'retty'
  | 'ozmall'
  | 'hitosara'
  | 'yahoo_line'
  | 'google'
  | 'tablecheck'
  | 'omakase'
  | 'other';

export interface GourmetSite {
  key: GourmetSiteKey;
  name: string;
  en: string;
  /** 送信元のドメイン（From で判定） */
  domains: string[];
  /** 件名・本文にこの語があればこのサイト（From で分からないとき） */
  keywords: string[];
  /** 店舗管理画面（設定手順のリンク） */
  adminUrl: string | null;
  /** reservation_sources.code（予約経路） */
  sourceCode: string;
  /** 設定手順（店舗管理画面のどこで通知メールの送り先を登録するか） */
  howTo: string;
}

export const GOURMET_SITES: GourmetSite[] = [
  {
    key: 'tabelog', name: '食べログ', en: 'Tabelog', domains: ['tabelog.com'], keywords: ['食べログ', 'tabelog'],
    adminUrl: 'https://owner.tabelog.com/', sourceCode: 'tabelog',
    howTo: '食べログ店舗管理画面 →「ネット予約」→「予約通知メールの設定」で、通知先メールアドレスに取り込み専用アドレスを追加します。',
  },
  {
    key: 'hotpepper', name: 'ホットペッパーグルメ', en: 'HOT PEPPER', domains: ['hotpepper.jp', 'recruit.co.jp', 'hpg.jp'], keywords: ['ホットペッパー', 'hotpepper', 'HOT PEPPER'],
    adminUrl: 'https://www.cms.hotpepper.jp/', sourceCode: 'hotpepper',
    howTo: 'ホットペッパー グルメ店舗管理画面 →「ネット予約」→「予約通知先メールアドレス」に取り込み専用アドレスを追加します。',
  },
  {
    key: 'gurunavi', name: 'ぐるなび', en: 'Gurunavi', domains: ['gnavi.co.jp'], keywords: ['ぐるなび', 'gnavi'],
    adminUrl: 'https://pro.gnavi.co.jp/', sourceCode: 'gurunavi',
    howTo: 'ぐるなびPRO →「予約設定」→「予約受付メールアドレス」に取り込み専用アドレスを追加します。',
  },
  {
    key: 'ikyu', name: '一休.com・PayPayグルメ', en: 'Ikyu / PayPay Gourmet', domains: ['ikyu.com', 'paypay-gourmet.yahoo.co.jp'], keywords: ['一休', 'ikyu', 'PayPayグルメ'],
    adminUrl: 'https://restaurant.ikyu.com/manager/', sourceCode: 'ikyu',
    howTo: '一休.comレストラン 管理画面 →「店舗設定」→「予約通知メール」に取り込み専用アドレスを追加します。',
  },
  {
    key: 'retty', name: 'Retty', en: 'Retty', domains: ['retty.me', 'retty.co.jp'], keywords: ['Retty'],
    adminUrl: 'https://retty.me/', sourceCode: 'retty',
    howTo: 'Retty 店舗管理画面 →「予約設定」→「通知メールアドレス」に取り込み専用アドレスを追加します。',
  },
  {
    key: 'ozmall', name: 'OZmall', en: 'OZmall', domains: ['ozmall.co.jp', 'starts-pub.jp'], keywords: ['OZmall', 'オズモール'],
    adminUrl: 'https://www.ozmall.co.jp/', sourceCode: 'ozmall',
    howTo: 'OZmall 店舗管理画面 →「予約通知設定」に取り込み専用アドレスを追加します（担当者に依頼する場合もあります）。',
  },
  {
    key: 'hitosara', name: 'ヒトサラ', en: 'Hitosara', domains: ['hitosara.com'], keywords: ['ヒトサラ', 'hitosara'],
    adminUrl: 'https://hitosara.com/', sourceCode: 'hitosara',
    howTo: 'ヒトサラ 店舗管理画面 →「予約通知メール」に取り込み専用アドレスを追加します。',
  },
  {
    key: 'yahoo_line', name: 'Yahoo!リザベーション・LINEで予約', en: 'Yahoo! / LINE', domains: ['yahoo.co.jp', 'line.me', 'linecorp.com', 'lycorp.co.jp'], keywords: ['Yahoo!リザベーション', 'LINEで予約', 'Yahoo!ロコ'],
    adminUrl: 'https://reservation.yahoo.co.jp/', sourceCode: 'yahoo_line',
    howTo: 'Yahoo!リザベーションマネージャー →「通知設定」に取り込み専用アドレスを追加します（LINEで予約も同じ管理画面）。',
  },
  {
    key: 'google', name: 'Googleで予約', en: 'Reserve with Google', domains: ['google.com'], keywords: ['Google で予約', 'Googleで予約', 'Reserve with Google'],
    adminUrl: 'https://business.google.com/', sourceCode: 'google',
    howTo: 'Google ビジネスプロフィール →「予約」の通知先に取り込み専用アドレスを追加します。',
  },
  {
    key: 'tablecheck', name: 'TableCheck', en: 'TableCheck', domains: ['tablecheck.com'], keywords: ['TableCheck', 'テーブルチェック'],
    adminUrl: 'https://manager.tablecheck.com/', sourceCode: 'tablecheck',
    howTo: 'TableCheck 管理画面 →「通知」→ 予約通知メールの送り先に取り込み専用アドレスを追加します。',
  },
  {
    key: 'omakase', name: 'OMAKASE', en: 'OMAKASE', domains: ['omakase.in'], keywords: ['OMAKASE'],
    adminUrl: 'https://omakase.in/', sourceCode: 'omakase',
    howTo: 'OMAKASE 店舗管理画面 →「通知メール」に取り込み専用アドレスを追加します。',
  },
  {
    key: 'other', name: 'その他のサイト・転送メール', en: 'Other / forwarded', domains: [], keywords: [],
    adminUrl: null, sourceCode: 'gourmet_site',
    howTo: '上にないサイトは、予約通知メールを取り込み専用アドレスへ転送（Gmail の自動転送など）すると取り込めます。',
  },
];

export const GOURMET_SITE_BY_KEY: Record<GourmetSiteKey, GourmetSite> = Object.fromEntries(
  GOURMET_SITES.map((s) => [s.key, s])
) as Record<GourmetSiteKey, GourmetSite>;

/** 店舗ごとの設定（store_settings.settings.gourmetMail） */
export interface GourmetMailSiteState {
  /** 店舗が「このサイトの管理画面に登録した」と印を付けた時刻 */
  enabledAt?: string | null;
  /** そのサイトからメールが初めて届いた（認証できた）時刻 */
  verifiedAt?: string | null;
  /** 最後に取り込んだ時刻と種類 */
  lastImportAt?: string | null;
  lastKind?: MailKind | null;
}
export interface GourmetMailSettings {
  enabled: boolean;
  /** 取り込み専用アドレスの token（rsv-<token>@ドメイン） */
  token: string | null;
  sites: Partial<Record<GourmetSiteKey, GourmetMailSiteState>>;
}

export function gourmetMailSettingsFrom(settings: Record<string, unknown> | null | undefined): GourmetMailSettings {
  const raw = (settings?.gourmetMail ?? {}) as Partial<GourmetMailSettings>;
  return {
    enabled: raw.enabled === true,
    token: typeof raw.token === 'string' && raw.token ? raw.token : null,
    sites: (raw.sites && typeof raw.sites === 'object' ? raw.sites : {}) as GourmetMailSettings['sites'],
  };
}

/** 取り込み専用アドレス */
export function gourmetImportAddress(token: string, domain: string): string {
  return `rsv-${token}@${domain}`;
}

/** 宛先（To/Cc/Delivered-To など）から token を取り出す */
export function tokenFromRecipient(recipients: string | string[] | null | undefined): string | null {
  const list = Array.isArray(recipients) ? recipients : [recipients ?? ''];
  for (const r of list) {
    const m = /rsv-([a-z0-9]{10,40})@/i.exec(r ?? '');
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export type MailKind = 'new' | 'change' | 'cancel' | 'verify' | 'unknown';

/** From・件名・本文からサイトを判定 */
export function detectSite(from: string | null | undefined, subject: string, body: string): GourmetSiteKey {
  const f = (from ?? '').toLowerCase();
  for (const s of GOURMET_SITES) {
    if (s.domains.some((d) => f.includes('@' + d) || f.endsWith('.' + d) || f.includes('.' + d + '>') || f.includes('@' + d + '>'))) return s.key;
  }
  const hay = `${subject}\n${body.slice(0, 2000)}`;
  for (const s of GOURMET_SITES) {
    if (s.keywords.some((k) => hay.toLowerCase().includes(k.toLowerCase()))) return s.key;
  }
  return 'other';
}

/** 件名・本文から「新規・変更・キャンセル・認証」を判定 */
export function detectKind(subject: string, body: string): MailKind {
  const s = subject;
  const head = body.slice(0, 600);
  if (/キャンセル|取消|取り消し|cancel/i.test(s) || /(予約|ご予約)(が|は)?キャンセル/.test(head)) return 'cancel';
  if (/変更|modif|change|update/i.test(s) || /(予約|ご予約)(内容)?(が|は)?変更/.test(head)) return 'change';
  if (/(新規|新しい|新たな)?(ご)?予約(が|の)?(入り|受付|受け付け|確定|成立|通知|お知らせ|あり)|new reservation|reservation (confirmed|received)/i.test(s)) return 'new';
  if (/(登録|認証|確認|設定)(完了|のお願い|してください|用)|verify|confirm(ation)? (your )?email|メールアドレス(の)?(確認|認証|登録)/i.test(s)) return 'verify';
  // 本文に来店日と人数があれば予約とみなす
  if (extractDateTime(body) && extractParty(body) != null) return 'new';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// 本文の読み取り
// ---------------------------------------------------------------------------

/** 全角の数字・記号を半角に、HTML なら文字だけに */
export function normalizeMailText(text: string | null | undefined, html?: string | null): string {
  let t = (text && text.trim()) ? text : htmlToText(html ?? '');
  t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  t = t.replace(/[：]/g, ':').replace(/[／]/g, '/').replace(/[－ー−]/g, (c) => (c === 'ー' ? 'ー' : '-')).replace(/[（]/g, '(').replace(/[）]/g, ')');
  t = t.replace(/\r\n?/g, '\n').replace(/[ \t　]+/g, ' ');
  return t;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export interface ParsedDateTime {
  /** YYYY-MM-DD（日本時間） */
  date: string;
  /** HH:MM。無ければ null */
  time: string | null;
}

const DATE_LABEL = /(来店日時|ご来店日時|予約日時|ご予約日時|来店日|ご来店日|予約日|ご予約日|日時|来店予定|利用日|ご利用日|Date)/;

/**
 * 来店日時。ラベルの近くの「2026年10月3日(金) 19:00」「2026/10/03 19:00」「10月3日 19時30分」を読む。
 * 年が無ければ「今日以降で一番近いその日付」（now を渡す。テスト用）。
 */
export function extractDateTime(body: string, now: Date = new Date()): ParsedDateTime | null {
  const lines = body.split('\n');
  const candidates: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (DATE_LABEL.test(lines[i])) {
      candidates.push(lines[i] + ' ' + (lines[i + 1] ?? ''));
    }
  }
  candidates.push(body);
  for (const c of candidates) {
    const r = parseDateTimeText(c, now);
    if (r) return r;
  }
  return null;
}

function parseDateTimeText(text: string, now: Date): ParsedDateTime | null {
  // 2026年10月3日 / 2026/10/03 / 2026-10-03
  let m = /(20\d{2})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})\s*日?/.exec(text);
  let y: number;
  let mo: number;
  let d: number;
  let rest: string;
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
    rest = text.slice(m.index + m[0].length);
  } else {
    // 10月3日 / 10/3（年なし）
    m = /(?:^|[^\d])(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?(?![\d:])/.exec(text);
    if (!m) return null;
    mo = Number(m[1]);
    d = Number(m[2]);
    const jstNow = new Date(now.getTime() + 9 * 3600 * 1000);
    y = jstNow.getUTCFullYear();
    const cand = Date.UTC(y, mo - 1, d);
    const today = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate());
    if (cand < today - 24 * 3600 * 1000) y += 1;
    rest = text.slice(m.index + m[0].length);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 時刻: 19:00 / 19時00分 / 19時 / 19:00~21:00 の最初
  const t = /(\d{1,2})\s*(?::|時)\s*(\d{2})?\s*分?/.exec(rest.slice(0, 40));
  let time: string | null = null;
  if (t) {
    const hh = Number(t[1]);
    const mm = t[2] ? Number(t[2]) : 0;
    if (hh >= 0 && hh <= 29 && mm >= 0 && mm <= 59) time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, time };
}

/** 人数（「4名」「4名様」「人数: 4」「4人」） */
export function extractParty(body: string): number | null {
  const near = /(人数|ご人数|名様|来店人数|ご来店人数|Guests?|Party)[^\d\n]{0,12}(\d{1,3})/i.exec(body);
  if (near) return clampParty(Number(near[2]));
  const m = /(\d{1,3})\s*(名様|名|人)(?![\dー])/.exec(body);
  if (m) return clampParty(Number(m[1]));
  return null;
}
function clampParty(n: number): number | null {
  return n >= 1 && n <= 200 ? n : null;
}

/** ラベルの右（同じ行、無ければ次の行）の値 */
export function valueAfterLabel(body: string, labels: RegExp): string | null {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = labels.exec(line);
    if (!m) continue;
    const same = line.slice(m.index + m[0].length).replace(/^[\s:：】\]]+/, '').trim();
    if (same) return same;
    const next = (lines[i + 1] ?? '').trim();
    if (next) return next;
  }
  return null;
}

export function extractGuestName(body: string): string | null {
  const v = valueAfterLabel(body, /(お名前|ご予約者名|予約者名|予約者|ご予約者|お客様名|氏名|ご氏名|代表者名?|Name)\s*(\(.*?\))?\s*[:：]?/);
  if (!v) return null;
  return v.replace(/\s*(様|さま|殿)\s*$/, '').replace(/\(.*?\)$/, '').trim().slice(0, 60) || null;
}

export function extractPhone(body: string): string | null {
  const v = valueAfterLabel(body, /(電話番号|お電話番号|電話|TEL|Tel|Phone)\s*[:：]?/);
  const src = v ?? body;
  const m = /(0\d{1,4})[-\s]?(\d{1,4})[-\s]?(\d{3,4})/.exec(src) ?? /(\+81[\d\s-]{9,14})/.exec(src);
  if (!m) return null;
  return m[0].replace(/\s+/g, '').slice(0, 20);
}

export function extractExternalId(body: string, subject: string): string | null {
  const v = valueAfterLabel(body, /(予約番号|ご予約番号|受付番号|予約ID|予約No\.?|予約コード|Reservation (ID|No\.?)|Booking (ID|No\.?))\s*[:：]?/i);
  const src = v ?? subject;
  const m = /[A-Za-z0-9][A-Za-z0-9\-]{3,30}/.exec(src);
  return m ? m[0] : null;
}

export function extractCourse(body: string): string | null {
  const v = valueAfterLabel(body, /(コース名|コース|プラン名|プラン|メニュー|Course|Plan)\s*[:：]?/);
  if (!v) return null;
  const s = v.trim().slice(0, 120);
  return s && !/^(なし|無し|-|—|指定なし)$/.test(s) ? s : null;
}

export function extractRequest(body: string): string | null {
  const v = valueAfterLabel(body, /(ご要望|要望|備考|メッセージ|ご希望|リクエスト|Request|Note)\s*[:：]?/);
  if (!v) return null;
  const s = v.trim().slice(0, 300);
  return s && !/^(なし|無し|-|—|特になし)$/.test(s) ? s : null;
}

/** 本文の URL（認証メールの「このリンクを開いて認証」用。最大 5 件） */
export function extractLinks(text: string | null | undefined, html?: string | null): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    const clean = u.replace(/[)\]>"'。、」]+$/g, '');
    if (/^https?:\/\//i.test(clean) && !out.includes(clean) && out.length < 5) out.push(clean);
  };
  for (const m of (html ?? '').matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) push(m[1]);
  for (const m of (text ?? '').matchAll(/https?:\/\/[^\s<>"]+/g)) push(m[0]);
  return out;
}

export interface ParsedGourmetMail {
  site: GourmetSiteKey;
  kind: MailKind;
  /** 本文のリンク（認証メールはここのリンクを開くと登録が完了する） */
  links: string[];
  externalId: string | null;
  date: string | null;
  time: string | null;
  partySize: number | null;
  guestName: string | null;
  phone: string | null;
  course: string | null;
  request: string | null;
  /** 台帳に自動で入れられるだけ読めたか（日付・時刻・人数・名前） */
  complete: boolean;
}

export function parseGourmetMail(
  input: { from?: string | null; subject?: string | null; text?: string | null; html?: string | null },
  now: Date = new Date()
): ParsedGourmetMail {
  const subject = (input.subject ?? '').trim();
  const body = normalizeMailText(input.text, input.html);
  const site = detectSite(input.from, subject, body);
  const kind = detectKind(subject, body);
  const dt = extractDateTime(body, now);
  const partySize = extractParty(body);
  const guestName = extractGuestName(body);
  const phone = extractPhone(body);
  const complete = !!dt?.date && !!dt.time && partySize != null && !!guestName;
  return {
    site,
    kind,
    links: extractLinks(input.text, input.html),
    externalId: extractExternalId(body, subject),
    date: dt?.date ?? null,
    time: dt?.time ?? null,
    partySize,
    guestName,
    phone,
    course: extractCourse(body),
    request: extractRequest(body),
    complete,
  };
}

/** 日本時間の日付・時刻 → ISO（UTC） */
export function jstToIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  // 24:00 以上（深夜）は翌日の早朝
  const utc = Date.UTC(y, m - 1, d, hh - 9, mm);
  return new Date(utc).toISOString();
}

export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  new: '新規予約',
  change: '予約変更',
  cancel: 'キャンセル',
  verify: 'メール認証',
  unknown: '判別できず',
};
