/**
 * 伝票明細の期間ボタン（2026-09-29 Ronnie「昨日・一昨日・今週・今月も見られるように、日付でも選べるように」）。
 * today は 'YYYY-MM-DD'（日本時間）。今週は月曜はじまり。
 */
export interface PeriodPreset {
  label: string;
  from: string;
  to: string;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** その週の月曜日 */
export function weekStart(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=日
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

export function orderPeriodPresets(today: string): PeriodPreset[] {
  return [
    { label: '今日', from: today, to: today },
    { label: '昨日', from: addDays(today, -1), to: addDays(today, -1) },
    { label: '一昨日', from: addDays(today, -2), to: addDays(today, -2) },
    { label: '今週', from: weekStart(today), to: today },
    { label: '今月', from: `${today.slice(0, 7)}-01`, to: today },
    { label: '過去7日', from: addDays(today, -6), to: today },
    { label: '過去30日', from: addDays(today, -29), to: today },
  ];
}
