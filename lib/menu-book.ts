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
}

export function emptyMenuBook(): MenuBookSettings {
  return { categories: {}, plans: {}, lunch: { ...DEFAULT_MENU_BOOK_LUNCH } };
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
  return book;
}

/* ------------------------------------------------------------ 自動判定 */

/** 金額をレジで入れる商品（ドリンクフリー等）のカテゴリ。ハンディ・QRでは金額を入れられない */
const FREE_PRICE_CATEGORY = /^(?:フリー|free)$/i;
/** ランチのカテゴリ（「TODAY'S LUNCH」「Spice Lunch」「(L) …」「(H.L) …」「ランチ」） */
const LUNCH_CATEGORY = /lunch|ランチ|^\((?:L|H\.L)\)/i;
/** 飲み放題・食べ放題の中身（dinii から来た「(F)」「(F/C)」「(C/F)」「(4400) F. …」） */
const PLAN_CATEGORY = /\((?:F|F\/C|C\/F)\)|(?:^|[\s)])F\.(?:\s|$)/i;
/** 「F. 生ビール」のような0円の商品は、普通のカテゴリに混ざっていてもプランのときだけ出す */
const PLAN_ITEM = /^F[.．]\s?/;

export interface MenuBookCategoryInput {
  id: string;
  name: string;
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
 * - それ以外 → いつも出す
 */
export function autoCategoryShow(category: MenuBookCategoryInput, items: readonly MenuBookItemInput[]): MenuBookShow {
  const name = category.name.trim();
  if (FREE_PRICE_CATEGORY.test(name)) return 'hidden';
  if (LUNCH_CATEGORY.test(name)) return 'lunch';
  if (PLAN_CATEGORY.test(name)) return 'plan';
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
  return line.itemType === 'course' || looksLikePlanName(line.name);
}

export interface OrderPlanState {
  hasPlan: boolean;
  /** 伝票に入っているプラン商品の id（重複なし） */
  planItemIds: string[];
}

export function orderPlanState(lines: readonly OrderLineForPlan[]): OrderPlanState {
  const plans = lines.filter(isPlanLine);
  const ids = [...new Set(plans.map((l) => l.menuItemId).filter((id): id is string => !!id))];
  return { hasPlan: plans.length > 0, planItemIds: ids };
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

/** プランのときだけのカテゴリを、伝票のプランで出してよいか（プランごとの指定が無ければ全部出す） */
function planAllows(categoryId: string, book: MenuBookSettings, plan: OrderPlanState): boolean {
  if (!plan.hasPlan) return false;
  if (plan.planItemIds.length === 0) return true;
  return plan.planItemIds.some((id) => {
    const list = book.plans[id];
    return !list || list.includes(categoryId);
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
 */
export function filterMenuBook<C extends MenuBookCategoryInput, I extends MenuBookItemInput>(
  categories: readonly C[],
  items: readonly I[],
  book: MenuBookSettings,
  ctx: MenuBookContext
): { categories: C[]; items: I[] } {
  const visible = new Set<string>();
  for (const c of categories) {
    if (isShowVisible(categoryShow(c, items, book).show, c.id, book, ctx)) visible.add(c.id);
  }
  return {
    categories: categories.filter((c) => visible.has(c.id)),
    items: items.filter(
      (i) => i.categoryId !== null && visible.has(i.categoryId) && (ctx.plan.hasPlan || !isPlanOnlyItem(i))
    ),
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
