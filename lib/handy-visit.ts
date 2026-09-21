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

export const HANDY_SCENES = [
  '宴会・パーティー',
  '接待',
  'デート',
  '記念日・誕生日',
  '合コン',
  '女子会',
  'ランチ',
  'その他',
] as const;
export type HandyScene = (typeof HANDY_SCENES)[number];

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

export interface VisitDraft {
  plan: HandyPlan;
  /** コース／飲み放題などで選んだプラン商品（menu_items.id）。アラカルト・未選択は null */
  planItemId: string | null;
  male: number;
  female: number;
  scene: HandyScene | '';
  timed: boolean;
  /** 席時間（分）。timed のときだけ使う */
  duration: number;
  warningEnabled: boolean;
  warningMinutes: number;
}

export const DEFAULT_VISIT_DRAFT: VisitDraft = {
  plan: 'normal',
  planItemId: null,
  male: 0,
  female: 0,
  scene: '',
  timed: false,
  duration: 120,
  warningEnabled: true,
  warningMinutes: 30,
};

/** 確定できない理由（現場向けの日本語）。確定できれば null */
export function validateVisitDraft(d: VisitDraft): string | null {
  if (!Number.isInteger(d.male) || !Number.isInteger(d.female) || d.male < 0 || d.female < 0) {
    return '人数を確認してください';
  }
  const guests = d.male + d.female;
  if (guests < 1 || guests > MAX_GUESTS) return `合計人数を1〜${MAX_GUESTS}名で入力してください`;
  if (!d.scene || !(HANDY_SCENES as readonly string[]).includes(d.scene)) {
    return '利用シーンを選択してください';
  }
  if (d.timed) {
    const durationIssue = durationProblem(d.duration);
    if (durationIssue) return durationIssue;
    if (d.warningEnabled) {
      const warningIssue = warningProblem(d.warningMinutes, d.duration);
      if (warningIssue) return warningIssue;
    }
  }
  if (!HANDY_PLANS.some((p) => p.id === d.plan)) return 'モードを選択してください';
  return null;
}

/**
 * 伝票メモに残す文（レジ・レシートの「メモ」で見える）。
 * 例: ハンディ: 飲み放題 / 男2・女1 / 記念日・誕生日 / 2時間制（30分前に声かけ）
 */
export function visitMemo(
  d: Pick<
    VisitDraft,
    'plan' | 'male' | 'female' | 'scene' | 'timed' | 'duration' | 'warningEnabled' | 'warningMinutes'
  >
): string {
  const parts = [planName(d.plan), `男${d.male}・女${d.female}`];
  if (d.scene) parts.push(String(d.scene));
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
