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

  it('決済・端末: 会計の選択肢・予約決済・stera', () => {
    const ok = parseNativeSettingsPageAction({
      type: 'checkoutPresetsSave',
      discounts: [{ key: 'kanji-free', name: '幹事様無料', kind: 'manual', value: 0 }, { key: 'disc1', name: '10%', kind: 'percent', value: 10.7 }],
      pointBrands: [{ key: 'hotpepper', name: 'ホットペッパー' }],
      methodBrands: { credit: [{ key: 'visa', name: 'VISA' }] },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.action.type === 'checkoutPresetsSave') {
      expect(ok.action.discounts[1].value).toBe(10);
      expect(ok.action.methodBrands.credit[0].name).toBe('VISA');
    }
    expect(parseNativeSettingsPageAction({ type: 'checkoutPresetsSave', discounts: [{ key: 'Bad Key', name: 'x', kind: 'manual', value: 0 }], pointBrands: [], methodBrands: {} }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'checkoutPresetsSave', discounts: [{ key: 'a', name: 'x', kind: 'free', value: 0 }], pointBrands: [], methodBrands: {} }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'bookingPaymentSave', mode: 'deposit', depositAmount: 1000 }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'bookingPaymentSave', mode: 'later', depositAmount: 0 }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'bookingPaymentSave', mode: 'deposit', depositAmount: 10.5 }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'steraAdd', name: ' レジ横 ', terminalNo: '' })).toEqual({ ok: true, action: { type: 'steraAdd', name: 'レジ横', terminalNo: '' } });
    expect(parseNativeSettingsPageAction({ type: 'steraAdd', name: '   ' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'steraUpdate', id: ID, active: false })).toEqual({ ok: true, action: { type: 'steraUpdate', id: ID, active: false } });
    expect(parseNativeSettingsPageAction({ type: 'steraUpdate', id: ID, active: 'no' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'steraRegen', id: ID }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'readerDelete', id: 'x' }).ok).toBe(false);
  });

  it('スタッフ管理: 招待・ロール・PIN・状態', () => {
    const inv = parseNativeSettingsPageAction({ type: 'staffInvite', email: ' A@Example.com ', displayName: ' 山田 ', role: 'staff', storeIds: [ID] });
    expect(inv.ok).toBe(true);
    if (inv.ok && inv.action.type === 'staffInvite') {
      expect(inv.action.email).toBe('A@Example.com');
      expect(inv.action.displayNameKana).toBe('');
    }
    expect(parseNativeSettingsPageAction({ type: 'staffInvite', email: '', displayName: 'x', role: 'staff', storeIds: [] }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'staffInvite', email: 'a@b.c', displayName: 'x', role: 'staff', storeIds: ['nope'] }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'staffRole', membershipId: ID, profileId: ID, role: 'store_manager', storeIds: [ID] }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'staffRole', membershipId: 'x', profileId: ID, role: 'staff', storeIds: [] }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'staffPin', membershipId: ID, profileId: ID, pin: '1234' }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'staffPin', membershipId: ID, profileId: ID, pin: '12' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'staffPin', membershipId: ID, profileId: ID, pin: 'abcd' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'staffStatus', membershipId: ID, profileId: ID, status: 'suspended' }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'staffStatus', membershipId: ID, profileId: ID, status: 'invited' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'staffPasswordReset', membershipId: ID, profileId: ID })).toEqual({ ok: true, action: { type: 'staffPasswordReset', membershipId: ID, profileId: ID } });
  });

  it('予約台帳設定: グルメ連携・SNS・Google', () => {
    expect(parseNativeSettingsPageAction({ type: 'gourmetMailEnabled', enabled: true }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'gourmetMailEnabled', enabled: 'on' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'gourmetSiteRegistered', site: 'tabelog', registered: true }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'gourmetSiteRegistered', site: 'Tabe log', registered: true }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'gourmetImportResolve', importId: ID }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'gourmetImportResolve', importId: '1' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'snsLinksSave', instagram: ' https://www.instagram.com/x ', line: '' })).toEqual({
      ok: true,
      action: { type: 'snsLinksSave', instagram: 'https://www.instagram.com/x', line: '', facebook: '', x: '' },
    });
    expect(parseNativeSettingsPageAction({ type: 'icalRegenerate' })).toEqual({ ok: true, action: { type: 'icalRegenerate' } });
    expect(parseNativeSettingsPageAction({ type: 'remindersPrepare' }).ok).toBe(true);
  });

  it('企業情報: 会社名は必須、KPI は boolean', () => {
    const ok = parseNativeSettingsPageAction({ type: 'companySave', company: { name: 'D&DREAM', billingEmail: 'a@b.co' } });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.action.type === 'companySave') {
      expect(ok.action.company.nameKana).toBe('');
      expect(ok.action.company.billingEmail).toBe('a@b.co');
    }
    expect(parseNativeSettingsPageAction({ type: 'companySave', company: { name: '  ' } }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'kpiSave', includeTakeoutGuests: false }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'kpiSave', includeTakeoutGuests: 'no' }).ok).toBe(false);
  });

  it('テーブル・フロア: 席数の範囲、フロア null、名前必須', () => {
    const ok = parseNativeSettingsPageAction({ type: 'tableSave', table: { name: ' A1 ', capacityMin: 2, capacityMax: 4.9, floorId: null, isCounter: true } });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.action.type === 'tableSave') {
      expect(ok.action.table.name).toBe('A1');
      expect(ok.action.table.capacityMax).toBe(4);
      expect(ok.action.table.id).toBeNull();
      expect(ok.action.table.isPrivateRoom).toBe(false);
    }
    expect(parseNativeSettingsPageAction({ type: 'tableSave', table: { name: 'A1', capacityMin: 4, capacityMax: 2 } }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'tableSave', table: { name: '', capacityMin: 1, capacityMax: 2 } }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'floorDefault', id: null })).toEqual({ ok: true, action: { type: 'floorDefault', id: null } });
    expect(parseNativeSettingsPageAction({ type: 'floorDefault', id: ID }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'floorAdd', name: '  ' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'floorRename', id: ID, name: '2F' }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'tableAvailable', id: ID, available: false }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'tablesReorderByName' }).ok).toBe(true);
  });

  it('ダイナミックプライシング: 配列をそのまま渡す（中身は saveDynamicPricing が確認）', () => {
    expect(parseNativeSettingsPageAction({ type: 'dynamicPricingSave', rules: [] }).ok).toBe(true);
    expect(parseNativeSettingsPageAction({ type: 'dynamicPricingSave', rules: 'x' }).ok).toBe(false);
    expect(parseNativeSettingsPageAction({ type: 'dynamicPricingSave', rules: new Array(51).fill({}) }).ok).toBe(false);
  });
});
