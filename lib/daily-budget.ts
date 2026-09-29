/**
 * 日別の売上予算（2026-09-25 店舗要望「日別予算登録をレジの見本と同じに」）。
 *
 * 日ごとの金額はデータベースの列を増やさず、店舗設定に持つ:
 *   store_settings.settings.dailyBudgets = { "2026-09": { "2026-09-01": 120000, ... } }
 * 金額は税込で持ち、画面の「税抜／税込」はその場の表示・入力の切り替えだけに使う。
 * 月の合計は budgets.sales_budget（予算管理の月次）にも書き戻す。
 */

export const TAX_RATE = 0.1;

export type DailyBudgetMap = Record<string, number>;

/** 'YYYY-MM' の日付をすべて（'YYYY-MM-DD'） */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return [];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** 'YYYY-MM' を n か月ずらす */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 曜日（0=日）。'YYYY-MM-DD' はJSTの暦日としてそのまま扱う */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 店舗設定から、その月の日別予算を取り出す（壊れた値は無視する） */
export function dailyBudgetsFrom(settings: unknown, month: string): DailyBudgetMap {
  const all = (settings as { dailyBudgets?: unknown } | null)?.dailyBudgets;
  if (!all || typeof all !== 'object') return {};
  const raw = (all as Record<string, unknown>)[month];
  if (!raw || typeof raw !== 'object') return {};
  const out: DailyBudgetMap = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isInteger(n) && n >= 0 && n <= 100_000_000) out[date] = n;
  }
  return out;
}

/** 設定に書き戻す形（0は「入れていない」と同じ扱いで消す） */
export function cleanDailyBudgets(values: DailyBudgetMap, month: string): DailyBudgetMap {
  const days = new Set(monthDays(month));
  const out: DailyBudgetMap = {};
  for (const [date, value] of Object.entries(values)) {
    if (!days.has(date)) continue;
    if (!Number.isInteger(value) || value <= 0 || value > 100_000_000) continue;
    out[date] = value;
  }
  return out;
}

/** 月の合計（税込） */
export function monthTotal(values: DailyBudgetMap): number {
  return Object.values(values).reduce((n, v) => n + v, 0);
}

/** 税込 → 税抜（表示用。端数は四捨五入。1100 → 1000） */
export function withoutTax(included: number): number {
  return Math.round(included / (1 + TAX_RATE));
}

/** 税抜 → 税込（入力用。端数は四捨五入） */
export function withTax(excluded: number): number {
  return Math.round(excluded * (1 + TAX_RATE));
}

// ---------------------------------------------------------------------------
// 月の目標を曜日の売上に合わせて日ごとに分ける（2026-09-30 Ronnie「金曜 100万・月曜 40万のように、毎日同じではない。
// 前の月・前の週の曜日ごとの売上をもとに日報の目標予算を自動で。1か月分をそのままホームに」）
// ---------------------------------------------------------------------------

/** 曜日を見る日数（直近8週＝前の月と前の週を含む） */
export const WEEKDAY_WEIGHT_DAYS = 56;

/**
 * 曜日ごとの1日あたりの売上（0=日〜6=土）。売上のあった最初の日から最後の日までの日を数える
 * （TENPO ONE を使い始める前の日は数えない。休みの曜日は 0 になる）。
 */
export function weekdayWeights(daily: readonly { date: string; sales: number }[]): number[] {
  const withSales = daily.filter((d) => d.sales > 0).map((d) => d.date).sort();
  const sums = Array(7).fill(0) as number[];
  const counts = Array(7).fill(0) as number[];
  if (withSales.length === 0) return sums;
  const first = withSales[0];
  const last = withSales[withSales.length - 1];
  const byDate = new Map<string, number>();
  for (const d of daily) byDate.set(d.date, (byDate.get(d.date) ?? 0) + Math.max(0, d.sales));
  for (let date = first; date <= last; date = nextDate(date)) {
    const w = weekdayOf(date);
    sums[w] += byDate.get(date) ?? 0;
    counts[w] += 1;
  }
  return sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
}

function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 月の目標（税込）を曜日の重みで日ごとに分ける。100円単位に丸め、合計はぴったり目標に合わせる
 * （端数はいちばん売れる日に足す）。重みが全部 0（売上の記録が無い）なら毎日同じ。
 */
export function distributeByWeekday(total: number, month: string, weights: readonly number[]): DailyBudgetMap {
  const days = monthDays(month);
  if (days.length === 0 || !(total > 0)) return {};
  const raw = days.map((d) => Math.max(0, weights[weekdayOf(d)] ?? 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? raw : days.map(() => 1);
  const wSum = w.reduce((a, b) => a + b, 0);
  const out: DailyBudgetMap = {};
  let used = 0;
  days.forEach((d, i) => {
    const v = Math.floor((total * w[i]) / wSum / 100) * 100;
    if (v > 0) out[d] = v;
    used += v;
  });
  const rest = Math.round(total) - used;
  if (rest > 0) {
    let best = 0;
    w.forEach((x, i) => {
      if (x > w[best]) best = i;
    });
    out[days[best]] = (out[days[best]] ?? 0) + rest;
  }
  return out;
}
