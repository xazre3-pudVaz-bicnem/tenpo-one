/**
 * iPhone の店長・オーナーのネイティブ（2026-10-25 Ronnie「Make everything 101% native」）で足した操作の入力の確かめ。
 * DB に触らない（テスト対象）。中身は Web と同じ Server Action が受ける（lib/native-modules/handy-qr.ts・cash-day.ts）。
 *   iPhoneハンディの QR：作る・作り直す・お店のWi-Fiだけ・回線の追加／削除（Web の 設定 › iPhoneハンディ と同じ）
 *   店舗日次締め・売上の内訳（Web の /app/cash/close の下の段と同じ）
 */

export type NativeHandyQrAction =
  | { type: 'handyQrSetup' }
  | { type: 'handyQrRegenerate' }
  | { type: 'handyQrWifiOnly'; wifiOnly: boolean }
  | { type: 'handyQrNetworkAdd'; label: string }
  | { type: 'handyQrNetworkRemove'; key: string };

export const NATIVE_HANDY_QR_TYPES = ['handyQrSetup', 'handyQrRegenerate', 'handyQrWifiOnly', 'handyQrNetworkAdd', 'handyQrNetworkRemove'] as const;

type Parsed<T> = { ok: true; action: T } | { ok: false; error: string };

/** iPhoneハンディの QR の操作（ラベルは 30 文字まで・回線のキーは 64 文字まで） */
export function parseNativeHandyQrAction(raw: Record<string, unknown>): Parsed<NativeHandyQrAction> {
  switch (raw.type) {
    case 'handyQrSetup':
      return { ok: true, action: { type: 'handyQrSetup' } };
    case 'handyQrRegenerate':
      return { ok: true, action: { type: 'handyQrRegenerate' } };
    case 'handyQrWifiOnly':
      if (typeof raw.wifiOnly !== 'boolean') return { ok: false, error: '内容が正しくありません' };
      return { ok: true, action: { type: 'handyQrWifiOnly', wifiOnly: raw.wifiOnly } };
    case 'handyQrNetworkAdd': {
      const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 30) : '';
      return { ok: true, action: { type: 'handyQrNetworkAdd', label } };
    }
    case 'handyQrNetworkRemove': {
      const key = typeof raw.key === 'string' ? raw.key.trim() : '';
      if (!key || key.length > 64) return { ok: false, error: '回線を選んでください' };
      return { ok: true, action: { type: 'handyQrNetworkRemove', key } };
    }
    default:
      return { ok: false, error: '内容が正しくありません' };
  }
}

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
