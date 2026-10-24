/**
 * 新しい管理画面（パソコン）のホーム：期間タブと比較（2026-10-24 Ronnie「funfo・dinii のおすすめを取り入れる」）。
 * 純粋な関数だけ（DB・Next 非依存。tests/home-period.test.ts）。
 *
 *   期間: 本日 / 昨日 / 過去7日間 / 今月 / 期間指定
 *   比較: 前日比（同じ長さの直前の期間）/ 前週同曜日比（7日前）/ 前月同日比（1か月前の同じ日）
 */
import { addDaysStr, diffDaysStr, monthBounds, dateSequence } from '@/components/reports/period';
import { dailyBudgetsFrom } from '@/lib/daily-budget';
import { dailyBudgetFromMonthly } from '@/lib/home-todos';

export type HomeRange = 'today' | 'yesterday' | '7d' | 'month' | 'year' | 'custom';
export type HomeCompare = 'day' | 'week' | 'month' | 'year';

export const HOME_RANGES: { key: HomeRange; label: string }[] = [
  { key: 'today', label: '本日' },
  { key: 'yesterday', label: '昨日' },
  { key: '7d', label: '過去7日間' },
  { key: 'month', label: '今月' },
  { key: 'year', label: '今年' },
  { key: 'custom', label: '期間指定' },
];

export const HOME_COMPARES: { key: HomeCompare; label: string }[] = [
  { key: 'day', label: '前日比' },
  { key: 'week', label: '前週同曜日比' },
  { key: 'month', label: '前月同日比' },
  { key: 'year', label: '前年同期比' },
];

/** 今年（1/1〜今日）のタブは、日の比較だと意味が薄いので 前年同期比 を既定にする（2026-10-24 Ronnie「1月1日から今日までも」） */
export function defaultCompareFor(range: HomeRange, compare: HomeCompare): HomeCompare {
  if (range === 'year' && (compare === 'day' || compare === 'week')) return 'year';
  return compare;
}

/** 下のカードのタブ：時間帯別 / 支払い方法 / ベストセラー（funfo のダッシュボードと同じ並び） */
export type HomeCard = 'hourly' | 'pay' | 'best';

export const HOME_CARDS: { key: HomeCard; label: string }[] = [
  { key: 'hourly', label: '時間帯別' },
  { key: 'pay', label: '支払い方法' },
  { key: 'best', label: 'ベストセラー' },
];

export function parseHomeCard(v: string | string[] | undefined): HomeCard {
  const s = Array.isArray(v) ? v[0] : v;
  return HOME_CARDS.some((c) => c.key === s) ? (s as HomeCard) : 'hourly';
}

/** 客席回転率（1日平均）＝ 客数 ÷ 席数 ÷ 日数。席が無ければ null。小数 1 桁 */
export function turnoverPerDay(guests: number, seats: number, days: number): number | null {
  if (seats <= 0 || days <= 0) return null;
  return Math.round((guests / seats / days) * 10) / 10;
}

/** 期間の中で 2 回以上会計した顧客の割合（顧客を紐づけた会計だけ）。対象が無ければ null */
export function repeatWithin(customerIds: (string | null | undefined)[]): { repeaters: number; newcomers: number; ratePct: number | null } {
  const counts = new Map<string, number>();
  for (const id of customerIds) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  let repeaters = 0;
  for (const n of counts.values()) if (n >= 2) repeaters += 1;
  const total = counts.size;
  return { repeaters, newcomers: total - repeaters, ratePct: total > 0 ? Math.round((repeaters / total) * 100) : null };
}

export interface DateRange {
  from: string;
  to: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseHomeRange(v: string | string[] | undefined): HomeRange {
  const s = Array.isArray(v) ? v[0] : v;
  return HOME_RANGES.some((r) => r.key === s) ? (s as HomeRange) : 'today';
}

export function parseHomeCompare(v: string | string[] | undefined): HomeCompare {
  const s = Array.isArray(v) ? v[0] : v;
  return HOME_COMPARES.some((c) => c.key === s) ? (s as HomeCompare) : 'week';
}

function validDate(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && DATE_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? s : null;
}

/**
 * タブと today から期間を決める。期間指定は from/to（壊れていれば今月）。
 * 期間指定が 1 年を超えるときは to から 365 日に切る（重い集計を避ける）。
 */
export function resolveHomeRange(
  range: HomeRange,
  today: string,
  sp?: { from?: string | string[]; to?: string | string[] }
): DateRange {
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDaysStr(today, -1);
      return { from: y, to: y };
    }
    case '7d':
      return { from: addDaysStr(today, -6), to: today };
    case 'month': {
      const { first } = monthBounds(0, today);
      return { from: first, to: today };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom': {
      let from = validDate(sp?.from);
      let to = validDate(sp?.to);
      if (!from && !to) {
        const { first } = monthBounds(0, today);
        return { from: first, to: today };
      }
      if (!from) from = to!;
      if (!to) to = from;
      if (from > to) [from, to] = [to, from];
      if (diffDaysStr(from, to) > 365) from = addDaysStr(to, -365);
      return { from, to };
    }
  }
}

/** 1か月前の同じ日（31日→前月末日のように末日に寄せる） */
export function sameDayPrevMonth(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const prevLast = new Date(Date.UTC(y, m - 1, 0)); // 前月の末日
  const day = Math.min(d, prevLast.getUTCDate());
  return new Date(Date.UTC(prevLast.getUTCFullYear(), prevLast.getUTCMonth(), day)).toISOString().slice(0, 10);
}

/** 1 年前の同じ日（2/29 → 2/28） */
export function sameDayPrevYear(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** 比較する期間。day=同じ長さの直前、week=7日前、month=1か月前の同じ日付、year=1年前の同じ日付 */
export function compareRange(range: DateRange, compare: HomeCompare): DateRange {
  const days = diffDaysStr(range.from, range.to) + 1;
  if (compare === 'day') {
    const to = addDaysStr(range.from, -1);
    return { from: addDaysStr(to, -(days - 1)), to };
  }
  if (compare === 'week') return { from: addDaysStr(range.from, -7), to: addDaysStr(range.to, -7) };
  if (compare === 'year') return { from: sameDayPrevYear(range.from), to: sameDayPrevYear(range.to) };
  return { from: sameDayPrevMonth(range.from), to: sameDayPrevMonth(range.to) };
}

/** ホームの URL（?range=&compare=&from=&to=&card=。既定の値は付けない） */
export function homeHref(p: { range: HomeRange; compare: HomeCompare; custom?: DateRange; card?: HomeCard }): string {
  const q = new URLSearchParams();
  if (p.range !== 'today') q.set('range', p.range);
  if (p.compare !== 'week') q.set('compare', p.compare);
  if (p.range === 'custom' && p.custom) {
    q.set('from', p.custom.from);
    q.set('to', p.custom.to);
  }
  if (p.card && p.card !== 'hourly') q.set('card', p.card);
  const s = q.toString();
  return s ? `/app/dashboard?${s}` : '/app/dashboard';
}

/** 'M/D' */
export function md(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 期間の見出し（'10/24' / '10/18〜10/24'。年がちがえば '2025/1/1〜2025/10/24'） */
export function rangeLabel(range: DateRange, today?: string): string {
  const y = today ? today.slice(0, 4) : range.to.slice(0, 4);
  const f = (d: string) => (d.slice(0, 4) === y ? md(d) : `${Number(d.slice(0, 4))}/${md(d)}`);
  return range.from === range.to ? f(range.from) : `${f(range.from)}〜${f(range.to)}`;
}

export interface Delta {
  /** 増減率（%・小数1桁）。前が 0 なら null */
  pct: number | null;
  diff: number;
  direction: 'up' | 'down' | 'flat';
}

export function delta(current: number, previous: number): Delta {
  const diff = current - previous;
  if (previous === 0) return { pct: null, diff, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return { pct, diff, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

export interface PeriodOrderLike {
  store_id: string;
  total: number;
  guest_count?: number | null;
  status?: string;
  order_type?: string | null;
}

/**
 * 期間の予算（税込）。日ごとに「日別予算 → 無ければ月予算 ÷ 日数」。どの店にも予算が無ければ null。
 * monthlyByStoreMonth: `${storeId}|${YYYY-MM}` → 月の売上予算
 */
export function budgetForRange(input: {
  range: DateRange;
  storeIds: string[];
  settingsByStore: ReadonlyMap<string, unknown>;
  monthlyByStoreMonth: ReadonlyMap<string, number>;
}): number | null {
  let total = 0;
  let any = false;
  const dates = dateSequence(input.range.from, input.range.to);
  for (const storeId of input.storeIds) {
    const settings = input.settingsByStore.get(storeId);
    const dailyByMonth = new Map<string, Record<string, number>>();
    for (const date of dates) {
      const month = date.slice(0, 7);
      if (!dailyByMonth.has(month)) dailyByMonth.set(month, dailyBudgetsFrom(settings, month));
      const daily = dailyByMonth.get(month)![date];
      const monthly = input.monthlyByStoreMonth.get(`${storeId}|${month}`) ?? null;
      const value = daily != null && daily > 0 ? daily : dailyBudgetFromMonthly(monthly, date);
      if (value != null && value > 0) {
        total += value;
        any = true;
      }
    }
  }
  return any ? total : null;
}

/** 達成率（%・整数）。予算が無ければ null */
export function achievementPct(actual: number, budget: number | null): number | null {
  if (!budget || budget <= 0) return null;
  return Math.max(0, Math.round((actual / budget) * 100));
}
