/**
 * iPad アプリのネイティブの「予約設定」（予約受付ルール。Web の /app/settings/booking と同じ。2026-10-24）。
 *   読み込み GET  ?part=bookingSettings
 *   保存     POST { type: 'bookingSettingsSave', … }（Web の updateBookingSettings と同じ項目）
 *   写真     POST { type: 'bookingPhotoImport', pageUrl }（食べログ等の URL から店舗写真を取り込む。importStorePhotoFromPage）
 * レジ端末（iPad の「<店舗名>（レジ）」アカウント）は Web と同じく読むだけ＝「管理画面で変更してください」（2026-09-29 Ronnie）。
 */

export interface NativeBookingSettingsInput {
  slotMinutes: number;
  defaultStayMinutes: number;
  bookingCutoffMinutes: number;
  bookingWindowDays: number;
  maxPartySize: number;
  cancelDeadlineHours: number;
  cleaningBufferMinutes: number;
  bookingPhotoUrl: string;
  bookingNotes: string;
  cancellationPolicy: string;
  reminderEnabled: boolean;
  reminderHoursBefore: number;
}

export type NativeBookingAction =
  | ({ type: 'bookingSettingsSave' } & NativeBookingSettingsInput)
  | { type: 'bookingPhotoImport'; pageUrl: string };

export const NATIVE_BOOKING_ACTION_TYPES = ['bookingSettingsSave', 'bookingPhotoImport'] as const;
export function isNativeBookingActionType(v: unknown): v is NativeBookingAction['type'] {
  return typeof v === 'string' && (NATIVE_BOOKING_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeBookingAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

/** 0 以上の整数（上限つき）。細かい範囲の決まり（枠間隔は 15/30/60 など）は Web と同じ Server Action が見る */
const int = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function parseNativeBookingAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  if (b.type === 'bookingPhotoImport') {
    if (typeof b.pageUrl !== 'string' || !b.pageUrl.trim()) return bad('ページの URL を入れてください');
    return { ok: true, action: { type: 'bookingPhotoImport', pageUrl: b.pageUrl.trim().slice(0, 2000) } };
  }
  if (b.type === 'bookingSettingsSave') {
    if (
      !int(b.slotMinutes, 1440) ||
      !int(b.defaultStayMinutes, 1440) ||
      !int(b.bookingCutoffMinutes, 100_000) ||
      !int(b.bookingWindowDays, 3650) ||
      !int(b.maxPartySize, 9999) ||
      !int(b.cancelDeadlineHours, 100_000) ||
      !int(b.cleaningBufferMinutes, 1440) ||
      !int(b.reminderHoursBefore, 100_000)
    ) {
      return bad('数値の指定が正しくありません');
    }
    return {
      ok: true,
      action: {
        type: 'bookingSettingsSave',
        slotMinutes: b.slotMinutes as number,
        defaultStayMinutes: b.defaultStayMinutes as number,
        bookingCutoffMinutes: b.bookingCutoffMinutes as number,
        bookingWindowDays: b.bookingWindowDays as number,
        maxPartySize: b.maxPartySize as number,
        cancelDeadlineHours: b.cancelDeadlineHours as number,
        cleaningBufferMinutes: b.cleaningBufferMinutes as number,
        bookingPhotoUrl: str(b.bookingPhotoUrl, 2000),
        bookingNotes: str(b.bookingNotes, 4000),
        cancellationPolicy: str(b.cancellationPolicy, 4000),
        reminderEnabled: b.reminderEnabled === true,
        reminderHoursBefore: b.reminderHoursBefore as number,
      },
    };
  }
  return bad();
}
