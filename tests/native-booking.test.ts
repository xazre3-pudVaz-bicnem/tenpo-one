import { describe, expect, it } from 'vitest';
import { isNativeBookingActionType, parseNativeBookingAction } from '@/lib/native-booking';

describe('native booking settings (予約設定)', () => {
  it('accepts the same fields as the web form and trims text', () => {
    expect(isNativeBookingActionType('bookingSettingsSave')).toBe(true);
    expect(isNativeBookingActionType('bookingPhotoImport')).toBe(true);
    expect(isNativeBookingActionType('budgetDailySave')).toBe(false);
    const r = parseNativeBookingAction({
      type: 'bookingSettingsSave',
      slotMinutes: 30,
      defaultStayMinutes: 120,
      bookingCutoffMinutes: 120,
      bookingWindowDays: 90,
      maxPartySize: 12,
      cancelDeadlineHours: 24,
      cleaningBufferMinutes: 15,
      bookingPhotoUrl: 'https://example.com/a.jpg',
      bookingNotes: 'コースは3日前まで',
      cancellationPolicy: '',
      reminderEnabled: 'yes',
      reminderHoursBefore: 24,
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.action.type === 'bookingSettingsSave') {
      expect(r.action.slotMinutes).toBe(30);
      expect(r.action.cleaningBufferMinutes).toBe(15);
      expect(r.action.reminderEnabled).toBe(false); // 真偽は true だけ
      expect(r.action.bookingNotes).toBe('コースは3日前まで');
    }
  });

  it('rejects non-integer or negative numbers', () => {
    const base = {
      type: 'bookingSettingsSave',
      slotMinutes: 30,
      defaultStayMinutes: 120,
      bookingCutoffMinutes: 120,
      bookingWindowDays: 90,
      maxPartySize: 12,
      cancelDeadlineHours: 24,
      cleaningBufferMinutes: 0,
      bookingPhotoUrl: '',
      bookingNotes: '',
      cancellationPolicy: '',
      reminderEnabled: true,
      reminderHoursBefore: 24,
    };
    expect(parseNativeBookingAction({ ...base, defaultStayMinutes: 1.5 }).ok).toBe(false);
    expect(parseNativeBookingAction({ ...base, maxPartySize: -1 }).ok).toBe(false);
    expect(parseNativeBookingAction({ ...base, slotMinutes: '30' }).ok).toBe(false);
    expect(parseNativeBookingAction({ type: 'bookingPhotoImport', pageUrl: '   ' }).ok).toBe(false);
    expect(parseNativeBookingAction({ type: 'bookingPhotoImport', pageUrl: ' https://tabelog.com/tokyo/x ' })).toEqual({
      ok: true,
      action: { type: 'bookingPhotoImport', pageUrl: 'https://tabelog.com/tokyo/x' },
    });
  });
});
