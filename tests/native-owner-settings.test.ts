import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCashDayQuery, parseStoreDayClose } from '@/lib/native-owner-settings';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// 2026-10-25 Ronnie「Make everything 101% native」→ iPhone の店長・オーナーの設定・スタッフ管理・キッチン・残りの ?web=1 もネイティブに
describe('店舗日次締め・売上の内訳（lib/native-owner-settings.ts）', () => {
  it('期間：日次は YYYY-MM-DD（無い・壊れていれば今日の営業日）、月次は YYYY-MM。未来は今日にそろえる', () => {
    const today = '2026-10-25';
    expect(parseCashDayQuery(null, null, today)).toEqual({ period: 'day', date: today });
    expect(parseCashDayQuery('day', '2026-10-20', today)).toEqual({ period: 'day', date: '2026-10-20' });
    expect(parseCashDayQuery('day', '2026-11-01', today)).toEqual({ period: 'day', date: today });
    expect(parseCashDayQuery('day', '10/20', today)).toEqual({ period: 'day', date: today });
    expect(parseCashDayQuery('month', null, today)).toEqual({ period: 'month', date: '2026-10' });
    expect(parseCashDayQuery('month', '2026-09', today)).toEqual({ period: 'month', date: '2026-09' });
    expect(parseCashDayQuery('month', '2027-01', today)).toEqual({ period: 'month', date: '2026-10' });
    expect(parseCashDayQuery('week', '2026-10-20', today)).toEqual({ period: 'day', date: '2026-10-20' });
  });

  it('店舗日次締めは営業日（YYYY-MM-DD）だけ受ける', () => {
    expect(parseStoreDayClose({ businessDate: '2026-10-25' })).toEqual({ ok: true, businessDate: '2026-10-25' });
    expect(parseStoreDayClose({ businessDate: '2026/10/25' })).toEqual({ ok: false, error: '営業日が正しくありません' });
    expect(parseStoreDayClose({}).ok).toBe(false);
  });
});

describe('サーバーのつなぎ（GET part・POST type は Web と同じ Server Action）', () => {
  it('registry に 1 行ずつ足してある', () => {
    const registry = read('lib/native-modules/registry.ts');
    expect(registry).toContain('cashDay: cashDayGet');
    expect(registry).toContain('storeDayClose: storeDayClosePost');
  });

  it('iPhoneハンディの QR は iPad と同じ GET part=handyQrAdmin ／ POST handyQr…（lib/native-modules/handy-qr.ts）', () => {
    const swift = read('ios/Shared/NativePhoneOwnerSettingsBooking.swift');
    expect(swift).toContain('part: "handyQrAdmin"');
    for (const t of ['handyQrSetup', 'handyQrRegenerate', 'handyQrWifiOnly', 'handyQrNetworkAdd', 'handyQrNetworkRemove']) expect(swift).toContain(`"type": "${t}"`);
  });

  it('店舗日次締め・チェックリスト・売上の内訳は Web の /app/cash・/app/cash/close と同じ読み込み・同じ実行', () => {
    const mod = read('lib/native-modules/cash-day.ts');
    expect(mod).toContain('loadRegisterBoard(store.id, today)');
    expect(mod).toContain('loadCloseBreakdown(store.id, q.period, q.date)');
    expect(mod).toContain('closeStoreDay(store.id, parsed.businessDate)');
    expect(mod).toContain('STORE_DAY_CLOSE_ROLES.includes');
    expect(read('app/app/cash/close/page.tsx')).toContain('loadRegisterBoard(store.id, today)');
    expect(read('components/cash/store-day-close-panel.tsx')).toContain('closeStoreDay(storeId, businessDate)');
  });

  it('CSV は Web の CSV ボタンと同じ道（/app/<画面>/export）', () => {
    for (const p of ['app/app/cash/export/route.ts', 'app/app/expenses/export/route.ts', 'app/app/costing/export/route.ts', 'app/app/purchases/export/route.ts']) {
      expect(read(p)).toContain("requirePermission('csv.export')");
    }
  });
});

describe('iPhone の店長・オーナーのネイティブ（Swift）', () => {
  it('設定・スタッフ管理・キッチンを iPhone の道から開く', () => {
    const owner = read('ios/Shared/NativePhoneOwner.swift');
    expect(owner).toContain('("/app/settings", "settings")');
    expect(owner).toContain('("/app/pos/sold-out", "settings")');
    expect(owner).toContain('("/app/staff", "staff")');
    expect(owner).toContain('("/app/kitchen", "kitchen")');
    expect(owner).toContain('case "settings": NativePhoneOwnerSettingsScreen(route: route)');
    expect(owner).toContain('case "staff": NativePhoneOwnerStaffScreen(route: route)');
    expect(owner).toContain('case "kitchen": NativePhoneOwnerKitchenScreen(route: route)');
  });

  it('iPhone の画面から ?web=1 で Web の画面へ行かない（返金・取消・入出金・締め・原価・移動・発注・経費）', () => {
    for (const f of [
      'NativePhoneOwnerOrders',
      'NativePhoneOwnerCash',
      'NativePhoneOwnerRegister',
      'NativePhoneOwnerCosting',
      'NativePhoneOwnerInventoryMore',
      'NativePhoneOwnerPurchases',
      'NativePhoneOwnerExpenses',
    ]) {
      const swift = read(`ios/Shared/${f}.swift`);
      expect(swift, f).not.toMatch(/onOpen\("[^"]*web=1/);
      expect(swift, f).not.toMatch(/leaveNativePhone\(to: "[^"]*web=1/);
    }
  });

  it('設定の中の画面は iPad と同じ part を読む（返事の形は変えない）', () => {
    const swift = ['Settings', 'SettingsStore', 'SettingsMenu', 'SettingsPeople', 'SettingsBooking', 'SettingsPayments']
      .map((f) => read(`ios/Shared/NativePhoneOwner${f}.swift`))
      .join('\n');
    for (const model of ['NativeStoreModel', 'NativeHoursModel', 'NativeSoldOutModel', 'NativeMenuItemsModel', 'NativeOptionsModel', 'NativeCategoriesModel', 'NativeClerksModel', 'NativeStaffModel', 'NativeBookingSettingsModel', 'NativeReservationBookModel', 'NativePaymentsModel', 'NativeTaxModel', 'NativeAlertsModel', 'NativeHandyDevicesModel', 'NativeIntegrationsModel']) {
      expect(swift, model).toContain(model);
    }
    expect(swift).toContain('part: "handyQrAdmin"');
    expect(swift).toContain('iPad・PC で設定してください');
  });

  it('見本（-tenpoNativePreview）がある', () => {
    const preview = read('ios/Shared/NativePreview.swift');
    for (const k of ['phoneOwnerSettings', 'phoneOwnerStaff', 'phoneOwnerKitchen', 'phoneOwnerStoreDay', 'phoneOwnerRefund']) expect(preview).toContain(k);
  });
});
