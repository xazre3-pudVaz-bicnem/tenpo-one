/**
 * 期間の決算レポート（伝票明細の 昨日・一昨日・今週・今月・日付）を出すときの期間の決まり（純粋・テスト対象）。
 * 2026-10-26 Ronnie「Yo thau bata native ra web bata 決算レポート nikalna milne banau … 昨日 一昨日 選んだ日 今週 今月 …
 * Ko sabai ko report rezi printer bata print garna milne banau」
 */

/** 1 枚に入れる最大の日数（今月＋前の月の残りくらい。紙が長くなりすぎないように） */
export const PERIOD_REPORT_MAX_DAYS = 62;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(date: string): number | null {
  if (!DATE.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // 2026-02-31 のような日付は使えない
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

export type PeriodRange = { ok: true; from: string; to: string; days: number } | { ok: false; error: string };

/** 開始日・終了日（YYYY-MM-DD）を確かめる。逆なら入れ替える */
export function parsePeriodReportRange(fromRaw: unknown, toRaw: unknown): PeriodRange {
  const from = typeof fromRaw === 'string' ? fromRaw.trim() : '';
  const to = typeof toRaw === 'string' && toRaw.trim() ? toRaw.trim() : from;
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null) return { ok: false, error: '期間（開始日・終了日）を正しく選んでください' };
  const [lo, hi, f, t] = a <= b ? [a, b, from, to] : [b, a, to, from];
  const days = hi - lo + 1;
  if (days > PERIOD_REPORT_MAX_DAYS) return { ok: false, error: `決算レポートは ${PERIOD_REPORT_MAX_DAYS} 日までです。期間を短くしてください` };
  return { ok: true, from: f, to: t, days };
}
