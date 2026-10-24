import { monthDays, shiftMonth, weekdayOf, weekdayWeights, WEEKDAY_WEIGHT_DAYS, type DailyBudgetMap } from '@/lib/daily-budget';
import type { WeatherIcon } from '@/lib/weather';

/**
 * 履歴から日別予算を自動で作る（2026-10-24 Ronnie「日・月・天気で自動予算を作って。前の履歴を見て」）。
 *   曜日：直近8週（昨日まで）の曜日ごとの1日あたり売上（Web の「今月の売上目標」の配分と同じ重み）
 *   月　：去年の同じ月の1日あたり売上 ÷ 去年の「その前の8週」の1日あたり売上（季節の上がり下がり。無ければ 1.0）
 *   天気：天気予報が出ている日（今日から16日）は 雨・雷 0.92、雪 0.85、それ以外 1.0
 * 金額 = 曜日の売上 × 月の係数 × 天気の係数 を 100円単位に。売上のない曜日（定休日）は 0（入れない）。
 * ここは純粋な計算だけ（DB・Next 非依存・テスト対象）。
 */

export interface DailySales {
  date: string;
  sales: number;
}

export interface AutoBudgetDay {
  date: string;
  /** 0=日〜6=土 */
  weekday: number;
  amount: number;
  /** 曜日の1日あたり売上（直近8週） */
  base: number;
  /** 天気予報（あれば） */
  weather: WeatherIcon | null;
  weatherFactor: number;
}

export interface AutoBudget {
  month: string;
  values: DailyBudgetMap;
  days: AutoBudgetDay[];
  total: number;
  /** 月の係数（去年の同じ月の傾向。無ければ 1） */
  monthFactor: number;
  /** 月の係数を去年の記録から出せたか */
  hasLastYear: boolean;
  /** 曜日の売上を出した期間 */
  baseFrom: string;
  baseTo: string;
  /** 人に見せる根拠（1行） */
  basis: string;
}

/** 天気の係数（雨の日は客が減る。雪はもっと） */
export const WEATHER_FACTOR: Record<WeatherIcon, number> = {
  sun: 1,
  partly: 1,
  cloud: 1,
  fog: 1,
  drizzle: 0.92,
  rain: 0.92,
  snow: 0.85,
  thunder: 0.92,
};

/** 月の係数の上限・下限（去年のデータが偏っていても極端にしない） */
const MONTH_FACTOR_MIN = 0.6;
const MONTH_FACTOR_MAX = 1.6;
/** 去年の係数を出すのに最低必要な売上のあった日数 */
const MIN_DAYS_FOR_MONTH_FACTOR = 12;

export function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 期間の1日あたり売上（売上のあった日だけで割る）。日数が足りなければ null */
function avgDaily(daily: readonly DailySales[], from: string, to: string, minDays: number): number | null {
  const rows = daily.filter((d) => d.date >= from && d.date <= to && d.sales > 0);
  if (rows.length < minDays) return null;
  return rows.reduce((a, d) => a + d.sales, 0) / rows.length;
}

/**
 * 月の係数：去年の同じ月の1日あたり売上 ÷ 去年の「今の曜日の基準期間」と同じ位置（対象月の前の8週）の1日あたり売上。
 * どちらかの記録が足りなければ 1（去年が無い新しい店はそのまま）
 */
export function monthFactorFromLastYear(daily: readonly DailySales[], month: string): { factor: number; hasLastYear: boolean } {
  const lastYearMonth = shiftMonth(month, -12);
  const lyDays = monthDays(lastYearMonth);
  if (lyDays.length === 0) return { factor: 1, hasLastYear: false };
  const lyFirst = lyDays[0];
  const lyLast = lyDays[lyDays.length - 1];
  const target = avgDaily(daily, lyFirst, lyLast, MIN_DAYS_FOR_MONTH_FACTOR);
  const before = avgDaily(daily, addDaysStr(lyFirst, -WEEKDAY_WEIGHT_DAYS), addDaysStr(lyFirst, -1), MIN_DAYS_FOR_MONTH_FACTOR);
  if (target == null || before == null || before <= 0) return { factor: 1, hasLastYear: false };
  const factor = Math.min(MONTH_FACTOR_MAX, Math.max(MONTH_FACTOR_MIN, target / before));
  return { factor: Math.round(factor * 100) / 100, hasLastYear: true };
}

export function buildAutoBudget(input: {
  month: string;
  today: string;
  /** 日ごとの売上（会計済み・税込）。古いものも入れてよい（去年の同じ月に使う） */
  daily: readonly DailySales[];
  /** 天気予報（日付 → アイコン）。無ければ空 */
  forecast?: Readonly<Record<string, WeatherIcon>>;
}): AutoBudget {
  const { month, today, daily } = input;
  const forecast = input.forecast ?? {};
  const baseTo = addDaysStr(today, -1);
  const baseFrom = addDaysStr(today, -WEEKDAY_WEIGHT_DAYS);
  const baseRows = daily.filter((d) => d.date >= baseFrom && d.date <= baseTo);
  const weights = weekdayWeights(baseRows);
  const { factor: monthFactor, hasLastYear } = monthFactorFromLastYear(daily, month);

  const values: DailyBudgetMap = {};
  const days: AutoBudgetDay[] = monthDays(month).map((date) => {
    const weekday = weekdayOf(date);
    const base = Math.round(weights[weekday] ?? 0);
    const weather = forecast[date] ?? null;
    const weatherFactor = weather ? (WEATHER_FACTOR[weather] ?? 1) : 1;
    const amount = base > 0 ? Math.max(100, Math.round((base * monthFactor * weatherFactor) / 100) * 100) : 0;
    if (amount > 0) values[date] = amount;
    return { date, weekday, amount, base, weather, weatherFactor };
  });
  const total = days.reduce((a, d) => a + d.amount, 0);

  const parts = [`直近8週（${baseFrom.slice(5).replace('-', '/')}〜${baseTo.slice(5).replace('-', '/')}）の曜日ごとの売上`];
  if (hasLastYear) parts.push(`去年の同じ月の傾向 ×${monthFactor.toFixed(2)}`);
  if (Object.keys(forecast).length > 0) parts.push('天気予報（雨 ×0.92・雪 ×0.85）');
  return { month, values, days, total, monthFactor, hasLastYear, baseFrom, baseTo, basis: parts.join(' × ') };
}
