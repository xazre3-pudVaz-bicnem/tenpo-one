import { describe, expect, it } from 'vitest';
import { isNativeSettingsPageActionType, parseNativeSettingsPageAction } from '@/lib/native-settings-pages';

const ID = '11111111-1111-4111-8111-111111111111';

describe('native settings pages (設定の中の画面) actions', () => {
  it('knows its own action types only', () => {
    expect(isNativeSettingsPageActionType('soldOutSet')).toBe(true);
    expect(isNativeSettingsPageActionType('clerkAdd')).toBe(true);
    expect(isNativeSettingsPageActionType('settingsPrinterSelect')).toBe(false);
  });

  it('品切れ: item id + boolean', () => {
    expect(parseNativeSettingsPageAction({ type: 'soldOutSet', itemId: ID, soldOut: true })).toEqual({ ok: true, action: { type: 'soldOutSet', itemId: ID, soldOut: true } });
    expect(parseNativeSettingsPageAction({ type: 'soldOutSet', itemId: 'x', soldOut: true }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'soldOutSet', itemId: ID, soldOut: 'yes' }).ok).toBe(false);
  });

  it('POS担当者: add defaults to staff, role must be known', () => {
    expect(parseNativeSettingsPageAction({ type: 'clerkAdd', name: 'Ronnie' })).toEqual({ ok: true, action: { type: 'clerkAdd', name: 'Ronnie', role: 'staff' } });
    expect(parseNativeSettingsPageAction({ type: 'clerkAdd', name: 'Ronnie', role: 'boss' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'clerkAdd', name: '   ' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'clerkStatus', id: ID, status: 'hidden' }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'clerkStatus', id: ID, status: 'gone' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'clerkDelete', id: ID }).ok).toBe(true);
  });

  it('営業時間: 7 days, times HH:MM or null, lunch/float/holidays', () => {
    const day = (d: number) => ({ dayOfWeek: d, isClosed: d === 2, openTime: '11:00', closeTime: '25:00', lastEntryTime: null });
    const r = parseNativeSettingsPageAction({ type: 'hoursSave', hours: [0, 1, 2, 3, 4, 5, 6].map(day) });
    expect(r.ok).toBe(true);
    if (r.ok && r.action.type === 'hoursSave') {
      expect(r.action.hours[2].isClosed).toBe(true);
      expect(r.action.hours[0].closeTime).toBe('25:00');
    }
    expect(parseNativeSettingsPageAction({ type: 'hoursSave', hours: [day(0)] }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'lunchUntilSave', lunchUntil: '15:00' }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'lunchUntilSave', lunchUntil: 'noon' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'nextFloatSave', nextFloat: null }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'nextFloatSave', nextFloat: 30000 }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'nextFloatSave', nextFloat: -1 }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'holidayAdd', date: '2026-12-31', name: '年末', isTemporary: true }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'holidayAdd', date: '12/31' }).ok).toBe(false);
  });

  it('店舗情報: seat count and service charge are checked, the rest is passed as strings', () => {
    const ok = parseNativeSettingsPageAction({
      type: 'storeSave',
      store: { name: 'MEAT CROWN', seatCount: 40, serviceChargeRate: 10, rounding: 'round', bookingEnabled: true, allowNegativeStock: false },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.action.type === 'storeSave') {
      expect(ok.action.store.name).toBe('MEAT CROWN');
      expect(ok.action.store.nameKana).toBe('');
      expect(ok.action.store.rounding).toBe('round');
      expect(ok.action.store.allowNegativeStock).toBe(false);
    }
    expect(parseNativeSettingsPageAction({ type: 'storeSave', store: { name: 'x', seatCount: -1, serviceChargeRate: 0 } }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'storeSave', store: { name: 'x', serviceChargeRate: 101 } }).ok).toBe(false);
  });
});
