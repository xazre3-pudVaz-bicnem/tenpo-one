/**
 * レポート・ダッシュボード共通の期間計算ユーティリティ。
 * 日付は JST 暦日の 'YYYY-MM-DD' 文字列として扱い、UTC基準の純粋な日付演算で解決する
 * （サーバーのタイムゾーン設定に依存しない）。
 */

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDaysStr(fromStr: string, toStr: string): number {
  return Math.round(
    (new Date(`${toStr}T00:00:00Z`).getTime() - new Date(`${fromStr}T00:00:00Z`).getTime()) / 86400000
  );
}

export function dateSequence(fromStr: string, toStr: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${fromStr}T00:00:00Z`);
  const end = new Date(`${toStr}T00:00:00Z`);
  while (cursor <= end && dates.length < 400) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
}

export function monthBounds(offsetMonths: number, todayStr: string): { first: string; last: string } {
  const [y, m] = todayStr.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { first: first.toISOString().slice(0, 10), last: last.toISOString().slice(0, 10) };
}

export function weekBounds(offsetWeeks: number, todayStr: string): { first: string; last: string } {
  const monday = mondayOfStr(addDaysStr(todayStr, offsetWeeks * 7));
  return { first: monday, last: addDaysStr(monday, 6) };
}

export function mondayOfStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // 月曜=0
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** 選択期間と同じ日数の直前期間（前日比/前週比/前月比の自動選択に使う） */
export function previousPeriod(fromStr: string, toStr: string): { from: string; to: string; days: number } {
  const days = diffDaysStr(fromStr, toStr) + 1;
  const to = addDaysStr(fromStr, -1);
  const from = addDaysStr(to, -(days - 1));
  return { from, to, days };
}

/** 期間の長さ（日数）から比較ラベルを自動選択する */
export function comparisonLabel(days: number): string {
  if (days <= 1) return '前日比';
  if (days <= 7) return '前週比';
  if (days <= 31) return '前月比';
  return '前期間比';
}
