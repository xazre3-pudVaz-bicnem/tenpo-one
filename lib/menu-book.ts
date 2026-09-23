/**
 * メニューブック：ハンディとお客様QRに「どのカテゴリを・いつ出すか」。
 *
 * レジ（POS）は今まで通り全部のカテゴリを出す（スタッフが何でも打てるように）。
 * ハンディ・お客様QRは、カテゴリごとの「出し方」に従って絞る:
 *   - いつも出す
 *   - プランのときだけ … 飲み放題・食べ放題・コースが伝票に入っているときだけ（F＝フリーの中身）
 *   - ランチの時間だけ … 店舗のランチ時間帯（既定 10:00〜16:00）だけ
 *   - ハンディだけ … お客様QRには出さない（席料・延長など、スタッフが入れるもの）
 *   - 出さない … レジだけ（金額をレジで入れる「フリー」商品など）
 *
 * 店長がメニューブック画面で決めた出し方は store_settings.settings.menuBook に入る（DB 変更なし）。
 * 決めていないカテゴリは名前と値段から自動で決める（autoCategoryShow）。
 * 2026-09-21 店舗報告「アラカルトのお客様QRに飲み放題(F)が出ている」への対応で追加。
 *
 * ページ（2026-09-21 店舗要望「タブが多いので、メニューブックのページごとにまとめてほしい」）:
 * 並び順で続くカテゴリを「前のカテゴリと同じページ」にすると、ハンディ・お客様QRでは1つのタブ
 * （SOUP・APPETIZER・SALAD など）にまとめて出す。レジ（POS）はこれまで通りカテゴリごと。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */
import { looksLikePlanName } from './handy-visit';

export type MenuBookShow = 'always' | 'plan' | 'lunch' | 'staff' | 'hidden';
export type MenuBookChannel = 'handy' | 'qr';

export const MENU_BOOK_SHOWS: readonly MenuBookShow[] = ['always', 'plan', 'lunch', 'staff', 'hidden'];

export const MENU_BOOK_SHOW_LABELS: Record<MenuBookShow, string> = {
  always: 'いつも出す',
  plan: 'プランのときだけ',
  lunch: 'ランチの時間だけ',
  staff: 'ハンディだけ',
  hidden: '出さない（レジだけ）',
};

export const MENU_BOOK_SHOW_NOTES: Record<MenuBookShow, string> = {
  always: 'ハンディ・お客様QRにいつも出す',
  plan: '飲み放題・食べ放題・コースが伝票に入っているときだけ出す（F＝フリーの中身など）',
  lunch: 'ランチの時間帯だけ出す',
  staff: 'ハンディには出す。お客様QRには出さない（席料・延長など）',
  hidden: 'ハンディ・お客様QRには出さない。レジでは打てる',
};

export interface MenuBookLunch {
  start: string;
  end: string;
}

/** ランチの時間帯の既定値（店ごとに変えられる。広めにしてランチの注文を止めないようにする） */
export const DEFAULT_MENU_BOOK_LUNCH: MenuBookLunch = { start: '10:00', end: '16:00' };

export interface MenuBookSettings {
  /** カテゴリID → 出し方。無いカテゴリは自動（autoCategoryShow） */
  categories: Record<string, MenuBookShow>;
  /** プラン商品（menu_items.id）→ そのプランで出すカテゴリID。無いプランは「プランのときだけ」を全部出す */
  plans: Record<string, string[]>;
  lunch: MenuBookLunch;
  /** 上のタブ（ページ）の並び。空なら STANDARD_MENU_PAGES */
  pages: MenuPageDef[];
  /** カテゴリID → ページのkey。決めていないカテゴリは autoCategoryPage で自動 */
  categoryPage: Record<string, string>;
}

/** 上のタブ（ページ）1つ分の設定 */
export interface MenuPageDef {
  /** 'lunch' 'drink' のような英数字のkey（保存用。名前を変えても中身が動かないように） */
  key: string;
  name: string;
}

/**
 * どの店舗でも最初に出す8つのタブ（2026-09-24 全店舗の要望）。
 * 店舗は設定（メニューブック＞ページ）で名前を変えたり、タブを足したりできる。
 * カテゴリが1つも入っていないタブは、レジ・ハンディ・お客様QRには出さない（押せないタブを出さないため）。
 */
export const STANDARD_MENU_PAGES: readonly (MenuPageDef & { en: string })[] = [
  { key: 'lunch', name: 'ランチ', en: 'Lunch' },
  { key: 'drink', name: 'ドリンク', en: 'Drink' },
  { key: 'food', name: 'フード', en: 'Food' },
  { key: 'course', name: 'コース', en: 'Course' },
  { key: 'tabehodai', name: '食べ放題', en: 'All you can eat' },
  { key: 'nomihodai', name: '飲み放題', en: 'All you can drink' },
  { key: 'service', name: 'サービス', en: 'Service' },
  { key: 'other', name: 'OTHER', en: 'Other' },
];

/** 何にも当てはまらないカテゴリの行き先 */
export const FALLBACK_PAGE_KEY = 'other';

/** ページのkeyの形（保存・URLで使うので英数字とハイフンだけ） */
export const PAGE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

export function menuBookPages(book: Pick<MenuBookSettings, 'pages'>): MenuPageDef[] {
  return book.pages.length > 0 ? book.pages : STANDARD_MENU_PAGES.map((p) => ({ key: p.key, name: p.name }));
}

/** ページの名前の最大文字数（ハンディのタイル・お客様QRのタブに収まる長さ） */
export const PAGE_NAME_MAX = 30;

/** メニューブックの画面のタブ（?tab= で直接開ける。レジの設定から「ページ」「プラン」などを開くため） */
export const MENU_BOOK_TABS = ['categories', 'pages', 'items', 'plans', 'lunch'] as const;
export type MenuBookTab = (typeof MENU_BOOK_TABS)[number];

export function isMenuBookTab(value: unknown): value is MenuBookTab {
  return typeof value === 'string' && (MENU_BOOK_TABS as readonly string[]).includes(value);
}

export function emptyMenuBook(): MenuBookSettings {
  return { categories: {}, plans: {}, lunch: { ...DEFAULT_MENU_BOOK_LUNCH }, pages: [], categoryPage: {} };
}

/** store_settings.settings.menuBook に書く形（項目を足したらここにも足す。書き忘れると保存のたびに消える） */
export function menuBookToJson(book: MenuBookSettings): Record<string, unknown> {
  return {
    categories: book.categories,
    plans: book.plans,
    lunch: book.lunch,
    pages: book.pages,
    categoryPage: book.categoryPage,
  };
}

/** ページの名前を整える（前後の空白を取り、長すぎる分は切る。空なら null＝カテゴリ名をつなげて出す） */
export function normalizePageName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return [...name].slice(0, PAGE_NAME_MAX).join('');
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHm(value: unknown): value is string {
  return typeof value === 'string' && HM.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** store_settings.settings から読む（壊れた値・知らない値は捨てる） */
export function menuBookFrom(settings: unknown): MenuBookSettings {
  const book = emptyMenuBook();
  const root = isRecord(settings) ? settings.menuBook : null;
  if (!isRecord(root)) return book;
  if (isRecord(root.categories)) {
    for (const [id, v] of Object.entries(root.categories)) {
      if (UUID.test(id) && typeof v === 'string' && (MENU_BOOK_SHOWS as readonly string[]).includes(v)) {
        book.categories[id] = v as MenuBookShow;
      }
    }
  }
  if (isRecord(root.plans)) {
    for (const [id, v] of Object.entries(root.plans)) {
      if (UUID.test(id) && Array.isArray(v)) {
        book.plans[id] = [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))];
      }
    }
  }
  if (isRecord(root.lunch) && isHm(root.lunch.start) && isHm(root.lunch.end) && root.lunch.start !== root.lunch.end) {
    book.lunch = { start: root.lunch.start, end: root.lunch.end };
  }
  if (Array.isArray(root.pages)) {
    const seen = new Set<string>();
    for (const p of root.pages) {
      if (!isRecord(p)) continue;
      const key = typeof p.key === 'string' ? p.key : '';
      const name = normalizePageName(p.name);
      if (!PAGE_KEY_RE.test(key) || !name || seen.has(key)) continue;
      seen.add(key);
      book.pages.push({ key, name });
    }
  }
  if (isRecord(root.categoryPage)) {
    for (const [id, v] of Object.entries(root.categoryPage)) {
      if (UUID.test(id) && typeof v === 'string' && PAGE_KEY_RE.test(v)) book.categoryPage[id] = v;
    }
  }
  return book;
}

/* ------------------------------------------------------------ 自動判定 */

/** 金額をレジで入れる商品（ドリンクフリー等）のカテゴリ。ハンディ・QRでは金額を入れられない */
const FREE_PRICE_CATEGORY = /^(?:フリー|free)$/i;
/** ランチのカテゴリ（「TODAY'S LUNCH」「Spice Lunch」「(L) …」「(H.L) …」「ランチ」） */
const LUNCH_CATEGORY = /lunch|ランチ|^\((?:L|H\.L)\)/i;
/** 飲み放題・食べ放題の中身（dinii から来た「(F)」「(F/C)」「(C/F)」「(4400) F. …」） */
const PLAN_CATEGORY = /\((?:F|F\/C|C\/F)\)|(?:^|[\s)])F\.(?:\s|$)/i;
/**
 * お客様が自分で頼む物ではない商品（席料・お通し・チャージ・キャンセル料・サービス料・アップグレード・延長）。
 * dinii でもお客様には出していなかった（FULL MOoN・肉ギャングの Others は全部「お客様に表示しない」）。
 * 自動のカテゴリではお客様QRに出さず、ハンディ・レジでスタッフが入れる（2026-09-23 全店舗）。
 */
const STAFF_ONLY_ITEM =
  /席料|お通し|ｵﾄｵｼ|チャージ|キャンセル料|サービス料|アップグレード|\b(?:cover|table|seat|service)\s*charge\b|\bcancel(?:lation)?\s*(?:fee|charge)\b|\bupgrade\b/i;
/** 「F. 生ビール」のような0円の商品は、普通のカテゴリに混ざっていてもプランのときだけ出す */
const PLAN_ITEM = /^F[.．]\s?/;

/** 「その他」に置くカテゴリ（dinii の Others・レジで金額を入れる Free） */
const OTHER_PAGE_CATEGORY = /^(?:others?|その他|フリー|free)$/i;
/** サービス・席料・オプションのカテゴリ（ランチの判定のあとに見る。「ランチ オプション」はランチに残す） */
const SERVICE_PAGE_CATEGORY =
  /オプション|option|席料|お通し|ｵﾄｵｼ|チャージ|charge|サービス料|延長|アップグレード|upgrade|キャンセル料|容器|取り皿/i;
/** コースのカテゴリ（「(C) 食事」「3300/2500 course」「3480 おでん」のように頭に金額が付くもの） */
const COURSE_PAGE_CATEGORY = /コース|course|couruse|^\(C\)|^\d{3,5}(?:\s*\/\s*\d{3,5})?[\s　]/i;
/** プラン（飲み放題・食べ放題）の中身のカテゴリ。「(A) …」のようなプラン別の頭文字も見る */
const PLAN_PAGE_CATEGORY = /\((?:F|F\/C|C\/F)\)|(?:^|[\s)])F[.\s]|^\([A-BD-EG-Z]\)/i;

export interface MenuBookCategoryInput {
  id: string;
  name: string;
}

/** ページの自動振り分けに使うカテゴリの情報 */
export interface MenuPageCategoryInput extends MenuBookCategoryInput {
  /** 厨房のステーション（'drink' なら飲み物。ドリンク・飲み放題の判定に使う） */
  station?: string | null;
  /** 売る商品が全部0円か。分かるときだけ渡す（0円＝食べ放題・飲み放題の中身） */
  allZeroPrice?: boolean;
}

/**
 * カテゴリをどのタブ（ページ）に入れるかの自動判定。店舗が設定していないカテゴリに使う。
 * 店舗要望（2026-09-24）「0円の商品、または名前に F が付いたカテゴリは 食べ放題／飲み放題」。
 * 食べ放題か飲み放題かは厨房のステーション（drink かどうか）で分ける。
 * ランチはサービスより先に見る（「ランチ オプション」をサービスに落とさないため）。
 */
export function autoCategoryPage(category: MenuPageCategoryInput): string {
  const name = category.name.trim();
  const drink = (category.station ?? '') === 'drink';
  if (OTHER_PAGE_CATEGORY.test(name)) return 'other';
  if (LUNCH_CATEGORY.test(name)) return 'lunch';
  if (SERVICE_PAGE_CATEGORY.test(name)) return 'service';
  if (COURSE_PAGE_CATEGORY.test(name)) return 'course';
  if (category.allZeroPrice === true || PLAN_PAGE_CATEGORY.test(name)) return drink ? 'nomihodai' : 'tabehodai';
  return drink ? 'drink' : 'food';
}

/** カテゴリの行き先（店舗が決めていればそれ、無ければ自動。知らないページは OTHER へ） */
export function categoryPageKey(
  category: MenuPageCategoryInput,
  book: Pick<MenuBookSettings, 'pages' | 'categoryPage'>,
  known: ReadonlySet<string>
): string {
  const set = book.categoryPage[category.id];
  const key = set && known.has(set) ? set : autoCategoryPage(category);
  if (known.has(key)) return key;
  return known.has(FALLBACK_PAGE_KEY) ? FALLBACK_PAGE_KEY : [...known][known.size - 1];
}

export interface MenuBookItemInput {
  categoryId: string | null;
  name: string;
  price: number;
  /** food / drink / course / option。自動判定の「全部0円」はフード・ドリンクだけで見る */
  itemType?: string | null;
}

/**
 * 出し方が決まっていないカテゴリの自動判定。
 * - 「フリー」「FREE」→ 出さない（レジで金額を入れる商品）
 * - ランチの名前 → ランチの時間だけ（0円のランチセットの中身もランチ中は出す）
 * - 「(F)」などの名前、またはフード・ドリンクが全部0円（コース・食べ放題の中身）→ プランのときだけ
 * - 席料・お通し・キャンセル料・延長・アップグレードだけのカテゴリ → ハンディだけ
 * - それ以外 → いつも出す
 */
export function autoCategoryShow(category: MenuBookCategoryInput, items: readonly MenuBookItemInput[]): MenuBookShow {
  const name = category.name.trim();
  if (FREE_PRICE_CATEGORY.test(name)) return 'hidden';
  if (LUNCH_CATEGORY.test(name)) return 'lunch';
  if (PLAN_CATEGORY.test(name)) return 'plan';
  // 席料・お通し・キャンセル料・延長・アップグレードだけのカテゴリ（Others など）はハンディだけ
  const mine = items.filter((i) => i.categoryId === category.id);
  if (mine.length > 0 && mine.every((i) => isStaffOnlyItem(i.name))) return 'staff';
  const sellable = items.filter(
    (i) => i.categoryId === category.id && (i.itemType == null || i.itemType === 'food' || i.itemType === 'drink')
  );
  if (sellable.length > 0 && sellable.every((i) => Number(i.price) === 0)) return 'plan';
  return 'always';
}

/** カテゴリの出し方（店長の設定があればそれ、無ければ自動） */
export function categoryShow(
  category: MenuBookCategoryInput,
  items: readonly MenuBookItemInput[],
  book: MenuBookSettings
): { show: MenuBookShow; auto: boolean } {
  const set = book.categories[category.id];
  return set ? { show: set, auto: false } : { show: autoCategoryShow(category, items), auto: true };
}

/** 出し方が「プランのときだけ」のカテゴリ（飲み放題・食べ放題・コースの中身）の id */
export function planCategoryIds(
  categories: readonly MenuBookCategoryInput[],
  items: readonly MenuBookItemInput[],
  book: MenuBookSettings
): Set<string> {
  return new Set(categories.filter((c) => categoryShow(c, items, book).show === 'plan').map((c) => c.id));
}

/** 「F. 生ビール」のような0円の商品（プランのときだけ出す） */
export function isPlanOnlyItem(item: Pick<MenuBookItemInput, 'name' | 'price'>): boolean {
  return Number(item.price) === 0 && PLAN_ITEM.test(item.name.trim());
}

/* ------------------------------------------------------------ 伝票のプラン */

export interface OrderLineForPlan {
  menuItemId: string | null;
  name: string;
  /** menu_items.item_type（削除された商品などで分からなければ null） */
  itemType: string | null;
  status?: string | null;
}

/** 伝票の1行がプラン（コース・飲み放題・食べ放題・そのアップグレード）か */
export function isPlanLine(line: OrderLineForPlan): boolean {
  if (line.status === 'cancelled') return false;
  return isPlanItem(line.itemType, line.name);
}

/**
 * 伝票に入るとプランとして数える商品か（isPlanLine と同じ判定）。コースの商品と、名前が飲み放題・食べ放題の商品。
 * 「飲み放題 (A→AB)」のようなアップグレードや延長も名前に飲み放題が入っていればプランとして数えるので、
 * メニューブックの「プランで出すカテゴリ」にも並べて、出すカテゴリを決められるようにする
 * （決めないと、プランのときだけのカテゴリを全部出してしまう。2026-09-22 御茶ノ水）。
 */
export function isPlanItem(itemType: string | null, name: string): boolean {
  return itemType === 'course' || looksLikePlanName(name);
}

/** プランの追加（アップグレード「A→AB」・延長）。プランで出すカテゴリでは上の段のカテゴリを選ぶ */
export function isPlanAddOn(name: string): boolean {
  return /→|->|⇒|延長/.test(name);
}

/** お客様QRに出さない商品（席料・お通し・チャージ・キャンセル料・サービス料・アップグレード・延長） */
export function isStaffOnlyItem(name: string): boolean {
  const n = name.trim();
  return isPlanAddOn(n) || STAFF_ONLY_ITEM.test(n);
}

export interface OrderPlanState {
  hasPlan: boolean;
  /** 伝票に入っているプラン商品の id（重複なし） */
  planItemIds: string[];
  /** そのうちアップグレード・延長（A→AB など）の id。出すカテゴリを決めていなければ何も足さない */
  addOnItemIds?: string[];
}

export function orderPlanState(lines: readonly OrderLineForPlan[]): OrderPlanState {
  const plans = lines.filter(isPlanLine);
  const ids = [...new Set(plans.map((l) => l.menuItemId).filter((id): id is string => !!id))];
  const addOns = [
    ...new Set(plans.filter((l) => isPlanAddOn(l.name)).map((l) => l.menuItemId).filter((id): id is string => !!id)),
  ];
  const state: OrderPlanState = { hasPlan: plans.length > 0, planItemIds: ids };
  if (addOns.length > 0) state.addOnItemIds = addOns;
  return state;
}

/* ------------------------------------------------------------ 表示判定 */

/** 'HH:MM' が start〜end の間か（end を含まない。日をまたぐ時間帯にも対応） */
export function isWithinHm(nowHm: string, start: string, end: string): boolean {
  if (!isHm(nowHm) || !isHm(start) || !isHm(end)) return true;
  if (start < end) return nowHm >= start && nowHm < end;
  return nowHm >= start || nowHm < end;
}

export interface MenuBookContext {
  channel: MenuBookChannel;
  plan: OrderPlanState;
  /** 'HH:MM'（JST） */
  nowHm: string;
}

/**
 * プランのときだけのカテゴリを、伝票のプランで出してよいか。
 * プランごとの指定が無ければ全部出す。ただしアップグレード・延長（A→AB など）は、指定が無ければ何も足さない
 * （指定の無いアップグレードで (F) を全部出していた。アラカルトの卓で ¥700 のアップグレードを頼むと
 *  ABC 相当になっていた。2026-09-22 御茶ノ水 → 2026-09-23 全店舗の既定に）。
 */
function planAllows(categoryId: string, book: MenuBookSettings, plan: OrderPlanState): boolean {
  if (!plan.hasPlan) return false;
  if (plan.planItemIds.length === 0) return true;
  const addOns = new Set(plan.addOnItemIds ?? []);
  return plan.planItemIds.some((id) => {
    const list = book.plans[id];
    if (list) return list.includes(categoryId);
    return !addOns.has(id);
  });
}

export function isShowVisible(
  show: MenuBookShow,
  categoryId: string,
  book: MenuBookSettings,
  ctx: MenuBookContext
): boolean {
  switch (show) {
    case 'always':
      return true;
    case 'plan':
      return planAllows(categoryId, book, ctx.plan);
    case 'lunch':
      return isWithinHm(ctx.nowHm, book.lunch.start, book.lunch.end);
    case 'staff':
      return ctx.channel === 'handy';
    case 'hidden':
      return false;
  }
}

/**
 * ハンディ・お客様QRに出すカテゴリと商品に絞る。
 * カテゴリの出し方で絞ったうえで、「F. …」の0円商品はプランが無ければ外す。
 * お客様QRでは、自動のカテゴリに混ざった席料・お通し・キャンセル料・延長・アップグレードも外す
 * （カテゴリを「いつも出す」に決めればお客様にも出る）。
 */
export function filterMenuBook<C extends MenuBookCategoryInput, I extends MenuBookItemInput>(
  categories: readonly C[],
  items: readonly I[],
  book: MenuBookSettings,
  ctx: MenuBookContext
): { categories: C[]; items: I[] } {
  const visible = new Set<string>();
  /** 出し方を店長が決めていない（自動の）カテゴリ。ここでは席料・延長などをお客様QRに出さない */
  const autoIds = new Set<string>();
  for (const c of categories) {
    const { show, auto } = categoryShow(c, items, book);
    if (isShowVisible(show, c.id, book, ctx)) visible.add(c.id);
    if (auto) autoIds.add(c.id);
  }
  const staffOnlyHidden = (i: I) =>
    ctx.channel === 'qr' && i.categoryId !== null && autoIds.has(i.categoryId) && isStaffOnlyItem(i.name);
  const kept = items.filter(
    (i) =>
      i.categoryId !== null &&
      visible.has(i.categoryId) &&
      (ctx.plan.hasPlan || !isPlanOnlyItem(i)) &&
      !staffOnlyHidden(i)
  );
  return {
    categories: categories.filter((c) => visible.has(c.id)),
    items: kept,
  };
}

/**
 * カテゴリの中に商品が入った形のメニュー（お客様QRの get_qr_menu）を絞る。
 * 商品が1つも残らないカテゴリは外す。
 */
export function filterNestedMenu<
  I extends { name: string; price: number },
  C extends MenuBookCategoryInput & { items: I[] },
>(categories: readonly C[], book: MenuBookSettings, ctx: MenuBookContext): C[] {
  const flat: (MenuBookItemInput & { item: I })[] = categories.flatMap((c) =>
    c.items.map((item) => ({ categoryId: c.id, name: item.name, price: item.price, itemType: null, item }))
  );
  const { items } = filterMenuBook(categories, flat, book, ctx);
  const byCategory = new Map<string, I[]>();
  for (const i of items) {
    const list = byCategory.get(i.categoryId as string) ?? [];
    list.push(i.item);
    byCategory.set(i.categoryId as string, list);
  }
  return categories
    .filter((c) => (byCategory.get(c.id)?.length ?? 0) > 0)
    .map((c) => ({ ...c, items: byCategory.get(c.id) ?? [] }));
}

/* ------------------------------------------------------------ ページ */

export interface MenuBookPage<C> {
  /** ページの先頭カテゴリの id（ページの名前のキー。画面の key にも使う） */
  key: string;
  /** 店長が付けた名前。無ければ null（カテゴリ名をつなげて出す） */
  name: string | null;
  categories: C[];
}

/**
 * カテゴリをタブ（ページ）にまとめる。ページの並びは店舗の設定（無ければ STANDARD_MENU_PAGES）。
 * どのページに入るかはカテゴリごとの設定、決めていなければ autoCategoryPage の自動判定。
 * カテゴリが1つも入らないページは返さない（押せないタブを出さないため）。
 */
export function groupMenuPages<C extends MenuPageCategoryInput>(
  ordered: readonly C[],
  book: Pick<MenuBookSettings, 'pages' | 'categoryPage'>,
  keep: (category: C) => boolean = () => true
): MenuBookPage<C>[] {
  const defs = menuBookPages(book);
  const known = new Set(defs.map((p) => p.key));
  const bucket = new Map<string, C[]>(defs.map((p) => [p.key, []]));
  for (const c of ordered) {
    if (!keep(c)) continue;
    bucket.get(categoryPageKey(c, book, known))?.push(c);
  }
  return defs
    .filter((p) => (bucket.get(p.key)?.length ?? 0) > 0)
    .map((p) => ({ key: p.key, name: p.name, categories: bucket.get(p.key) as C[] }));
}

/** ページの表示名（名前が無ければカテゴリ名を「・」でつなぐ） */
export function menuPageLabel<C>(page: { name: string | null; categories: readonly C[] }, nameOf: (category: C) => string): string {
  return page.name ?? page.categories.map(nameOf).join('・');
}

/**
 * プランのある卓のタブの並び：「プランのときだけ」のカテゴリだけのページ（食べ放題・飲み放題）を先に出す
 * （2026-09-21 店舗要望「飲み放題の卓のセルフオーダーが、アラカルトと変わらないので飲み放題を前に」）。
 */
export function planPagesFirst<C extends { id: string }>(
  pages: readonly MenuBookPage<C>[],
  isPlan: (category: C) => boolean
): MenuBookPage<C>[] {
  const planPart = pages.filter((p) => p.categories.every(isPlan));
  const rest = pages.filter((p) => !p.categories.every(isPlan));
  return [...planPart, ...rest];
}

/** お客様QRに渡すページ（カテゴリは id だけ。中身は get_qr_menu の結果から引く） */
export interface MenuPageRef {
  key: string;
  name: string | null;
  categoryIds: string[];
  /** 全部「プランのときだけ」のカテゴリのページ */
  plan: boolean;
}

/**
 * お客様QRのタブ（ページ）。all は get_qr_menu の全カテゴリ（並び順どおり）、visible は filterNestedMenu で
 * 絞ったあとのカテゴリ。プランのある卓は「プランのときだけ」のページを先頭にする。
 */
export function nestedMenuPages<
  I extends { name: string; price: number },
  C extends MenuBookCategoryInput & { items: I[] },
>(
  all: readonly C[],
  visible: readonly C[],
  book: MenuBookSettings,
  plan: OrderPlanState,
  /** カテゴリID → 厨房のステーション（ページの自動振り分けに使う。get_qr_menu には入っていないので別に渡す） */
  stationById: ReadonlyMap<string, string | null> = new Map()
): MenuPageRef[] {
  const flat: MenuBookItemInput[] = all.flatMap((c) =>
    c.items.map((item) => ({ categoryId: c.id, name: item.name, price: item.price, itemType: null }))
  );
  const planIds = planCategoryIds(all, flat, book);
  const shown = new Set(visible.map((c) => c.id));
  const forPages = all.map((c) => ({
    ...c,
    station: stationById.get(c.id) ?? null,
    allZeroPrice: c.items.length > 0 && c.items.every((i) => Number(i.price) === 0),
  }));
  let pages = groupMenuPages(forPages, book, (c) => shown.has(c.id));
  if (plan.hasPlan) pages = planPagesFirst(pages, (c) => planIds.has(c.id));
  return pages.map((p) => ({
    key: p.key,
    name: p.name,
    categoryIds: p.categories.map((c) => c.id),
    plan: p.categories.every((c) => planIds.has(c.id)),
  }));
}

/** 並び替え: from 番目の要素を to 番目へ動かした新しい配列（範囲外は端に寄せる） */
export function moveInList<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** カテゴリの出し方（'auto' は自動判定の結果）を実際の出し方にする */
export function effectiveShow(show: MenuBookShow | 'auto', autoShow: MenuBookShow): MenuBookShow {
  return show === 'auto' ? autoShow : show;
}
