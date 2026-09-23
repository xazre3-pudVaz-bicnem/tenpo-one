/**
 * ハンディ画面の純粋な計算（DB・React非依存・テスト対象）。
 *
 * 注文画面の上のタブは 1 単品（フード＆ドリンク）／2 コース・飲み放題／3 サービス（2026-09-21 店舗要望）。
 * タブの中はメニューブックのページ（SOUP・APPETIZER・SALAD のようにカテゴリをまとめたタイル）→ 商品。
 * 上位分類（フード／ドリンク…）の判定 classifyMenuItem はメニューブック画面の見出しなどで使う。
 */
import { groupMenuPages, menuPageLabel, type MenuPageDef } from '@/lib/menu-book';

export type HandyGroupId = 'food' | 'drink' | 'course' | 'service' | 'other';

export interface HandyGroupDef {
  id: HandyGroupId;
  label: string;
  /** 承認済みUIに合わせて小さく添える英語表記 */
  en: string;
}

/** 上位分類タブの並び（承認済みUIの ①フード ②ドリンク ③コース … に対応する範囲） */
export const HANDY_GROUPS: readonly HandyGroupDef[] = [
  { id: 'food', label: 'フード', en: 'Food' },
  { id: 'drink', label: 'ドリンク', en: 'Drink' },
  { id: 'course', label: 'コース', en: 'Course' },
  { id: 'service', label: 'サービス', en: 'Service' },
  { id: 'other', label: 'その他', en: 'Other' },
] as const;

/** item_type（food / drink / course / option）からの振り分け。DBのcheck制約と同じ4種 */
const GROUP_BY_ITEM_TYPE: Record<string, HandyGroupId> = {
  food: 'food',
  drink: 'drink',
  course: 'course',
  option: 'service',
};

/** item_type が未知の値だったときだけ使う、カテゴリの厨房ステーションによる保険 */
const GROUP_BY_STATION: Record<string, HandyGroupId> = {
  kitchen: 'food',
  dessert: 'food',
  drink: 'drink',
};

/**
 * 1商品の上位分類を決める。
 * item_type を最優先し、未知の値のときだけカテゴリの station を見る。
 * どちらでも決まらなければ 'other'（＝「その他」タブ）。
 */
export function classifyMenuItem(
  itemType: string | null | undefined,
  categoryStation: string | null | undefined
): HandyGroupId {
  return (
    GROUP_BY_ITEM_TYPE[itemType ?? ''] ?? GROUP_BY_STATION[categoryStation ?? ''] ?? 'other'
  );
}

export interface HandyCategoryInput {
  id: string;
  name: string;
  nameEn: string | null;
  station: string | null;
  sortOrder: number;
}

export interface HandyMenuItemInput {
  id: string;
  categoryId: string | null;
  name: string;
  nameEn: string | null;
  price: number;
  itemType: string;
  isSoldOut: boolean;
  sortOrder: number;
  /** 'HH:MM:SS' / 'HH:MM'。null は終日販売 */
  sellStartTime: string | null;
  sellEndTime: string | null;
  imagePath: string | null;
  /** 選択肢グループが設定されている商品か（タップ時にダイアログを出す） */
  hasOptions: boolean;
}

export interface HandyMenuItemView extends HandyMenuItemInput {
  /** 現在時刻が販売時間外（注文できない） */
  offHours: boolean;
}

export interface HandyCategoryView {
  id: string;
  name: string;
  nameEn: string | null;
  items: HandyMenuItemView[];
}

/* ---------------------------------------------------------- 上のタブ */

export type HandyTabId = 'alacarte' | 'plan' | 'service';

export interface HandyTabDef {
  id: HandyTabId;
  label: string;
  en: string;
}

/** 注文画面の上のタブ（店舗要望「1を単品全部（フード＆ドリンク）、2をコース＆飲み放題、3をサービス」） */
export const HANDY_TABS: readonly HandyTabDef[] = [
  { id: 'alacarte', label: '単品', en: 'A la carte' },
  { id: 'plan', label: 'コース・飲み放題', en: 'Course & Plan' },
  { id: 'service', label: 'サービス', en: 'Service' },
] as const;

/**
 * 1商品をどのタブに出すか。
 * サービス（item_type='option'）→ 3、コースの商品か「プランのときだけ」のカテゴリ（(F) の飲み放題の中身など）→ 2、
 * それ以外（フード・ドリンク・種類が分からないもの）→ 1 単品。
 */
export function handyTabOf(itemType: string | null | undefined, inPlanCategory: boolean): HandyTabId {
  if (itemType === 'option') return 'service';
  if (itemType === 'course' || inPlanCategory) return 'plan';
  return 'alacarte';
}

export interface HandyPageView {
  /** ページの先頭カテゴリの id */
  key: string;
  /** 店長が付けた名前（無ければ null） */
  name: string | null;
  /** パンくずに出す名前（店長が付けた名前か、カテゴリ名を「・」でつないだもの） */
  label: string;
  categories: HandyCategoryView[];
  itemCount: number;
}

export interface HandyTabView extends HandyTabDef {
  pages: HandyPageView[];
  itemCount: number;
}

/** メニューブックのページ設定（store_settings.settings.menuBook の pages / categoryPage） */
export interface HandyPagesConfig {
  pages: MenuPageDef[];
  categoryPage: Record<string, string>;
}

/** 承認済みUIのタイル下線の紫系アクセント（並び順に循環させる） */
export const TILE_ACCENTS = [
  '#7b3fe4',
  '#a778dc',
  '#5e4777',
  '#b99bd8',
  '#8d6baa',
  '#c6afdf',
  '#684298',
] as const;

/** 'HH:MM[:SS]' を0〜1439の分に直す。読めない値は null */
function toMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * 販売時間内か。開始・終了のどちらかが無ければ終日販売とみなす。
 * 終了が開始より前（例 22:00〜02:00）は日をまたぐ時間帯として扱う。
 */
export function isOnSaleAt(
  item: Pick<HandyMenuItemInput, 'sellStartTime' | 'sellEndTime'>,
  nowHm: string
): boolean {
  const start = toMinutes(item.sellStartTime);
  const end = toMinutes(item.sellEndTime);
  const now = toMinutes(nowHm);
  if (start === null || end === null || now === null) return true;
  if (start === end) return true;
  // 終了時刻ちょうどまで販売中とする（QR注文のサーバー側 create_qr_order の判定と揃える）
  return start < end ? now >= start && now <= end : now >= start || now <= end;
}

const byOrderThenName = (a: HandyMenuItemView, b: HandyMenuItemView) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja');

/**
 * 上のタブ → ページ（メニューブックのページ）→ カテゴリ → 商品 を組み立てる。
 * categories はページの区切りを並び順で決めるため、出さないカテゴリも含めて全部渡す。
 * 商品が1つも無いカテゴリ・ページ・タブは返さない（空のタブ・タイルを出さない）。
 */
export function buildHandyTabs(
  categories: HandyCategoryInput[],
  items: HandyMenuItemInput[],
  nowHm: string,
  opts: { planCategoryIds?: ReadonlySet<string>; pages?: HandyPagesConfig } = {}
): HandyTabView[] {
  const planIds = opts.planCategoryIds ?? new Set<string>();
  const pagesConfig = opts.pages ?? { pages: [], categoryPage: {} };
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const sortedCategories = [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja')
  );
  // 0円だけのカテゴリ＝食べ放題・飲み放題の中身。ページ（上のタブ）の自動振り分けに使う
  const zeroOnly = new Map<string, boolean>();
  for (const i of items) {
    if (!i.categoryId) continue;
    zeroOnly.set(i.categoryId, (zeroOnly.get(i.categoryId) ?? true) && Number(i.price) === 0);
  }
  const categoriesForPages = sortedCategories.map((c) => ({ ...c, allZeroPrice: zeroOnly.get(c.id) ?? false }));

  // タブ → カテゴリID → 商品
  const byTab = new Map<HandyTabId, Map<string, HandyMenuItemView[]>>();
  for (const item of items) {
    const category = item.categoryId ? categoryById.get(item.categoryId) : undefined;
    // 削除済み・未設定カテゴリの商品はレジ（POS）でも出さないので、ハンディでも出さない
    if (!category) continue;
    const tabId = handyTabOf(item.itemType, planIds.has(category.id));
    const tabMap = byTab.get(tabId) ?? new Map<string, HandyMenuItemView[]>();
    const list = tabMap.get(category.id) ?? [];
    list.push({ ...item, offHours: !isOnSaleAt(item, nowHm) });
    tabMap.set(category.id, list);
    byTab.set(tabId, tabMap);
  }

  const views: HandyTabView[] = [];
  for (const def of HANDY_TABS) {
    const tabMap = byTab.get(def.id);
    if (!tabMap) continue;
    const pages: HandyPageView[] = groupMenuPages(categoriesForPages, pagesConfig, (c) => tabMap.has(c.id)).map(
      (page) => {
        const categoryViews: HandyCategoryView[] = page.categories.map((c) => ({
          id: c.id,
          name: c.name,
          nameEn: c.nameEn,
          items: (tabMap.get(c.id) ?? []).sort(byOrderThenName),
        }));
        return {
          key: page.key,
          name: page.name,
          label: menuPageLabel(page, (c) => c.name),
          categories: categoryViews,
          itemCount: categoryViews.reduce((n, c) => n + c.items.length, 0),
        };
      }
    );
    const itemCount = pages.reduce((n, p) => n + p.itemCount, 0);
    if (itemCount === 0) continue;
    views.push({ ...def, pages, itemCount });
  }
  return views;
}

/**
 * 注文画面を開いたときのタブ。飲み放題・コースの卓で、その中身（プランのときだけのカテゴリ）が出ていれば
 * 2 コース・飲み放題、それ以外は先頭のタブ。
 */
export function initialHandyTab(
  tabs: HandyTabView[],
  planCategoryIds: ReadonlySet<string>,
  hasPlan: boolean
): HandyTabId | null {
  if (hasPlan) {
    const planTab = tabs.find((t) => t.id === 'plan');
    if (planTab?.pages.some((p) => p.categories.some((c) => planCategoryIds.has(c.id)))) return 'plan';
  }
  return tabs[0]?.id ?? null;
}

/* ---------------------------------------------------------------- カート */

export interface HandyCartLine {
  /** 同じ商品・同じ選択肢をまとめるためのキー */
  key: string;
  menuItemId: string;
  name: string;
  nameEn: string | null;
  /** 選択肢の追加料金を含む単価 */
  unitPrice: number;
  quantity: number;
  optionItemIds: string[];
  /** 「大盛り・チーズ」のような表示用ラベル */
  optionLabel: string;
}

/** 商品＋選択肢の組み合わせで一意になるキー（選択肢の並び順に依存しない） */
export function cartLineKey(menuItemId: string, optionItemIds: string[]): string {
  return [menuItemId, ...[...optionItemIds].sort()].join('|');
}

export function cartCount(lines: HandyCartLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

export function cartTotal(lines: HandyCartLine[]): number {
  return lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
}

/** 1商品の上限数量（送信時に addItem を数量ぶん呼ぶため、現場で使う範囲に制限する） */
export const MAX_LINE_QUANTITY = 20;

/**
 * カートに1行足す（同じ商品・同じ選択肢なら数量を加算する）。
 * 上限を超える分は加算しない（黙って増やさない）。
 */
export function addCartLine(
  lines: HandyCartLine[],
  line: Omit<HandyCartLine, 'key' | 'quantity'>,
  quantity: number
): HandyCartLine[] {
  const key = cartLineKey(line.menuItemId, line.optionItemIds);
  const index = lines.findIndex((l) => l.key === key);
  if (index < 0) {
    return [...lines, { ...line, key, quantity: Math.min(quantity, MAX_LINE_QUANTITY) }];
  }
  const next = [...lines];
  next[index] = {
    ...next[index],
    quantity: Math.min(next[index].quantity + quantity, MAX_LINE_QUANTITY),
  };
  return next;
}

/** 数量を増減する。0以下になった行は取り除く */
export function changeCartQuantity(
  lines: HandyCartLine[],
  key: string,
  delta: number
): HandyCartLine[] {
  return lines
    .map((l) =>
      l.key === key
        ? { ...l, quantity: Math.max(0, Math.min(MAX_LINE_QUANTITY, l.quantity + delta)) }
        : l
    )
    .filter((l) => l.quantity > 0);
}

/* ------------------------------------------------------------ 呼び出し */

export type ServiceCallKind = 'staff' | 'checkout';

export interface HandyServiceCall {
  id: string;
  tableId: string;
  tableName: string | null;
  kind: ServiceCallKind;
  createdAtMs: number;
  note: string | null;
}

export function serviceCallLabel(kind: ServiceCallKind): string {
  return kind === 'checkout' ? 'お会計希望' : 'スタッフ呼び出し';
}

/** 未対応の呼び出しを古い順（待たせている順）に並べる */
export function sortServiceCalls(calls: HandyServiceCall[]): HandyServiceCall[] {
  return [...calls].sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
}

/**
 * 卓ごとの呼び出しの強調表示。会計希望（橙系）をスタッフ呼び出しより優先する。
 * 呼び出しが無い卓は null。
 */
export function callToneByTable(calls: HandyServiceCall[]): Map<string, ServiceCallKind> {
  const map = new Map<string, ServiceCallKind>();
  for (const c of calls) {
    if (c.kind === 'checkout' || !map.has(c.tableId)) map.set(c.tableId, c.kind);
  }
  return map;
}

/* ---------------------------------------------------------------- 時刻 */

/** 経過時間の表示（45分 / 1時間05分）。未来の時刻は0分として扱う */
export function elapsedLabel(fromMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
  if (minutes < 60) return `${minutes}分`;
  return `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, '0')}分`;
}

/**
 * 卓カードの状態表示。
 * restaurant_tables.current_status の実際の値
 * （available / reserved / waiting / seated / ordering / billing / cleaning / unavailable）に対応させる。
 */
export type HandyTableState = 'occupied' | 'available' | 'reserved' | 'cleaning' | 'blocked';

export function tableState(currentStatus: string | null, hasOpenOrder: boolean): HandyTableState {
  if (hasOpenOrder) return 'occupied';
  if (currentStatus === 'seated' || currentStatus === 'ordering' || currentStatus === 'billing') return 'occupied';
  if (currentStatus === 'cleaning') return 'cleaning';
  if (currentStatus === 'unavailable') return 'blocked';
  if (currentStatus === 'reserved') return 'reserved';
  return 'available'; // available / waiting
}

/**
 * この状態の卓で、ハンディから新しい注文を始められるか。
 * 「予約あり」の卓はフロア画面のウォークイン（startWalkIn）でも着席できない（予約の来店処理が必要）ため、
 * ハンディでも始められない。
 */
export function canStartOrder(state: HandyTableState): boolean {
  return state === 'available' || state === 'occupied';
}

export const TABLE_STATE_LABEL: Record<HandyTableState, string> = {
  occupied: '利用中',
  available: '空席',
  reserved: '予約あり',
  cleaning: '清掃中',
  blocked: '使用不可',
};
