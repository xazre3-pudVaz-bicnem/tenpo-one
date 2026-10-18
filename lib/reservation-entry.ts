/**
 * 予約登録（ハンディ・レジ共通）の決まりごと。2026-10-19 Ronnie「レストランボードのように：人数はテンキー、
 * その時間に空いているテーブルと人数にピッタリのテーブル、キーワード、確保時間、予約ステータス、担当者。
 * モバイルだけでなく全部（レジ・PC）で」。
 * ここは画面を持たない計算だけ（テストしやすいように）。
 */

/** キーワード（複数選択）。店舗の設定（store_settings.settings.reservation_keywords）が無ければこれ */
export const DEFAULT_RESERVATION_KEYWORDS = [
  '当日予約',
  '当日変更',
  '予約確認済',
  'クーポン利用',
  'ポイント利用',
  '誕生日',
  '記念日',
  'デザートプレート',
  '幹事無料',
  '個室希望',
  '子ども連れ',
  'アレルギーあり',
] as const;

/** 要連絡（予約ステータスで選ぶ。キーワードとして予約に残す） */
export const NEEDS_CONTACT_TAG = '要連絡';

export function reservationKeywordsFrom(settings: unknown): string[] {
  const raw = (settings as { reservation_keywords?: unknown } | null)?.reservation_keywords;
  if (Array.isArray(raw)) {
    const list = [...new Set(raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))];
    if (list.length > 0) return list.slice(0, 40);
  }
  return [...DEFAULT_RESERVATION_KEYWORDS];
}

/** キーワードを保存できる形に（空・重複・長すぎを除く。最大20個） */
export function normalizeTags(tags: readonly string[] | null | undefined): string[] {
  return [...new Set((tags ?? []).map((t) => t.trim().slice(0, 30)).filter(Boolean))].slice(0, 20);
}

/** 登録のときに選ぶ予約ステータス（レストランボードの「来店待ち・仮予約・要連絡」に合わせる） */
export const ENTRY_STATUSES = [
  { value: 'confirmed', label: '来店待ち', hint: '予約確定' },
  { value: 'pending', label: '仮予約', hint: 'あとで確定する' },
  { value: 'needs_contact', label: '要連絡', hint: 'お客様に連絡が必要' },
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number]['value'];

/** 画面のステータス → 予約の status と、足すキーワード（要連絡は仮予約＋「要連絡」） */
export function entryStatusToDb(v: EntryStatus): { status: 'confirmed' | 'pending'; tag: string | null } {
  if (v === 'pending') return { status: 'pending', tag: null };
  if (v === 'needs_contact') return { status: 'pending', tag: NEEDS_CONTACT_TAG };
  return { status: 'confirmed', tag: null };
}

/** 'HH:MM' に分を足す（日をまたぐときは 23:59 で止める） */
export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 確保時間の表示（120 → 2時間、90 → 1時間30分） */
export function stayLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/** 確保時間を動かす（15分〜12時間） */
export function adjustStay(minutes: number, delta: number): number {
  return Math.min(720, Math.max(15, minutes + delta));
}

/* ------------------------------------------------------------------ 空いているテーブル */

export interface EntryTable {
  id: string;
  name: string;
  capacityMin: number;
  capacityMax: number;
  floorName: string | null;
  /** 使用不可（ロック中） */
  locked: boolean;
  /** いまお客様が座っている（伝票が開いている） */
  inUse: boolean;
}

/** その日の予約（キャンセル・無断キャンセル・会計済み以外）の時間と卓 */
export interface BookedSpan {
  /** 予約の id（テーブル変更のとき自分の予約を除くため） */
  id?: string;
  start: string;
  end: string;
  tableIds: string[];
}

export type TableFit = 'just' | 'ok' | 'big' | 'small';

export interface TableChoice {
  table: EntryTable;
  free: boolean;
  /** 空いていない理由 */
  reason: '予約あり' | '使用中' | '使用不可' | null;
  fit: TableFit;
  /** ピッタリ（空いていて、人数が入る卓のうちいちばん余りが少ない） */
  best: boolean;
}

/**
 * date の time から stay 分のあいだ、どの卓が空いているか・人数に合うか。
 * 並び：空いている卓（ピッタリ → 人数が入る卓を余りの少ない順 → 大きすぎる卓 → 小さい卓）→ 空いていない卓。
 * 今日で、いま座っているお客様がいる卓は、始まりが今から stay 分以内なら「使用中」。
 */
export function tableChoices(input: {
  tables: EntryTable[];
  booked: BookedSpan[];
  date: string;
  time: string;
  stayMinutes: number;
  party: number;
  today: string;
  nowMs: number;
  /** テーブル変更のとき、この予約自身は数えない */
  excludeReservationId?: string;
}): TableChoice[] {
  const start = Date.parse(`${input.date}T${input.time}:00+09:00`);
  const end = start + input.stayMinutes * 60000;
  const busy = new Set<string>();
  for (const b of input.booked) {
    if (input.excludeReservationId && b.id === input.excludeReservationId) continue;
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    if (s < end && start < e) for (const id of b.tableIds) busy.add(id);
  }
  const nearNow = input.date === input.today && start < input.nowMs + input.stayMinutes * 60000;

  const fitOf = (t: EntryTable): TableFit => {
    if (input.party > t.capacityMax) return 'small';
    if (input.party < t.capacityMin) return 'big';
    return 'ok';
  };
  const list: TableChoice[] = input.tables.map((t) => {
    const reason: TableChoice['reason'] = t.locked ? '使用不可' : busy.has(t.id) ? '予約あり' : nearNow && t.inUse ? '使用中' : null;
    return { table: t, free: reason === null, reason, fit: fitOf(t), best: false };
  });

  const fitting = list.filter((c) => c.free && c.fit === 'ok');
  const minSurplus = Math.min(...fitting.map((c) => c.table.capacityMax - input.party));
  for (const c of fitting) if (c.table.capacityMax - input.party === minSurplus) c.best = true;
  for (const c of list) if (c.best) c.fit = 'just';

  const rank = (c: TableChoice) => (!c.free ? 4 : c.fit === 'just' ? 0 : c.fit === 'ok' ? 1 : c.fit === 'big' ? 2 : 3);
  return list
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        rank(a.c) - rank(b.c) ||
        (a.c.fit === 'ok' && b.c.fit === 'ok' ? a.c.table.capacityMax - b.c.table.capacityMax : 0) ||
        a.i - b.i
    )
    .map((x) => x.c);
}

/** 選んだ卓の席数の合計 */
export function seatsOf(tables: EntryTable[], ids: readonly string[]): number {
  return tables.filter((t) => ids.includes(t.id)).reduce((sum, t) => sum + t.capacityMax, 0);
}
