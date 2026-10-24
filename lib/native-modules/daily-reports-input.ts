/**
 * 日報（/app/daily-reports）の iPad ネイティブの入力の確かめ（純粋な関数。テストは tests/native-reports-tasks-manuals.test.ts）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isNativeUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isNativeDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v);

export const DAILY_REPORT_STATUSES = ['draft', 'submitted', 'approved'] as const;
export type DailyReportStatus = (typeof DAILY_REPORT_STATUSES)[number];

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = <T>(error = '内容が正しくありません'): Parsed<T> => ({ ok: false, error });

/** GET part=dailyReports の ?date&from&to&store&status（Web の検索フォームと同じ。正しくない値は無いものとして扱う） */
export function parseDailyReportsQuery(params: URLSearchParams): { date?: string; from?: string; to?: string; store?: string; status?: string } {
  const pick = (k: string, ok: (v: string) => boolean) => {
    const v = params.get(k);
    return v && ok(v) ? v : undefined;
  };
  return {
    date: pick('date', isNativeDate),
    from: pick('from', isNativeDate),
    to: pick('to', isNativeDate),
    store: pick('store', isNativeUuid),
    status: pick('status', (v) => (DAILY_REPORT_STATUSES as readonly string[]).includes(v)),
  };
}

/** POST dailyReportGenerate { storeId, date } */
export function parseDailyReportGenerate(raw: Record<string, unknown>): Parsed<{ storeId: string; date: string }> {
  if (!isNativeUuid(raw.storeId)) return bad('店舗が正しくありません');
  if (!isNativeDate(raw.date)) return bad('日付が正しくありません');
  return { ok: true, value: { storeId: raw.storeId, date: raw.date } };
}

/** POST dailyReportSubmit { id, comment } */
export function parseDailyReportSubmit(raw: Record<string, unknown>): Parsed<{ id: string; comment: string }> {
  if (!isNativeUuid(raw.id)) return bad('日報が正しくありません');
  if (raw.comment != null && typeof raw.comment !== 'string') return bad('コメントが正しくありません');
  return { ok: true, value: { id: raw.id, comment: (raw.comment as string | null | undefined) ?? '' } };
}

/** POST { id }（承認・削除など、id だけの操作） */
export function parseNativeId(raw: Record<string, unknown>, what = '内容'): Parsed<{ id: string }> {
  if (!isNativeUuid(raw.id)) return bad(`${what}が正しくありません`);
  return { ok: true, value: { id: raw.id } };
}

/** 日報の数字（daily_reports.metrics。v0.4.2 より前の日報は grossSales などが無く、sales だけ） */
export interface NativeDailyMetrics {
  /** v0.4.2 より前の日報（値引・返金・純売上は「—」） */
  legacy: boolean;
  grossSales: number | null;
  discounts: number | null;
  refunds: number | null;
  netSales: number | null;
  guests: number | null;
  avgSpend: number | null;
  /** null = 未締め */
  cashDifference: number | null;
  closingExists: boolean;
  reservationsCount: number | null;
  cancelCount: number | null;
  wasteAmount: number | null;
  laborCost: number | null;
}

/** metrics の JSON を iPad に渡す形に（数字でないものは null。Web の詳細ダイアログの出し方と同じ決まり） */
export function normalizeDailyMetrics(m: unknown): NativeDailyMetrics {
  const o = m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const legacy = o.grossSales == null;
  return {
    legacy,
    grossSales: n(o.grossSales) ?? n(o.sales),
    discounts: legacy ? null : n(o.discounts),
    refunds: legacy ? null : n(o.refunds),
    netSales: legacy ? null : n(o.netSales),
    guests: n(o.guests),
    avgSpend: n(o.avgSpend),
    cashDifference: n(o.cashDifference),
    closingExists: o.closingExists === true,
    reservationsCount: n(o.reservationsCount),
    cancelCount: n(o.cancelCount),
    wasteAmount: n(o.wasteAmount),
    laborCost: n(o.laborCost),
  };
}
