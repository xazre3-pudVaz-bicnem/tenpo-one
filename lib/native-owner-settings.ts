/**
 * iPhone の店長・オーナーのネイティブ（2026-10-25 Ronnie「Make everything 101% native」）で足した操作の入力の確かめ。
 * DB に触らない（テスト対象）。中身は Web と同じ Server Action が受ける（lib/native-modules/cash-day.ts）。
 *   店舗日次締め・売上の内訳（Web の /app/cash/close の下の段と同じ）
 */

export type CashDayPeriod = 'day' | 'month';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/**
 * 売上の内訳の期間（Web の /app/cash/close の ?period=&date= と同じ決まり）。
 * 日次は YYYY-MM-DD（無ければ今日の営業日）、月次は YYYY-MM（無ければ今日の営業日の月）。未来は今日にそろえる
 */
export function parseCashDayQuery(period: string | null, date: string | null, today: string): { period: CashDayPeriod; date: string } {
  if (period === 'month') {
    const ym = date && MONTH.test(date) ? date : today.slice(0, 7);
    return { period: 'month', date: ym > today.slice(0, 7) ? today.slice(0, 7) : ym };
  }
  const d = date && DAY.test(date) ? date : today;
  return { period: 'day', date: d > today ? today : d };
}

/** 店舗日次締め：営業日（YYYY-MM-DD）だけ受ける */
export function parseStoreDayClose(raw: Record<string, unknown>): { ok: true; businessDate: string } | { ok: false; error: string } {
  const d = typeof raw.businessDate === 'string' ? raw.businessDate : '';
  if (!DAY.test(d)) return { ok: false, error: '営業日が正しくありません' };
  return { ok: true, businessDate: d };
}
