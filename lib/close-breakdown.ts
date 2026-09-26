/**
 * レジクローズの「売上の内訳」（2026-09-27 Ronnie）:
 *   予約経路別（グルメサイトごと・ウォークイン）／担当者別／よく出たコース・メニュー／飲み放題で出たドリンク（杯数）
 * 日次・月次どちらも同じ計算。画面にだけ出す（クローズのレシートには出さない）。
 * ここは純粋な集計だけ（DB 非依存・テスト対象）。
 */

export interface BreakdownOrder {
  id: string;
  total: number;
  guestCount: number;
  clerkName: string | null;
  /** 予約経路の名前（予約なし＝null → ウォークイン） */
  sourceName: string | null;
  orderType: string | null;
}

export interface BreakdownItem {
  orderId: string;
  menuItemId: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  cancelled: boolean;
  /** menu_items.item_type（course / food / drink / option）。無ければ null */
  itemType: string | null;
  /** カテゴリのステーション（kitchen / drink / grill …） */
  station: string | null;
  /** コースにドリンク（飲み放題）が付いているか */
  includesDrinks: boolean;
}

export interface CountRow {
  label: string;
  /** 伝票数 */
  orders: number;
  guests: number;
  sales: number;
  /** 品数（担当者別） */
  items?: number;
}

export interface ItemRow {
  name: string;
  quantity: number;
  sales: number;
}

export interface NomihoudaiSummary {
  /** 飲み放題プランの数（人数分） */
  planCount: number;
  /** プラン別（名前 → 数） */
  plans: ItemRow[];
  /** 飲み放題で出たドリンクの杯数（合計） */
  glasses: number;
  /** ドリンク別の杯数 */
  drinks: ItemRow[];
  /** 飲み放題の伝票数 */
  orders: number;
}

export interface CloseBreakdown {
  bySource: CountRow[];
  byClerk: CountRow[];
  courses: ItemRow[];
  foods: ItemRow[];
  drinks: ItemRow[];
  nomihoudai: NomihoudaiSummary;
  totals: { orders: number; guests: number; sales: number };
}

export const WALK_IN_LABEL = 'ウォークイン・電話';
export const TAKEOUT_LABEL = 'テイクアウト';
export const NO_CLERK_LABEL = '担当なし';

/** 飲み放題のプランかどうか（フラグ or 名前） */
export function isNomihoudaiPlan(it: Pick<BreakdownItem, 'itemType' | 'includesDrinks' | 'name'>): boolean {
  if (it.itemType !== 'course') return false;
  if (it.includesDrinks) return true;
  return /飲み放題|飲放題|飲放|のみほうだい|free\s*drink|all[-\s]?you[-\s]?can[-\s]?drink/i.test(it.name);
}

function isDrink(it: Pick<BreakdownItem, 'itemType' | 'station'>): boolean {
  return it.itemType === 'drink' || it.station === 'drink';
}

function addCount(map: Map<string, CountRow>, label: string, o: BreakdownOrder, items: number) {
  const cur = map.get(label) ?? { label, orders: 0, guests: 0, sales: 0, items: 0 };
  cur.orders += 1;
  cur.guests += o.guestCount;
  cur.sales += o.total;
  cur.items = (cur.items ?? 0) + items;
  map.set(label, cur);
}

function addItem(map: Map<string, ItemRow>, name: string, qty: number, sales: number) {
  const cur = map.get(name) ?? { name, quantity: 0, sales: 0 };
  cur.quantity += qty;
  cur.sales += sales;
  map.set(name, cur);
}

function sortRows<T extends { sales: number; quantity?: number; orders?: number }>(rows: T[], by: 'sales' | 'quantity' = 'sales'): T[] {
  return rows.sort((a, b) => (by === 'quantity' ? (b.quantity ?? 0) - (a.quantity ?? 0) : b.sales - a.sales) || 0);
}

export function computeCloseBreakdown(orders: BreakdownOrder[], items: BreakdownItem[]): CloseBreakdown {
  const live = items.filter((i) => !i.cancelled && i.quantity > 0);
  const itemsByOrder = new Map<string, BreakdownItem[]>();
  for (const it of live) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    list.push(it);
    itemsByOrder.set(it.orderId, list);
  }

  const bySource = new Map<string, CountRow>();
  const byClerk = new Map<string, CountRow>();
  const totals = { orders: 0, guests: 0, sales: 0 };
  for (const o of orders) {
    const its = itemsByOrder.get(o.id) ?? [];
    const qty = its.reduce((a, i) => a + i.quantity, 0);
    const source = o.orderType === 'takeout' ? TAKEOUT_LABEL : (o.sourceName ?? WALK_IN_LABEL);
    addCount(bySource, source, o, qty);
    addCount(byClerk, o.clerkName?.trim() || NO_CLERK_LABEL, o, qty);
    totals.orders += 1;
    totals.guests += o.guestCount;
    totals.sales += o.total;
  }

  const courses = new Map<string, ItemRow>();
  const foods = new Map<string, ItemRow>();
  const drinks = new Map<string, ItemRow>();
  for (const it of live) {
    if (it.itemType === 'course') addItem(courses, it.name, it.quantity, it.lineTotal);
    else if (isDrink(it)) addItem(drinks, it.name, it.quantity, it.lineTotal);
    else if (it.itemType !== 'option') addItem(foods, it.name, it.quantity, it.lineTotal);
  }

  // 飲み放題: プランが付いている伝票の、値段 0 のドリンク＝飲み放題で出た杯
  const nomiOrders = new Set<string>();
  const plans = new Map<string, ItemRow>();
  let planCount = 0;
  for (const it of live) {
    if (isNomihoudaiPlan(it)) {
      nomiOrders.add(it.orderId);
      planCount += it.quantity;
      addItem(plans, it.name, it.quantity, it.lineTotal);
    }
  }
  const nomiDrinks = new Map<string, ItemRow>();
  let glasses = 0;
  for (const it of live) {
    if (!nomiOrders.has(it.orderId)) continue;
    if (!isDrink(it) || it.unitPrice !== 0) continue;
    glasses += it.quantity;
    addItem(nomiDrinks, it.name, it.quantity, 0);
  }

  return {
    bySource: sortRows([...bySource.values()]),
    byClerk: sortRows([...byClerk.values()]),
    courses: sortRows([...courses.values()], 'quantity'),
    foods: sortRows([...foods.values()], 'quantity'),
    drinks: sortRows([...drinks.values()], 'quantity'),
    nomihoudai: {
      planCount,
      plans: sortRows([...plans.values()], 'quantity'),
      glasses,
      drinks: sortRows([...nomiDrinks.values()], 'quantity'),
      orders: nomiOrders.size,
    },
    totals,
  };
}

/** 'YYYY-MM' → その月の初日と翌月の初日（business_date の範囲用） */
export function monthRange(ym: string): { from: string; toExclusive: string } {
  const [y, m] = ym.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { from, toExclusive: `${ny}-${String(nm).padStart(2, '0')}-01` };
}

/** 'YYYY-MM-DD' の前後の日 */
export function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM' の前後の月 */
export function shiftMonth(ym: string, months: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}
