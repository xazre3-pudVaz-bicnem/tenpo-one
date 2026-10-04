/**
 * 月次清算（管理画面）の計算（純関数・テスト対象）。
 *
 * 店ごと・月ごとに「レジで入れたもの（売上・経費）」と「仕入先の請求書」と「本部が入れる家賃・電気・水道・給料」を
 * 1つの表にして、今週・今月の赤字黒字を出す（2026-10-04 Ronnie。Google スプレッドシートの
 * 「Oriental Elephant Sales Report」＝日付×仕入先の表を、管理画面に置き換える。レジ（iPad）には出さない）。
 *
 * 家賃・電気・水道・給料の保存先は店舗設定 store_settings.settings.monthlyCosts（DB の変更なし・全店共通）:
 *   { "2026-09": { rent: 220000, electric: 35000, water: 8000, salary: 1200000, other: [{ name: "ガス", amount: 12000 }] } }
 * 週の損益は、月の金額を日割り（月の金額 ÷ その月の日数 × 週のうちその月の日数）で引く。
 */
import { addDaysStr, dateSequence, diffDaysStr, monthBounds, mondayOfStr } from '@/components/reports/period';
import { can, type Role } from '@/lib/permissions';

/** 家賃・電気・水道・給料を入れられるのは本部（企業）側だけ（2026-10-04 Ronnie「企業から追加」）＝契約企業オーナー・本社管理者・本社経理 */
export function canEditMonthlyCosts(ctx: { isHq: boolean; role: Role | null }): boolean {
  return ctx.isHq && can(ctx.role, 'cash.write');
}

/** 固定費の種類（本部が月ごとに入れる） */
export const FIXED_COST_KINDS = ['rent', 'electric', 'water', 'salary'] as const;
export type FixedCostKind = (typeof FIXED_COST_KINDS)[number];

export const FIXED_COST_LABELS: Record<FixedCostKind, { ja: string; en: string }> = {
  rent: { ja: '家賃', en: 'Rent' },
  electric: { ja: '電気', en: 'Electricity' },
  water: { ja: '水道', en: 'Water' },
  salary: { ja: '給料', en: 'Payroll' },
};

export interface OtherCost {
  name: string;
  amount: number;
}

export interface MonthlyCosts {
  rent: number;
  electric: number;
  water: number;
  salary: number;
  other: OtherCost[];
}

/** 「その他」の行数の上限（暴走防止） */
export const MAX_OTHER_COSTS = 20;

export const EMPTY_MONTHLY_COSTS: MonthlyCosts = { rent: 0, electric: 0, water: 0, salary: 0, other: [] };

function yenInt(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** 1か月ぶんの固定費を整える（数値でない・負の値は 0、その他は名前のある行だけ） */
export function normalizeMonthlyCosts(raw: unknown): MonthlyCosts {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const other: OtherCost[] = [];
  if (Array.isArray(r.other)) {
    for (const o of r.other) {
      if (!o || typeof o !== 'object') continue;
      const name = String((o as { name?: unknown }).name ?? '').trim();
      const amount = yenInt((o as { amount?: unknown }).amount);
      if (!name) continue;
      other.push({ name: name.slice(0, 40), amount });
      if (other.length >= MAX_OTHER_COSTS) break;
    }
  }
  return { rent: yenInt(r.rent), electric: yenInt(r.electric), water: yenInt(r.water), salary: yenInt(r.salary), other };
}

export function isEmptyMonthlyCosts(c: MonthlyCosts): boolean {
  return c.rent === 0 && c.electric === 0 && c.water === 0 && c.salary === 0 && c.other.length === 0;
}

/** store_settings.settings から、ある月（YYYY-MM）の固定費を読む。未設定は全部 0 */
export function monthlyCostsFrom(settings: unknown, month: string): MonthlyCosts {
  const all = (settings as { monthlyCosts?: unknown } | null)?.monthlyCosts;
  if (!all || typeof all !== 'object' || Array.isArray(all)) return { ...EMPTY_MONTHLY_COSTS, other: [] };
  return normalizeMonthlyCosts((all as Record<string, unknown>)[month]);
}

/** 家賃＋電気＋水道＋その他（給料は別に見せる） */
export function fixedCostTotal(c: MonthlyCosts): number {
  return c.rent + c.electric + c.water + c.other.reduce((s, o) => s + o.amount, 0);
}

/** 月の固定費・給料を 1 日ぶんにする（月の日数で割る。端数は切り捨て） */
export function perDayCost(monthly: number, month: string): number {
  const { first, last } = monthBounds(0, `${month}-01`);
  const days = diffDaysStr(first, last) + 1;
  return Math.floor(monthly / days);
}

/** 日付（YYYY-MM-DD）の並びに対する固定費・給料の日割り合計。月をまたぐ週にも対応 */
export function proratedCosts(dates: readonly string[], costsByMonth: (month: string) => MonthlyCosts): { fixed: number; salary: number } {
  let fixed = 0;
  let salary = 0;
  for (const d of dates) {
    const month = d.slice(0, 7);
    const c = costsByMonth(month);
    fixed += perDayCost(fixedCostTotal(c), month);
    salary += perDayCost(c.salary, month);
  }
  return { fixed, salary };
}

/** 損益の内訳（売上は返金を引いた純売上） */
export interface ProfitLoss {
  sales: number;
  /** 仕入先の請求書 */
  purchases: number;
  /** レジ・管理画面で入れた経費 */
  expenses: number;
  /** 家賃・電気・水道・その他 */
  fixed: number;
  salary: number;
  /** 売上 − 仕入 − 経費 − 固定費 − 給料 */
  profit: number;
}

export function profitLoss(p: Omit<ProfitLoss, 'profit'>): ProfitLoss {
  return { ...p, profit: p.sales - p.purchases - p.expenses - p.fixed - p.salary };
}

/** 今週（月曜〜日曜）。今日までの実績で見るため、終わりは今日 */
export function thisWeekWindow(today: string): { first: string; last: string; dates: string[] } {
  const first = mondayOfStr(today);
  const last = today;
  return { first, last, dates: dateSequence(first, last) };
}

/** 月の日付の並び（今日より先は含めない＝今月の途中なら今日まで） */
export function monthWindow(
  month: string,
  today: string
): { first: string; last: string; monthLast: string; dates: string[]; daysInMonth: number; inProgress: boolean } {
  const { first, last } = monthBounds(0, `${month}-01`);
  const to = today < last ? (today < first ? first : today) : last;
  return { first, last: to, monthLast: last, dates: dateSequence(first, to), daysInMonth: diffDaysStr(first, last) + 1, inProgress: to < last };
}

export function prevMonth(month: string): string {
  return monthBounds(-1, `${month}-01`).first.slice(0, 7);
}
export function nextMonth(month: string): string {
  return monthBounds(1, `${month}-01`).first.slice(0, 7);
}

export function isMonthKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** 日付×仕入先の表の1行 */
export interface DailyRow {
  date: string;
  sales: number;
  /** 仕入先ごとの請求書の金額（列の並びは vendors） */
  byVendor: number[];
  /** レジ・管理画面で入れた経費 */
  expenses: number;
  /** 仕入＋経費 */
  outgo: number;
}

export interface DailyTable {
  vendors: string[];
  rows: DailyRow[];
  totals: { sales: number; byVendor: number[]; expenses: number; outgo: number };
  /** 仕入先ごとの 売上に対する % （売上 0 なら null） */
  vendorShare: (number | null)[];
  expensesShare: number | null;
  outgoShare: number | null;
}

export interface PurchaseLine {
  date: string;
  vendor: string;
  amount: number;
}

/**
 * スプレッドシートと同じ「日付 × 仕入先」の表を組む。
 * 仕入先の列は金額の多い順（同額は名前順）。日付は dates の順（今日より先は出さない）。
 */
export function buildDailyTable(
  dates: readonly string[],
  salesByDate: ReadonlyMap<string, number>,
  purchases: readonly PurchaseLine[],
  expensesByDate: ReadonlyMap<string, number>
): DailyTable {
  const inRange = new Set(dates);
  const vendorTotal = new Map<string, number>();
  const cell = new Map<string, number>();
  for (const p of purchases) {
    if (!inRange.has(p.date)) continue;
    const name = p.vendor.trim() || '仕入先なし';
    vendorTotal.set(name, (vendorTotal.get(name) ?? 0) + p.amount);
    const k = `${p.date}\u0001${name}`;
    cell.set(k, (cell.get(k) ?? 0) + p.amount);
  }
  const vendors = [...vendorTotal.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);

  const rows: DailyRow[] = dates.map((date) => {
    const byVendor = vendors.map((v) => cell.get(`${date}\u0001${v}`) ?? 0);
    const expenses = expensesByDate.get(date) ?? 0;
    const purchasesSum = byVendor.reduce((s, x) => s + x, 0);
    return { date, sales: salesByDate.get(date) ?? 0, byVendor, expenses, outgo: purchasesSum + expenses };
  });
  const totals = {
    sales: rows.reduce((s, r) => s + r.sales, 0),
    byVendor: vendors.map((_, i) => rows.reduce((s, r) => s + r.byVendor[i], 0)),
    expenses: rows.reduce((s, r) => s + r.expenses, 0),
    outgo: rows.reduce((s, r) => s + r.outgo, 0),
  };
  const share = (n: number) => (totals.sales > 0 ? Math.round((n / totals.sales) * 10000) / 100 : null);
  return {
    vendors,
    rows,
    totals,
    vendorShare: totals.byVendor.map(share),
    expensesShare: share(totals.expenses),
    outgoShare: share(totals.outgo),
  };
}

/** 「9/1」のような短い日付（表の左端） */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 日付ごとの合計を足す（売上・返金・経費などを日別にまとめるときの共通処理） */
export function sumByDate(rows: readonly { date: string; amount: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.date, (m.get(r.date) ?? 0) + r.amount);
  return m;
}

/** 日別の金額を、日付の範囲で合計する */
export function sumInRange(byDate: ReadonlyMap<string, number>, first: string, last: string): number {
  let s = 0;
  for (const [d, v] of byDate) if (d >= first && d <= last) s += v;
  return s;
}

/** 週の表示（10/1〜10/4 など） */
export function rangeLabel(first: string, last: string): string {
  return first === last ? shortDate(first) : `${shortDate(first)}〜${shortDate(last)}`;
}

export { addDaysStr };
