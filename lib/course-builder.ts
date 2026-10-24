/**
 * コース／放題プランを iPad でかんたんに作る（設定 › プラン）。純関数・テスト対象。
 *
 * 2026-10-25 Ronnie「プランとコースを分けて、コースをここで足せるように。注文の画面にも出るように。
 * コースを足すときは料理の名前を何品でも入れられるように（追加で1行ずつ。料理はコースの値段に入っているので ¥0）。
 * 最後に 選べるメイン も入れられるように。コースはできるだけかんたんに。放題（プラン）も見て」。
 *
 * 保存の中身（DB の変更なし。今あるものをそのまま使う）:
 *   - コース・放題プラン … menu_items（item_type = 'course'。値段は1人分・duration_minutes＝時間）
 *   - 料理（出す順） … store_settings.settings.courseSteps（lib/course-steps.ts。Web の「コースの料理」と同じ）。
 *     名前だけ打った料理は ¥0・非表示（status = 'hidden'）のフードとして「コースの料理」カテゴリに作る
 *     （非表示なのでレジ・ハンディ・お客様QRには単品で出ない。厨房伝票には 1st / 2nd … で出る）
 *   - 選べるメイン … 選択肢グループ（必須・1つ選ぶ）をこのコースだけに付ける。どのグループかは
 *     store_settings.settings.courseMainGroups（{ [コースID]: グループID }）に残す
 *   - 放題プランで出すカテゴリ … store_settings.settings.menuBook.plans（メニューブックの「プランで出すカテゴリ」と同じ）
 */
import { isUuid } from '@/lib/native-pos';
import { MAX_COURSE_STEPS } from '@/lib/course-steps';

/** 名前だけ打った料理を入れるカテゴリ（無ければ作る） */
export const COURSE_DISH_CATEGORY_NAME = 'コースの料理';
/** 選べるメインの選択肢グループの名前（作るとき） */
export const COURSE_MAIN_GROUP_NAME = 'メイン選択';
/** 選べるメインの数の上限 */
export const MAX_MAIN_CHOICES = 20;
export const COURSE_NAME_MAX = 120;
export const DISH_NAME_MAX = 80;
export const CHOICE_NAME_MAX = 80;
export const COURSE_PRICE_MAX = 9_999_999;
/** コース・プランの時間（分）。席の時間と同じ範囲（lib/handy-visit.ts の DURATION_MIN/MAX_MINUTES） */
export const COURSE_DURATION_MIN = 15;
export const COURSE_DURATION_MAX = 480;
/** 1回に受け取る行の数（空の行を含む。暴走防止） */
const RAW_ROWS_MAX = 100;

export type CourseBuilderKind = 'course' | 'plan';
/** 放題の種類：飲み放題・食べ放題・食べ飲み放題 */
export type PlanKind = 'drink' | 'food' | 'both';
export const PLAN_KINDS: readonly PlanKind[] = ['drink', 'food', 'both'];

/** 料理の1行。dishId があればメニューの商品、無ければ name で新しい料理（¥0・非表示）を作る */
export interface CourseStepInput {
  dishId: string | null;
  name: string;
}

export interface CourseMainChoiceInput {
  name: string;
  /** 追加料金（円。0 以上） */
  price: number;
}

export interface CourseBuilderInput {
  kind: CourseBuilderKind;
  course: {
    id: string | null;
    name: string;
    nameEn: string;
    /** 1人分の値段（税込） */
    price: number;
    /** 時間（分）。null は時間なし */
    durationMinutes: number | null;
    taxRateId: string | null;
    /** null は既定のカテゴリ（コース／飲み放題プラン…）を使う。無ければ作る */
    categoryId: string | null;
    hidden: boolean;
    /** menu_items.course_includes_drinks（飲み放題つき） */
    includesDrinks: boolean;
    /** menu_items.course_includes_ayce（食べ放題） */
    includesAyce: boolean;
  };
  /** 料理（出す順）。null は変えない（放題プラン・送らなかったとき） */
  steps: CourseStepInput[] | null;
  /** 選べるメイン。null は変えない（放題プラン・オプションの権限が無くて送らなかったとき） */
  main: { enabled: boolean; choices: CourseMainChoiceInput[] } | null;
  /** プランで出すカテゴリ。undefined は変えない／null は指定なし（プランのときだけのカテゴリを全部）／配列は指定 */
  planCategoryIds: string[] | null | undefined;
}

type Parsed = { ok: true; input: CourseBuilderInput } | { ok: false; error: string };
const bad = (error: string): Parsed => ({ ok: false, error });

/** 前後の空白を取り、続いた空白を1つにする */
export function normalizeName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/** 名前の重なりを見る（大文字小文字・全角半角の空白は同じとみなす） */
export function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

/** 放題の種類 → menu_items の印（飲み放題＝drinks、食べ放題＝ayce） */
export function planKindFlags(kind: PlanKind): { includesDrinks: boolean; includesAyce: boolean } {
  return { includesDrinks: kind === 'drink' || kind === 'both', includesAyce: kind === 'food' || kind === 'both' };
}

/** 商品の印と名前から放題の種類（どちらでもなければ null）。画面の初めの値に使う */
export function planKindOf(includesDrinks: boolean | null, includesAyce: boolean | null, name: string): PlanKind | null {
  const both = /食べ飲み放題|食飲放|tabenomi/i.test(name) || (includesDrinks === true && includesAyce === true);
  if (both) return 'both';
  const drink = includesDrinks === true || /飲み放題|飲放|のみほ|nomi-?h(?:o|ou|oo|ō)dai/i.test(name);
  const food = includesAyce === true || /食べ放題|食放|tabe-?h(?:o|ou|oo|ō)dai/i.test(name);
  if (drink && food) return 'both';
  if (drink) return 'drink';
  if (food) return 'food';
  return null;
}

/** カテゴリを選ばなかったときに使う（無ければ作る）カテゴリの名前と、入れる上のタブ（メニューブックのページ） */
export function defaultCategoryFor(kind: CourseBuilderKind, planKind: PlanKind | null): { name: string; nameEn: string; pageKey: string } {
  if (kind === 'course') return { name: 'コース', nameEn: 'Course', pageKey: 'course' };
  if (planKind === 'food') return { name: '食べ放題プラン', nameEn: 'All-you-can-eat plans', pageKey: 'tabehodai' };
  if (planKind === 'both') return { name: '食べ飲み放題プラン', nameEn: 'All-you-can-eat & drink plans', pageKey: 'tabehodai' };
  return { name: '飲み放題プラン', nameEn: 'All-you-can-drink plans', pageKey: 'nomihodai' };
}

/** 円の値（0〜上限の数。小数は四捨五入）。だめなら null */
function yen(v: unknown, max = COURSE_PRICE_MAX): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  const r = Math.round(n);
  return r <= max ? r : null;
}

/**
 * iPad から来たコース／放題プランの中身を確かめる（名前は前後の空白を取る・長さ・数・重なり）。
 * 料理・選べるメインの空の行は捨てる（「＋ 追加」で足して何も打たなかった行）。
 */
export function parseCourseBuilderInput(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('内容が正しくありません');
  const b = raw as Record<string, unknown>;
  const kind: CourseBuilderKind | null = b.kind === 'course' || b.kind === 'plan' ? b.kind : null;
  if (!kind) return bad('コースか放題プランかを選んでください');
  const c = b.course;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return bad('内容が正しくありません');
  const f = c as Record<string, unknown>;
  const label = kind === 'course' ? 'コース' : 'プラン';

  const id = f.id == null || f.id === '' ? null : isUuid(f.id) ? f.id : false;
  if (id === false) return bad(`${label}が見つかりません。画面を開き直してください`);
  const name = normalizeName(f.name);
  if (!name) return bad(`${label}名を入力してください`);
  if ([...name].length > COURSE_NAME_MAX) return bad(`${label}名は${COURSE_NAME_MAX}文字までです`);
  const nameEn = normalizeName(f.nameEn);
  if ([...nameEn].length > COURSE_NAME_MAX) return bad(`英語名は${COURSE_NAME_MAX}文字までです`);
  const price = yen(f.price);
  if (price === null) return bad(`値段は0〜${COURSE_PRICE_MAX.toLocaleString('ja-JP')}円で入力してください`);

  let durationMinutes: number | null = null;
  if (f.durationMinutes != null && f.durationMinutes !== '') {
    const d = typeof f.durationMinutes === 'string' ? Number(f.durationMinutes) : f.durationMinutes;
    if (typeof d !== 'number' || !Number.isFinite(d)) return bad(`時間は${COURSE_DURATION_MIN}〜${COURSE_DURATION_MAX}分で入れてください`);
    const m = Math.round(d);
    if (m !== 0) {
      if (m < COURSE_DURATION_MIN || m > COURSE_DURATION_MAX) return bad(`時間は${COURSE_DURATION_MIN}〜${COURSE_DURATION_MAX}分で入れてください`);
      durationMinutes = m;
    }
  }
  const taxRateId = f.taxRateId == null || f.taxRateId === '' ? null : isUuid(f.taxRateId) ? f.taxRateId : false;
  if (taxRateId === false) return bad('税率の指定が正しくありません');
  const categoryId = f.categoryId == null || f.categoryId === '' ? null : isUuid(f.categoryId) ? f.categoryId : false;
  if (categoryId === false) return bad('カテゴリの指定が正しくありません');
  const hidden = f.hidden === true;

  let includesDrinks = f.includesDrinks === true;
  let includesAyce = f.includesAyce === true;
  if (kind === 'plan') {
    const pk = PLAN_KINDS.find((k) => k === b.planKind);
    if (!pk) return bad('飲み放題・食べ放題・食べ飲み放題 のどれかを選んでください');
    ({ includesDrinks, includesAyce } = planKindFlags(pk));
  }

  // 料理（出す順）
  const steps: CourseStepInput[] = [];
  const hasSteps = kind === 'course' && b.steps != null;
  if (hasSteps) {
    if (!Array.isArray(b.steps) || b.steps.length > RAW_ROWS_MAX) return bad(`料理は${MAX_COURSE_STEPS}品までです`);
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const r of b.steps as unknown[]) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return bad('料理の指定が正しくありません');
      const row = r as Record<string, unknown>;
      const dishName = normalizeName(row.name);
      const dishId = row.dishId == null || row.dishId === '' ? null : isUuid(row.dishId) ? row.dishId : false;
      if (dishId === false) return bad('料理の指定が正しくありません。画面を開き直してください');
      if (dishId) {
        if (seenIds.has(dishId) || (dishName && seenNames.has(nameKey(dishName)))) return bad(`「${dishName || '料理'}」が2回入っています`);
        seenIds.add(dishId);
        if (dishName) seenNames.add(nameKey(dishName));
        steps.push({ dishId, name: dishName });
        continue;
      }
      if (!dishName) continue; // 何も打っていない行
      if ([...dishName].length > DISH_NAME_MAX) return bad(`料理の名前は${DISH_NAME_MAX}文字までです（「${[...dishName].slice(0, 12).join('')}…」）`);
      const key = nameKey(dishName);
      if (seenNames.has(key)) return bad(`「${dishName}」が2回入っています`);
      seenNames.add(key);
      steps.push({ dishId: null, name: dishName });
    }
    if (steps.length > MAX_COURSE_STEPS) return bad(`料理は${MAX_COURSE_STEPS}品までです`);
  }

  // 選べるメイン
  const choices: CourseMainChoiceInput[] = [];
  let mainEnabled = false;
  const m = b.main;
  const hasMain = kind === 'course' && m != null;
  if (hasMain && (typeof m !== 'object' || Array.isArray(m))) return bad('選べるメインの指定が正しくありません');
  if (hasMain) {
    const mm = m as Record<string, unknown>;
    mainEnabled = mm.enabled === true;
    if (mainEnabled) {
      if (!Array.isArray(mm.choices) || mm.choices.length > RAW_ROWS_MAX) return bad(`選べるメインは${MAX_MAIN_CHOICES}個までです`);
      const seen = new Set<string>();
      for (const r of mm.choices as unknown[]) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) return bad('選べるメインの指定が正しくありません');
        const row = r as Record<string, unknown>;
        const n = normalizeName(row.name);
        if (!n) continue;
        if ([...n].length > CHOICE_NAME_MAX) return bad(`メインの名前は${CHOICE_NAME_MAX}文字までです`);
        const key = nameKey(n);
        if (seen.has(key)) return bad(`メインの「${n}」が2回入っています`);
        seen.add(key);
        const p = row.price == null || row.price === '' ? 0 : yen(row.price);
        if (p === null) return bad(`「${n}」の追加料金は0円以上で入れてください`);
        choices.push({ name: n, price: p });
      }
      if (choices.length === 0) return bad('選べるメインを1つ以上入れてください（使わないときはオフに）');
      if (choices.length > MAX_MAIN_CHOICES) return bad(`選べるメインは${MAX_MAIN_CHOICES}個までです`);
      if (hidden) return bad('非表示のコースには選べるメインを付けられません（表示にしてください）');
    }
  }

  // プランで出すカテゴリ
  let planCategoryIds: string[] | null | undefined;
  if (!('planCategoryIds' in b) || b.planCategoryIds === undefined) planCategoryIds = undefined;
  else if (b.planCategoryIds === null) planCategoryIds = null;
  else if (Array.isArray(b.planCategoryIds) && b.planCategoryIds.length <= 500 && b.planCategoryIds.every((x) => isUuid(x))) {
    planCategoryIds = [...new Set(b.planCategoryIds as string[])];
  } else return bad('出すカテゴリの指定が正しくありません');

  return {
    ok: true,
    input: {
      kind,
      course: { id, name, nameEn, price, durationMinutes, taxRateId, categoryId, hidden, includesDrinks, includesAyce },
      steps: hasSteps ? steps : null,
      main: hasMain ? { enabled: mainEnabled, choices } : null,
      planCategoryIds,
    },
  };
}

/** 選べるメインの選択肢が変わったか（名前・追加料金・並び） */
export function choicesChanged(
  current: readonly { name: string; price: number }[],
  next: readonly { name: string; price: number }[]
): boolean {
  if (current.length !== next.length) return true;
  return current.some((c, i) => normalizeName(c.name) !== normalizeName(next[i].name) || Math.round(Number(c.price)) !== Math.round(Number(next[i].price)));
}

/** store_settings.settings.courseMainGroups（コースID → 選べるメインのグループID）を読む。壊れた値は捨てる */
export function courseMainGroupsFrom(settings: unknown): Record<string, string> {
  const raw = (settings as { courseMainGroups?: unknown } | null)?.courseMainGroups;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isUuid(k) && isUuid(v)) out[k] = v;
  return out;
}

/**
 * コースの「選べるメイン」のグループを選ぶ。
 * 保存してある印（courseMainGroups）のグループがまだあってこのコースに付いていればそれ、
 * 無ければこのコースに付いている「メイン選択」という名前のグループ（Web のオプションの画面で作ったもの）。
 * ほかのグループ（Choice Curry など）は選べるメインとして扱わない（消したり書き換えたりしない）。
 */
export function pickCourseMainGroup<G extends { id: string; name: string }>(
  courseId: string,
  saved: Readonly<Record<string, string>>,
  linkedGroups: readonly G[]
): G | null {
  const want = saved[courseId];
  const byId = want ? linkedGroups.find((g) => g.id === want) : undefined;
  if (byId) return byId;
  return linkedGroups.find((g) => normalizeName(g.name) === COURSE_MAIN_GROUP_NAME) ?? null;
}

/**
 * 名前だけの料理を作る前に、同じ名前の料理（「コースの料理」カテゴリの商品）があればそれを使う。
 * 名前 → 使う商品ID（無いものは入らない）
 */
export function reuseDishesByName(
  names: readonly string[],
  existing: readonly { id: string; name: string }[]
): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const e of existing) if (!byKey.has(nameKey(e.name))) byKey.set(nameKey(e.name), e.id);
  const out = new Map<string, string>();
  for (const n of names) {
    const id = byKey.get(nameKey(n));
    if (id) out.set(n, id);
  }
  return out;
}

/**
 * レジ（iPad のオーダー画面）に出さないカテゴリ：「コースの料理」カテゴリで、売っている（表示の）商品が1つも無いもの。
 * 料理は非表示（コースを頼むと厨房伝票に出るだけ）なので、空のタブが出ないようにする。
 */
export function isHiddenCourseDishCategory(category: { name: string }, activeItemCount: number): boolean {
  return activeItemCount === 0 && normalizeName(category.name) === COURSE_DISH_CATEGORY_NAME;
}
