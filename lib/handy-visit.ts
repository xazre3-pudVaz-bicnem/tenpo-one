/**
 * ハンディの「お客様情報」画面（承認済みレイアウト 2026-09-21 の setup）。
 *
 * モード（アラカルト／飲み放題／食べ放題／食べ飲み放題／コース）・人数（男女）・利用シーン・
 * 時間制は、DB にそのままの列が無いものは予約（reservations.purpose / end_at）と
 * 伝票のメモ（orders.memo）に残す。ここは純粋な定義と検証だけ（DB・Next 非依存・テスト対象）。
 */

export type HandyPlan = 'normal' | 'drink' | 'buffet' | 'food' | 'course';

export const HANDY_PLANS: readonly { id: HandyPlan; name: string }[] = [
  { id: 'normal', name: 'アラカルト' },
  { id: 'drink', name: '飲み放題' },
  { id: 'buffet', name: '食べ放題' },
  { id: 'food', name: '食べ飲み放題' },
  { id: 'course', name: 'コース' },
];

/**
 * 来店経路（お客様がどこから来たか）。2026-09-24 店舗要望で「利用シーン」から置き換えた。
 * 日本で連携できる主な予約サイトをひととおり、人気順に並べてある（2026-09-24 店舗要望）。
 * 色は全部そろえる。店舗で使わない経路は 設定 > レジ から外せる。
 * code は `reservation_sources.code` に合わせてあり、行があれば予約の経路として記録する
 * （無ければラベルを伝票メモ・予約の目的に残すので、集計から漏れない）。
 */
export interface VisitSource {
  id: string;
  label: string;
  /** reservation_sources.code の候補（先に見つかったものを使う） */
  codes: readonly string[];
}

export const VISIT_SOURCES: readonly VisitSource[] = [
  // 既定で出すもの（この12個。2026-09-24 店舗要望）
  { id: 'free', label: 'Walk in', codes: ['walk_in', 'free'] },
  { id: 'phone', label: '当日電話', codes: ['phone', 'tel'] },
  { id: 'tabelog', label: '食べログ', codes: ['tabelog'] },
  { id: 'hotpepper', label: 'ホットペッパー', codes: ['hotpepper', 'hpg'] },
  { id: 'gurunavi', label: 'ぐるなび', codes: ['gurunavi', 'gnavi'] },
  { id: 'retty', label: 'Retty', codes: ['retty'] },
  { id: 'google', label: 'Google', codes: ['google'] },
  { id: 'website', label: 'ホームページ', codes: ['web', 'own_site'] },
  { id: 'sns', label: 'SNS', codes: ['sns'] },
  { id: 'line', label: 'LINE', codes: ['line'] },
  { id: 'catch', label: 'CATCH', codes: ['catch'] },
  { id: 'other', label: 'その他', codes: ['other'] },
  // ここから下は既定では出さない。設定 > レジ > 来店経路 で足せる
  { id: 'ikyu', label: '一休', codes: ['ikyu'] },
  { id: 'ozmall', label: 'OZmall', codes: ['ozmall', 'oz'] },
  { id: 'epark', label: 'EPARK', codes: ['epark'] },
  { id: 'hitosara', label: 'ヒトサラ', codes: ['hitosara'] },
  { id: 'tablecheck', label: 'TableCheck', codes: ['tablecheck'] },
  { id: 'toreta', label: 'トレタ', codes: ['toreta'] },
  { id: 'ebica', label: 'ebica', codes: ['ebica'] },
  { id: 'instagram', label: 'Instagram', codes: ['instagram', 'ig'] },
  { id: 'repeat', label: 'リピート', codes: ['repeat'] },
] as const;

/** 設定しなければ出す12個（お客様情報のボタン） */
export const DEFAULT_VISIT_SOURCE_IDS: readonly string[] = [
  'free',
  'phone',
  'tabelog',
  'hotpepper',
  'gurunavi',
  'retty',
  'google',
  'website',
  'sns',
  'line',
  'catch',
  'other',
];

/**
 * 店舗で使う来店経路（店舗設定 store_settings.settings.visitSources）。
 * 設定が無い店は既定の12個。並びは VISIT_SOURCES の順を保つ。
 */
export function visitSourcesFrom(settings: unknown): readonly VisitSource[] {
  const raw = (settings as { visitSources?: unknown } | null)?.visitSources;
  const on = new Set(
    Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : DEFAULT_VISIT_SOURCE_IDS
  );
  const kept = VISIT_SOURCES.filter((s) => on.has(s.id));
  // 全部外してしまった店は、選べなくならないように既定の12個を出す
  return kept.length > 0 ? kept : VISIT_SOURCES.filter((s) => DEFAULT_VISIT_SOURCE_IDS.includes(s.id));
}

/** 既定で出す来店経路（画面が sources を渡さなかったときの保険） */
export const DEFAULT_VISIT_SOURCES: readonly VisitSource[] = VISIT_SOURCES.filter((s) =>
  DEFAULT_VISIT_SOURCE_IDS.includes(s.id)
);

/** 設定に保存する形（知らないIDは捨てる） */
export function normalizeVisitSourceIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const known = new Set(VISIT_SOURCES.map((s) => s.id));
  return VISIT_SOURCES.filter((s) => ids.includes(s.id) && known.has(s.id)).map((s) => s.id);
}

export const VISIT_SOURCE_LABELS: readonly string[] = VISIT_SOURCES.map((s) => s.label);

export function visitSourceByLabel(label: string): VisitSource | null {
  return VISIT_SOURCES.find((s) => s.label === label) ?? null;
}

/* ------------------------------------------- 時間ピッカー（時間制・終了前注意） */

/**
 * 時間制・終了前注意は「時間」ボタン（0〜3時間）と「分」ボタン（0/15/30/45分）を1つずつ選んで
 * 「設定」する。ボタンに無い長さ（4時間・10分など）は「カスタム」で時間と分を入力する
 * （2026-09-21 Ronnie が送ったスクショの操作。デザインはハンディの他の画面に合わせる）。
 */
export const HOUR_CHOICES: readonly number[] = [0, 1, 2, 3];
export const MINUTE_CHOICES: readonly number[] = [0, 15, 30, 45];

/** 席時間（時間制）の範囲（分）。startWalkIn が受け付ける滞在時間（15〜480分）と同じ */
export const DURATION_MIN_MINUTES = 15;
export const DURATION_MAX_MINUTES = 480;

/** カスタム入力の「時間」の上限（席時間の上限と同じ8時間） */
export const CUSTOM_MAX_HOURS = DURATION_MAX_MINUTES / 60;

/** 分を「時間」と「分」に分ける（135 → 2時間・15分）。読めない値・マイナスは0 */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const t = Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0;
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}

/** 「時間」「分」のボタンだけで選べる長さか（選べなければピッカーをカスタム入力で開く） */
export function isButtonMinutes(total: number): boolean {
  if (!Number.isInteger(total) || total < 0) return false;
  const { hours, minutes } = splitMinutes(total);
  return HOUR_CHOICES.includes(hours) && MINUTE_CHOICES.includes(minutes);
}

/** ボタンに無い長さを、ボタンで選べるいちばん近い下の値に寄せる（カスタムからボタンに戻したとき） */
export function nearestButtonParts(total: number): { hours: number; minutes: number } {
  const { hours, minutes } = splitMinutes(total);
  return {
    hours: Math.min(hours, HOUR_CHOICES[HOUR_CHOICES.length - 1]),
    minutes: MINUTE_CHOICES.filter((m) => m <= minutes).pop() ?? 0,
  };
}

/** 全角数字を半角にする（日本語キーボードのまま入力されたとき用） */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * カスタム入力（時間・分）を分に直す。空欄は0。
 * 数字でない・マイナス・小数・分が60以上・時間が上限（8時間）超えは null。
 */
export function parseCustomMinutes(hoursText: string, minutesText: string): number | null {
  const read = (s: string): number | null => {
    const t = toHalfWidthDigits(s).trim();
    if (t === '') return 0;
    return /^\d{1,3}$/.test(t) ? Number(t) : null;
  };
  const h = read(hoursText);
  const m = read(minutesText);
  if (h === null || m === null || m > 59 || h > CUSTOM_MAX_HOURS) return null;
  return h * 60 + m;
}

/** 席時間として使えない理由。使えれば null */
export function durationProblem(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes < DURATION_MIN_MINUTES || minutes > DURATION_MAX_MINUTES) {
    return `席時間は${durationLabel(DURATION_MIN_MINUTES)}〜${durationLabel(DURATION_MAX_MINUTES)}で設定してください`;
  }
  return null;
}

/**
 * 終了前注意として使えない理由。使えれば null。
 * 席時間より短くないと意味がない（2時間制で「2時間前」は着席した瞬間になる）。
 */
export function warningProblem(minutes: number, duration: number): string | null {
  if (!Number.isInteger(minutes) || minutes < 1) return '終了前注意の時間を設定してください';
  if (minutes >= duration) {
    return `終了前注意は席時間（${durationLabel(duration)}）より短くしてください`;
  }
  return null;
}

/** 人数の上限（startWalkIn・orders.guest_count の制約と同じ 999） */
export const MAX_GUESTS = 999;

export function planName(plan: HandyPlan): string {
  return HANDY_PLANS.find((p) => p.id === plan)?.name ?? 'アラカルト';
}

/** 120 → 2時間、90 → 1時間30分、45 → 45分 */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/** モードごとに「プラン商品」（コース・飲み放題などの menu_items）を選べるか（アラカルト以外） */
export function planHasItems(plan: HandyPlan): boolean {
  return plan !== 'normal';
}

/** 選んだモードの名前（「飲み放題・アラカルト」のように並べる） */
export function planNames(plans: readonly HandyPlan[]): string {
  if (plans.length === 0) return '未選択';
  return plans.map(planName).join('・');
}

/** 選んだモードのどれかがプラン商品（コース・飲み放題など）を持つか */
export function plansHaveItems(plans: readonly HandyPlan[]): boolean {
  return plans.some(planHasItems);
}

export interface VisitDraft {
  /**
   * モード（何個でも選べる。2026-09-24 店舗要望）。
   * 例: 飲み放題＋アラカルト、食べ放題＋単品ドリンク、飲み放題Bだけ。
   */
  plans: HandyPlan[];
  /** 選んだプラン商品（menu_items.id）。何個でも入れられる */
  planItemIds: string[];
  male: number;
  female: number;
  /** 来店経路（VISIT_SOURCES のラベル）。未選択は '' */
  source: string;
  timed: boolean;
  /** 席時間（分）。timed のときだけ使う */
  duration: number;
  warningEnabled: boolean;
  warningMinutes: number;
  /** 開始時間（'HH:MM'・日本時間）。null は「今」＝確定した時刻 */
  startTime: string | null;
}

export const DEFAULT_VISIT_DRAFT: VisitDraft = {
  plans: ['normal'],
  planItemIds: [],
  male: 0,
  female: 0,
  source: '',
  timed: false,
  duration: 120,
  warningEnabled: true,
  warningMinutes: 30,
  startTime: null,
};

/** 確定できない理由（現場向けの日本語）。確定できれば null */
export function validateVisitDraft(d: VisitDraft): string | null {
  if (!Number.isInteger(d.male) || !Number.isInteger(d.female) || d.male < 0 || d.female < 0) {
    return '人数を確認してください';
  }
  const guests = d.male + d.female;
  if (guests < 1 || guests > MAX_GUESTS) return `合計人数を1〜${MAX_GUESTS}名で入力してください`;
  if (!d.source || !VISIT_SOURCE_LABELS.includes(d.source)) {
    return '来店経路を選択してください';
  }
  if (d.timed) {
    const durationIssue = durationProblem(d.duration);
    if (durationIssue) return durationIssue;
    if (d.warningEnabled) {
      const warningIssue = warningProblem(d.warningMinutes, d.duration);
      if (warningIssue) return warningIssue;
    }
  }
  if (d.plans.length === 0 || d.plans.some((p) => !HANDY_PLANS.some((h) => h.id === p))) {
    return 'モードを選択してください';
  }
  // 範囲（12時間前〜今）は時刻で変わるので、選ぶ画面とサーバー（startWalkIn）で見る。ここでは形だけ
  if (d.startTime !== null && !isStartHm(d.startTime)) return '開始時間を選び直してください';
  return null;
}

/* ------------------------------------------------------------ 開始時間 */

/**
 * 開始時間（2026-09-21 Ronnie「開始時間を編集できるように」）。
 * 席に着いてからハンディで入力するまでに時間がたったとき、実際に来店した時刻に直す。
 * 伝票の開始時刻（経過時間）と、時間制の終了予定（開始＋席時間）がこの時刻からになる。
 */

/** 開始時間として選べる範囲：12時間前〜今。スマホとサーバーの時計のずれは5分まで許す */
export const START_MAX_PAST_MINUTES = 12 * 60;
export const START_FUTURE_TOLERANCE_MINUTES = 5;

const START_HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, '0');

export function isStartHm(value: unknown): value is string {
  return typeof value === 'string' && START_HM.test(value);
}

/** 日本時間の 'HH:MM' */
export function jstHm(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 今から minutes 分前の 'HH:MM'（日本時間） */
export function minutesAgoHm(nowMs: number, minutes: number): string {
  return jstHm(nowMs - minutes * 60_000);
}

/**
 * 'HH:MM'（日本時間）を、いまに一番近い過去の日時（ms）にする。
 * 今日のその時刻が「今＋5分」より後なら前日（例: 0時30分に 23:50 → 前日の23:50）。読めなければ null。
 */
export function resolveStartTime(hm: string, nowMs: number): number | null {
  if (!isStartHm(hm)) return null;
  const [h, m] = hm.split(':').map(Number);
  const today = new Date(nowMs + JST_OFFSET_MS);
  let t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h, m) - JST_OFFSET_MS;
  if (t > nowMs + START_FUTURE_TOLERANCE_MINUTES * 60_000) t -= 24 * 60 * 60_000;
  return t;
}

/** 開始時間として使えない理由。null（今）は常に使える */
export function startTimeProblem(hm: string | null, nowMs: number): string | null {
  if (hm === null) return null;
  const t = resolveStartTime(hm, nowMs);
  if (t === null) return '開始時間を選び直してください';
  if (nowMs - t > START_MAX_PAST_MINUTES * 60_000) {
    return '開始時間は12時間前から今までの間で選んでください';
  }
  return null;
}

/** カスタム入力（時・分）を 'HH:MM' にする。空欄は0。読めなければ null（全角数字も読む） */
export function parseCustomHm(hoursText: string, minutesText: string): string | null {
  const read = (v: string): number | null => {
    const t = toHalfWidthDigits(v).trim();
    if (t === '') return 0;
    return /^\d{1,2}$/.test(t) ? Number(t) : null;
  };
  const h = read(hoursText);
  const m = read(minutesText);
  if (h === null || m === null || h > 23 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * 伝票メモに残す文（レジ・レシートの「メモ」で見える）。
 * 例: ハンディ: 飲み放題 / 男2・女1 / 食べログご予約 / 2時間制（30分前に声かけ）
 */
export function visitMemo(
  d: Pick<
    VisitDraft,
    'plans' | 'male' | 'female' | 'source' | 'timed' | 'duration' | 'warningEnabled' | 'warningMinutes'
  >
): string {
  const parts = [planNames(d.plans), `男${d.male}・女${d.female}`];
  if (d.source) parts.push(String(d.source));
  if (d.timed) {
    parts.push(
      `${durationLabel(d.duration)}制${d.warningEnabled ? `（${durationLabel(d.warningMinutes)}前に声かけ）` : ''}`
    );
  }
  return `ハンディ: ${parts.join(' / ')}`;
}

/** 時間制の残り分（0 未満は 0）。終了予定が無ければ null */
export function remainingMinutes(endAtMs: number | null, nowMs: number): number | null {
  if (endAtMs == null) return null;
  return Math.max(0, Math.ceil((endAtMs - nowMs) / 60_000));
}

/* ------------------------------------------------------------ プラン商品 */

/** モード選択で出す「プラン商品」（コース・飲み放題など） */
export interface HandyPlanItem {
  id: string;
  name: string;
  price: number;
  /** コースの所要時間（分）。あれば時間制の既定値にする */
  durationMinutes: number | null;
  /** 飲み放題／食べ放題／食べ飲み放題／コース のどれとして出すか */
  kind: Exclude<HandyPlan, 'normal'>;
}

export interface PlanItemInput {
  id: string;
  name: string;
  /** 所属カテゴリ名（「飲み放題」カテゴリに入った単品などを拾う） */
  categoryName: string | null;
  price: number;
  itemType: string;
  isSoldOut: boolean;
  durationMinutes: number | null;
  courseIncludesDrinks: boolean | null;
  courseIncludesAyce: boolean | null;
}

/** 飲み放題（店によってはローマ字の伝票名 Nomihoudai / Nomihodai で登録されている） */
const NOMIHODAI = /飲み放題|飲放|のみほ|nomi-?h(?:o|ou|oo|ō)dai/i;
const TABEHODAI = /食べ放題|食放|tabe-?h(?:o|ou|oo|ō)dai/i;
const TABENOMI = /食べ飲み放題|食飲放|tabenomi/i;
/** 飲み放題のアップグレード（A→AB）・延長は途中で足す商品で、着席時に選ぶプランではない */
const NOT_A_PLAN = /→|延長/;

/**
 * 商品名が飲み放題・食べ放題（プラン本体やアップグレード）を表すか。
 * 伝票にプランが入っているかの判定に使う（メニューブックの「プランのときだけ」）。
 */
export function looksLikePlanName(name: string): boolean {
  return NOMIHODAI.test(name) || TABEHODAI.test(name) || TABENOMI.test(name);
}

/**
 * 1商品がどのモードのプラン商品か。該当しなければ null（単品）。
 * DB のフラグ（course_includes_drinks / course_includes_ayce）と商品名の「飲み放題」「食べ放題」で判断し、
 * どちらでもないコース商品は「コース」。カテゴリ名はコース商品のときだけ見る
 * （「飲み放題」カテゴリに入った 0円のドリンクをプランとして拾わないため）。
 * 売切・アップグレード・延長の商品は出さない。
 */
export function classifyPlanItem(item: PlanItemInput): HandyPlanItem['kind'] | null {
  if (item.isSoldOut) return null;
  if (NOT_A_PLAN.test(item.name)) return null;
  const text = item.itemType === 'course' ? `${item.categoryName ?? ''} ${item.name}` : item.name;
  const both =
    TABENOMI.test(text) || (item.courseIncludesDrinks === true && item.courseIncludesAyce === true);
  const drinks = both || item.courseIncludesDrinks === true || NOMIHODAI.test(text);
  const ayce = both || item.courseIncludesAyce === true || TABEHODAI.test(text);
  if (drinks && ayce) return 'food';
  if (drinks) return 'drink';
  if (ayce) return 'buffet';
  if (item.itemType === 'course') return 'course';
  return null;
}

export function buildPlanItems(items: PlanItemInput[]): HandyPlanItem[] {
  const out: HandyPlanItem[] = [];
  for (const item of items) {
    const kind = classifyPlanItem(item);
    if (!kind) continue;
    out.push({
      id: item.id,
      name: item.name,
      price: item.price,
      durationMinutes: item.durationMinutes && item.durationMinutes > 0 ? item.durationMinutes : null,
      kind,
    });
  }
  return out;
}
