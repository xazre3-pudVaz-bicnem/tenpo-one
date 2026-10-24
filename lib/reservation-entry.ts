/**
 * 予約登録（ハンディ・レジ共通）の決まりごと。2026-10-19 Ronnie「レストランボードのように：人数はテンキー、
 * その時間に空いているテーブルと人数にピッタリのテーブル、キーワード、確保時間、予約ステータス、担当者。
 * モバイルだけでなく全部（レジ・PC）で」。
 * ここは画面を持たない計算だけ（テストしやすいように）。
 */

/**
 * キーワード（予約につけるラベル。複数選択）。店舗が自分で登録する（store_settings.settings.reservation_keywords）。
 * 2026-10-24 Ronnie：1 店舗 10 個まで・1 つ 15 文字まで・空白だけや重複は登録しない・前後の空白は削る・削除と並べ替えができる。
 * 誕生日・記念日・子ども連れ・アレルギーは「お客様・予約のタグ」（lib/reservation-tags.ts）の区分に移したので、
 * 店舗がまだ登録していないときの初期値はそれ以外の 8 個。
 */
export const KEYWORD_MAX_COUNT = 10;
export const KEYWORD_MAX_LENGTH = 15;

export const DEFAULT_RESERVATION_KEYWORDS = [
  '当日予約',
  '当日変更',
  '予約確認済',
  'クーポン利用',
  'ポイント利用',
  'デザートプレート',
  '幹事無料',
  '個室希望',
] as const;

/** 要連絡（予約ステータスで選ぶ。キーワードとして予約に残す） */
export const NEEDS_CONTACT_TAG = '要連絡';

/** 文字数（絵文字なども 1 文字として数える） */
export function charCount(s: string): number {
  return Array.from(s).length;
}

/** 店舗のキーワード（登録が無ければ初期値）。前に保存した分が多くても 10 個・15 文字までに収める */
export function reservationKeywordsFrom(settings: unknown): string[] {
  const raw = (settings as { reservation_keywords?: unknown } | null)?.reservation_keywords;
  if (Array.isArray(raw)) {
    const list = [...new Set(raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter((v) => v && charCount(v) <= KEYWORD_MAX_LENGTH))];
    return list.slice(0, KEYWORD_MAX_COUNT);
  }
  return [...DEFAULT_RESERVATION_KEYWORDS];
}

/** 店舗がキーワードを自分で登録したか（したなら、空の一覧も「無し」として扱う） */
export function hasCustomKeywords(settings: unknown): boolean {
  return Array.isArray((settings as { reservation_keywords?: unknown } | null)?.reservation_keywords);
}

/**
 * 店舗のキーワードを保存できる形に確かめる（サーバーでも必ず通す）。
 * 前後の空白を削り、空白だけ・重複は落とす。15 文字を超えるもの・11 個以上はエラー。
 */
export function sanitizeKeywords(raw: unknown): { ok: true; keywords: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'キーワードの形が正しくありません' };
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') return { ok: false, error: 'キーワードの形が正しくありません' };
    const t = v.trim();
    if (!t) continue;
    if (charCount(t) > KEYWORD_MAX_LENGTH) return { ok: false, error: `キーワードは ${KEYWORD_MAX_LENGTH} 文字までです` };
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > KEYWORD_MAX_COUNT) return { ok: false, error: `キーワードは ${KEYWORD_MAX_COUNT} 個までです` };
  return { ok: true, keywords: out };
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
  /**
   * ピッタリ（空いていて、人数が入る卓のうちいちばん余りが少なく、しかも余りが少ない卓）。
   * 2026-10-19 Ronnie「全部の卓にピッタリと出すのではなく、お客様の人数に合う席を出す」→ 2名に6名席はピッタリではない。
   * 余りの目安：席数の 1/3 まで（最低1）。6名席なら4〜6名、4名席なら3〜4名、2名席なら1〜2名。
   */
  best: boolean;
}

/** ピッタリと言える余り（席数の 1/3 まで・最低1） */
export function snugSurplus(capacityMax: number): number {
  return Math.max(1, Math.floor(capacityMax / 3));
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
  for (const c of fitting) {
    const surplus = c.table.capacityMax - input.party;
    if (surplus === minSurplus && surplus <= snugSurplus(c.table.capacityMax)) c.best = true;
  }
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

/* ------------------------------------------------------------------ テーブルをつなげる */

export interface TableCombo {
  ids: string[];
  tables: EntryTable[];
  /** 席数の合計 */
  seats: number;
  floorName: string | null;
  /** 並び（sort_order）がとなりどうし */
  adjacent: boolean;
}

/**
 * 1つのテーブルに入らない人数のとき、つなげて使えるテーブルの組み合わせ（2026-10-19 Ronnie
 * 「10名の予約が来たら1つの席には入らない。この卓とこの卓をつなげればいける、と出す」）。
 * 同じフロアの空いている卓だけ。2卓はどの組み合わせでも、3〜6卓はとなりどうし（並び順が続いている）だけ。
 * 並び：卓の数が少ない → となりどうし → 余りが少ない → 並び順。
 */
export function tableCombos(input: { tables: EntryTable[]; choices: TableChoice[]; party: number; limit?: number }): TableCombo[] {
  const free = new Set(input.choices.filter((c) => c.free).map((c) => c.table.id));
  const floors = new Map<string, EntryTable[]>();
  for (const t of input.tables) {
    const key = t.floorName ?? '';
    floors.set(key, [...(floors.get(key) ?? []), t]);
  }
  const out: (TableCombo & { first: number })[] = [];
  const seen = new Set<string>();
  const push = (list: EntryTable[], idx: number[], adjacent: boolean) => {
    const tables = idx.map((i) => list[i]);
    const seats = tables.reduce((n, t) => n + t.capacityMax, 0);
    if (seats < input.party) return;
    const key = tables.map((t) => t.id).sort().join('+');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ids: tables.map((t) => t.id), tables, seats, floorName: tables[0].floorName, adjacent, first: idx[0] });
  };
  for (const list of floors.values()) {
    // 2卓：どの組み合わせでも
    for (let i = 0; i < list.length; i++) {
      if (!free.has(list[i].id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (!free.has(list[j].id)) continue;
        push(list, [i, j], j === i + 1);
      }
    }
    // 3〜6卓：となりどうしだけ
    for (let i = 0; i < list.length; i++) {
      const idx = [i];
      if (!free.has(list[i].id)) continue;
      for (let j = i + 1; j < list.length && idx.length < 6; j++) {
        if (!free.has(list[j].id)) break;
        idx.push(j);
        if (idx.length >= 3) push(list, [...idx], true);
      }
    }
  }
  return out
    .sort(
      (a, b) =>
        a.tables.length - b.tables.length ||
        Number(b.adjacent) - Number(a.adjacent) ||
        a.seats - b.seats ||
        a.first - b.first
    )
    .slice(0, input.limit ?? 6)
    .map((c) => ({ ids: c.ids, tables: c.tables, seats: c.seats, floorName: c.floorName, adjacent: c.adjacent }));
}
