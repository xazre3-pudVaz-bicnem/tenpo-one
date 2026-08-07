/**
 * 需要・売上の簡易予測（純関数・テスト対象）。
 * 高度なAIではなく「曜日別平均」の統計的予測。データ不足時は低信頼を明示する。
 */

export interface DailyQty {
  date: string; // 'YYYY-MM-DD'
  quantity: number;
}

export interface ForecastResult {
  tomorrow: number;
  thisWeekRemaining: number;
  nextWeek: number;
  /** 参照した週数が2未満なら低信頼 */
  lowConfidence: boolean;
  weekdayAverages: number[]; // index 0=日
}

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00+09:00`).getDay();
}

/**
 * 過去実績（日別数量）から曜日別平均を取り、明日 / 今週残り / 来週の見込みを返す。
 * @param history 過去の日別販売/使用量（歯抜けは0扱いにしない=ある日だけ平均）
 * @param today   'YYYY-MM-DD'（JST）
 */
export function forecastUsage(history: DailyQty[], today: string): ForecastResult {
  const byWeekday: number[][] = Array.from({ length: 7 }, () => []);
  for (const h of history) {
    byWeekday[weekdayOf(h.date)].push(h.quantity);
  }
  const weekdayAverages = byWeekday.map((arr) =>
    arr.length === 0 ? 0 : Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
  );
  const minSamples = Math.min(...byWeekday.map((a) => a.length));
  const lowConfidence = history.length < 14 || minSamples < 2;

  const todayDow = weekdayOf(today);
  const tomorrow = weekdayAverages[(todayDow + 1) % 7];

  // 今週残り = 明日〜今週日曜（週は月曜開始とみなす: 日曜=週末）
  let thisWeekRemaining = 0;
  for (let d = 1; ; d++) {
    const dow = (todayDow + d) % 7;
    thisWeekRemaining += weekdayAverages[dow];
    if (dow === 0) break; // 日曜で締め
    if (d > 7) break;
  }
  const nextWeek = Math.round(weekdayAverages.reduce((a, b) => a + b, 0) * 10) / 10;

  return {
    tomorrow,
    thisWeekRemaining: Math.round(thisWeekRemaining * 10) / 10,
    nextWeek,
    lowConfidence,
    weekdayAverages,
  };
}

/** 予算に対する簡易線形着地予測: 実績/経過日 × 月日数 */
export function linearLandingForecast(
  actualToDate: number,
  elapsedDays: number,
  daysInMonth: number
): number | null {
  if (elapsedDays <= 0) return null;
  return Math.round((actualToDate / elapsedDays) * daysInMonth);
}
