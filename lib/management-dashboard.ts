/**
 * 経営ダッシュボード（パソコンの新しい管理画面。2026-10-24 Ronnie「dinii の経営管理のような画面を」）の集計。
 * 純粋な関数だけ（DB・Next 非依存。tests/management-dashboard.test.ts）。
 *
 * 数字の定義はレポート（lib/reports-data-server.ts）と同じ：
 *   売上      = 会計済み（paid/refunded）の合計 − 返金（純売上・税込）
 *   原価      = 明細ごとの レシピ原価 → 無ければ商品の原価（components/reports/cost.ts）
 *   人件費    = 勤怠 × 給与ルールの概算（components/reports/labor.ts）
 *   経費      = 承認済みの経費
 *   固定費    = 月次清算の 家賃・電気・水道・その他 の日割り（給料は人件費と重なるので入れない）
 *   営業利益  = 売上 − 原価 − 人件費 − 経費 − 固定費
 */
import { dateSequence, monthBounds } from '@/components/reports/period';

/** 店舗 × 日 の実績（サーバーで集めたもの） */
export interface DayFact {
  storeId: string;
  date: string;
  sales: number;
  guests: number;
  groups: number;
  cost: number;
  labor: number;
  expenses: number;
}

export interface BudgetRow {
  storeId: string | null;
  salesBudget: number;
  costRateTarget: number | null;
  laborRateTarget: number | null;
  profitTarget: number | null;
}

export interface PlNumbers {
  sales: number;
  guests: number;
  groups: number;
  avgSpend: number;
  cost: number;
  labor: number;
  expenses: number;
  fixed: number;
  profit: number;
  costRatePct: number | null;
  laborRatePct: number | null;
  profitRatePct: number | null;
}

export interface StoreSummary extends PlNumbers {
  id: string;
  name: string;
  /** 月の売上予算 */
  budget: number | null;
  /** 売上 ÷ 月の予算 */
  achievementPct: number | null;
  /** 今日までの予算の累計（日別予算 → 無ければ月予算÷日数） */
  paceBudget: number | null;
  /** 売上 ÷ 今日までの予算の累計 */
  pacePct: number | null;
}

export interface DayCell extends PlNumbers {
  date: string;
  budget: number | null;
  achievementPct: number | null;
  isToday: boolean;
  isFuture: boolean;
}

export interface Targets {
  costRateTarget: number | null;
  laborRateTarget: number | null;
  profitTarget: number | null;
}

export interface ManagementSummary {
  month: string;
  total: StoreSummary;
  targets: Targets;
  stores: StoreSummary[];
  days: DayCell[];
  /** 月の日数と、今日までの日数 */
  daysInMonth: number;
  daysElapsed: number;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function plOf(sum: { sales: number; guests: number; groups: number; cost: number; labor: number; expenses: number; fixed: number }): PlNumbers {
  const profit = sum.sales - sum.cost - sum.labor - sum.expenses - sum.fixed;
  return {
    ...sum,
    avgSpend: sum.guests > 0 ? Math.floor(sum.sales / sum.guests) : 0,
    profit,
    costRatePct: pct(sum.cost, sum.sales),
    laborRatePct: pct(sum.labor, sum.sales),
    profitRatePct: pct(profit, sum.sales),
  };
}

const ZERO = { sales: 0, guests: 0, groups: 0, cost: 0, labor: 0, expenses: 0, fixed: 0 };

function add(a: typeof ZERO, b: Partial<typeof ZERO>): typeof ZERO {
  return {
    sales: a.sales + (b.sales ?? 0),
    guests: a.guests + (b.guests ?? 0),
    groups: a.groups + (b.groups ?? 0),
    cost: a.cost + (b.cost ?? 0),
    labor: a.labor + (b.labor ?? 0),
    expenses: a.expenses + (b.expenses ?? 0),
    fixed: a.fixed + (b.fixed ?? 0),
  };
}

export function achievement(actual: number, budget: number | null): number | null {
  if (!budget || budget <= 0) return null;
  return Math.max(0, Math.round((actual / budget) * 100));
}

/**
 * 月の実績を 店舗別・日別・合計 にまとめる。
 * dailyBudget(storeId, date)：その日の予算（日別予算 → 無ければ月予算÷日数。無ければ null）
 * fixedPerDay(storeId)：固定費の 1 日ぶん
 * 全店舗の月予算は 会社の行（storeId null）があればそれ、無ければ店舗の行の合計。
 */
export function summarizeManagement(input: {
  month: string;
  today: string;
  stores: { id: string; name: string }[];
  facts: DayFact[];
  budgets: BudgetRow[];
  dailyBudget: (storeId: string, date: string) => number | null;
  fixedPerDay: (storeId: string) => number;
  /** 全店舗で会社の予算行を使うか（店舗を 1 つ選んでいるときは false） */
  useOrgBudget: boolean;
}): ManagementSummary {
  const { first, last } = monthBounds(0, `${input.month}-01`);
  const dates = dateSequence(first, last);
  const elapsed = dates.filter((d) => d <= input.today);
  const byKey = new Map<string, DayFact>();
  for (const f of input.facts) byKey.set(`${f.storeId}|${f.date}`, f);

  const orgRow = input.useOrgBudget ? (input.budgets.find((b) => b.storeId === null) ?? null) : null;
  const storeRow = (id: string) => input.budgets.find((b) => b.storeId === id) ?? null;

  const stores: StoreSummary[] = input.stores.map((s) => {
    let sum = { ...ZERO };
    let paceBudget = 0;
    let anyPace = false;
    const fixedDay = input.fixedPerDay(s.id);
    for (const d of elapsed) {
      const f = byKey.get(`${s.id}|${d}`);
      sum = add(sum, { ...(f ?? {}), fixed: fixedDay });
      const b = input.dailyBudget(s.id, d);
      if (b != null && b > 0) {
        paceBudget += b;
        anyPace = true;
      }
    }
    const row = storeRow(s.id);
    const budget = row && row.salesBudget > 0 ? row.salesBudget : null;
    const pl = plOf(sum);
    return {
      id: s.id,
      name: s.name,
      ...pl,
      budget,
      achievementPct: achievement(pl.sales, budget),
      paceBudget: anyPace ? paceBudget : null,
      pacePct: achievement(pl.sales, anyPace ? paceBudget : null),
    };
  });

  // ---- 合計 ----
  const totalSum = stores.reduce((a, s) => add(a, s), { ...ZERO });
  const totalPl = plOf(totalSum);
  let totalBudget: number | null;
  let totalPace: number | null;
  if (orgRow && orgRow.salesBudget > 0) {
    totalBudget = orgRow.salesBudget;
    const perDay = Math.floor(orgRow.salesBudget / dates.length);
    totalPace = perDay * elapsed.length;
  } else {
    const sum = stores.reduce((a, s) => a + (s.budget ?? 0), 0);
    totalBudget = sum > 0 ? sum : null;
    const pace = stores.reduce((a, s) => a + (s.paceBudget ?? 0), 0);
    totalPace = pace > 0 ? pace : null;
  }
  const total: StoreSummary = {
    id: 'all',
    name: '合計',
    ...totalPl,
    budget: totalBudget,
    achievementPct: achievement(totalPl.sales, totalBudget),
    paceBudget: totalPace,
    pacePct: achievement(totalPl.sales, totalPace),
  };

  // ---- 目標（原価率・人件費率・利益）：会社の行 → 無ければ店舗の行を予算で重み付け ----
  const weighted = (pick: (b: BudgetRow) => number | null): number | null => {
    if (orgRow && pick(orgRow) != null) return pick(orgRow);
    const rows = input.stores.map((s) => storeRow(s.id)).filter((b): b is BudgetRow => !!b && pick(b) != null);
    if (rows.length === 0) return null;
    const w = rows.reduce((a, b) => a + Math.max(0, b.salesBudget), 0);
    if (w <= 0) return Math.round((rows.reduce((a, b) => a + (pick(b) as number), 0) / rows.length) * 10) / 10;
    return Math.round((rows.reduce((a, b) => a + (pick(b) as number) * Math.max(0, b.salesBudget), 0) / w) * 10) / 10;
  };
  const profitTarget = orgRow?.profitTarget ?? (() => {
    const rows = input.stores.map((s) => storeRow(s.id)).filter((b): b is BudgetRow => !!b && b.profitTarget != null);
    return rows.length > 0 ? rows.reduce((a, b) => a + (b.profitTarget as number), 0) : null;
  })();
  const targets: Targets = {
    costRateTarget: weighted((b) => b.costRateTarget),
    laborRateTarget: weighted((b) => b.laborRateTarget),
    profitTarget,
  };

  // ---- 日別（カレンダー）----
  const fixedAll = input.stores.reduce((a, s) => a + input.fixedPerDay(s.id), 0);
  const days: DayCell[] = dates.map((d) => {
    const isFuture = d > input.today;
    let sum = { ...ZERO };
    let budget = 0;
    let anyBudget = false;
    if (orgRow && orgRow.salesBudget > 0) {
      budget = Math.floor(orgRow.salesBudget / dates.length);
      anyBudget = budget > 0;
    }
    for (const s of input.stores) {
      const f = byKey.get(`${s.id}|${d}`);
      if (!isFuture) sum = add(sum, f ?? {});
      if (!(orgRow && orgRow.salesBudget > 0)) {
        const b = input.dailyBudget(s.id, d);
        if (b != null && b > 0) {
          budget += b;
          anyBudget = true;
        }
      }
    }
    if (!isFuture) sum = add(sum, { fixed: fixedAll });
    const pl = plOf(sum);
    return {
      date: d,
      ...pl,
      budget: anyBudget ? budget : null,
      achievementPct: isFuture ? null : achievement(pl.sales, anyBudget ? budget : null),
      isToday: d === input.today,
      isFuture,
    };
  });

  return { month: input.month, total, targets, stores, days, daysInMonth: dates.length, daysElapsed: elapsed.length };
}

/** 月曜はじまりの週ごとに並べる（月の外は null） */
export function calendarWeeks<T extends { date: string }>(cells: T[]): (T | null)[][] {
  if (cells.length === 0) return [];
  const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // 月=0
  const weeks: (T | null)[][] = [];
  let week: (T | null)[] = Array(weekday(cells[0].date)).fill(null);
  for (const c of cells) {
    week.push(c);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

/** 前後の月（YYYY-MM） */
export function shiftMonthKey(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function parseMonthKey(v: string | string[] | undefined, today: string): string {
  const s = Array.isArray(v) ? v[0] : v;
  if (s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s;
  return today.slice(0, 7);
}
