import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS, onboardingStartStep, onboardingTime, parseNativeOnboardingAction } from '@/lib/native-onboarding';

const STORE = '11111111-2222-3333-4444-555555555555';
const CAT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const week = (patch: Record<string, unknown> = {}) =>
  Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, isClosed: false, openTime: '11:00', closeTime: '22:00', ...patch }));

// 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」→ 初期設定（/app/onboarding）も iPad の中で
describe('iPad ネイティブの初期設定（初期導入ウィザード）', () => {
  it('開くステップは 1〜10 に収める（Web の wizard.tsx と同じ）', () => {
    expect(ONBOARDING_STEPS).toBe(10);
    expect(onboardingStartStep(undefined)).toBe(1);
    expect(onboardingStartStep(0)).toBe(1);
    expect(onboardingStartStep(4)).toBe(4);
    expect(onboardingStartStep(99)).toBe(10);
  });

  it('時刻は HH:mm にそろえる（DB の time は秒つき）', () => {
    expect(onboardingTime('11:00:00')).toBe('11:00');
    expect(onboardingTime('09:30')).toBe('09:30');
    expect(onboardingTime('')).toBeNull();
    expect(onboardingTime('9:30')).toBeNull();
    expect(onboardingTime(null)).toBeNull();
  });

  it('会社情報・店舗情報（店舗名は必須。店舗 ID は UUID だけ）', () => {
    const c = parseNativeOnboardingAction({ action: 'company', company: { name: '株式会社テスト', nameKana: 'テスト', postalCode: '160-0022', address: '新宿', phone: '03' } });
    expect(c).toEqual({ ok: true, value: { action: 'company', input: { name: '株式会社テスト', nameKana: 'テスト', postalCode: '160-0022', address: '新宿', phone: '03' } } });
    expect(parseNativeOnboardingAction({ action: 'company' }).ok).toBe(false);
    expect(parseNativeOnboardingAction({ action: 'store', name: '  ' })).toEqual({ ok: false, error: '店舗名を入力してください' });
    expect(parseNativeOnboardingAction({ action: 'store', storeId: 'x', name: '新宿店' }).ok).toBe(false);
    expect(parseNativeOnboardingAction({ action: 'store', storeId: null, name: '新宿店', address: '', phone: '' })).toEqual({
      ok: true,
      value: { action: 'store', input: { storeId: null, name: '新宿店', address: '', phone: '' } },
    });
  });

  it('営業時間は 7 曜日がちょうど 1 つずつ。時刻は HH:mm（定休日はそのまま渡し、Server Action が時刻を消す）', () => {
    const r = parseNativeOnboardingAction({ action: 'hours', storeId: STORE, hours: week({ openTime: '11:00:00' }) });
    expect(r.ok && r.value.action === 'hours' && r.value.hours[0]).toEqual({ dayOfWeek: 0, isClosed: false, openTime: '11:00', closeTime: '22:00' });
    expect(parseNativeOnboardingAction({ action: 'hours', storeId: STORE, hours: week().slice(0, 6) }).ok).toBe(false);
    const dup = week();
    dup[6] = { ...dup[6], dayOfWeek: 0 };
    expect(parseNativeOnboardingAction({ action: 'hours', storeId: STORE, hours: dup }).ok).toBe(false);
    // 店舗がまだ無いときは前のステップへ（Web と同じ文）
    expect(parseNativeOnboardingAction({ action: 'hours', hours: week() })).toEqual({ ok: false, error: '先に店舗情報を登録してください（前のステップへ戻ってください）' });
  });

  it('テーブル・カテゴリー・商品（席数は 1 以上・価格は 0 以上・カテゴリーは UUID か未分類）', () => {
    const t = parseNativeOnboardingAction({ action: 'tables', storeId: STORE, tables: [{ name: 'T1', capacityMax: 0 }, { name: 'T2', capacityMax: 4.4 }] });
    expect(t.ok && t.value.action === 'tables' && t.value.tables).toEqual([{ name: 'T1', capacityMax: 1 }, { name: 'T2', capacityMax: 4 }]);
    const c = parseNativeOnboardingAction({ action: 'categories', storeId: STORE, categories: [{ name: 'フード' }, { name: 3 }] });
    expect(c.ok && c.value.action === 'categories' && c.value.categories).toEqual([{ name: 'フード' }, { name: '' }]);
    const i = parseNativeOnboardingAction({ action: 'items', storeId: STORE, items: [{ categoryId: CAT, name: '唐揚げ', price: 880 }, { categoryId: null, name: '枝豆', price: -5 }] });
    expect(i.ok && i.value.action === 'items' && i.value.items).toEqual([
      { categoryId: CAT, name: '唐揚げ', price: 880 },
      { categoryId: null, name: '枝豆', price: 0 },
    ]);
    expect(parseNativeOnboardingAction({ action: 'items', storeId: STORE, items: [{ categoryId: 'bad', name: 'x', price: 1 }] }).ok).toBe(false);
    expect(parseNativeOnboardingAction({ action: 'tables', storeId: STORE, tables: 'T1' }).ok).toBe(false);
  });

  it('スタッフ招待・レジ・完了・後で設定する（次は 2〜10）', () => {
    const s = parseNativeOnboardingAction({ action: 'staff', entries: [{ email: 'a@example.com', displayName: '山田', role: 'staff' }] });
    expect(s.ok && s.value.action === 'staff' && s.value.entries).toEqual([{ email: 'a@example.com', displayName: '山田', role: 'staff' }]);
    expect(parseNativeOnboardingAction({ action: 'register', storeId: STORE })).toEqual({ ok: true, value: { action: 'register', storeId: STORE } });
    expect(parseNativeOnboardingAction({ action: 'register' }).ok).toBe(false);
    expect(parseNativeOnboardingAction({ action: 'payments' })).toEqual({ ok: true, value: { action: 'payments' } });
    expect(parseNativeOnboardingAction({ action: 'complete' })).toEqual({ ok: true, value: { action: 'complete' } });
    expect(parseNativeOnboardingAction({ action: 'skip', next: 5 })).toEqual({ ok: true, value: { action: 'skip', next: 5 } });
    expect(parseNativeOnboardingAction({ action: 'skip', next: 1 }).ok).toBe(false);
    expect(parseNativeOnboardingAction({ action: 'skip', next: 11 }).ok).toBe(false);
    expect(parseNativeOnboardingAction({ action: 'nope' }).ok).toBe(false);
    expect(parseNativeOnboardingAction(null).ok).toBe(false);
  });

  it('Web とネイティブは同じ読み込み・同じ Server Action・同じ権限（org.settings）', () => {
    expect(read('app/app/onboarding/page.tsx')).toContain('loadOnboardingInitial(supabase, ctx.organizationId)');
    const mod = read('lib/native-modules/onboarding.ts');
    expect(mod).toContain("can(ctx.role, 'org.settings')");
    expect(mod).toContain('loadOnboardingInitial(');
    for (const fn of ['saveCompanyStep', 'saveStoreStep', 'saveHoursStep', 'saveTablesStep', 'saveCategoriesStep', 'saveMenuItemsStep', 'saveStaffStep', 'saveRegisterStep', 'completeOnboarding', 'skipOnboardingStep']) {
      expect(mod).toContain(`await ${fn}(`);
    }
    const registry = read('lib/native-modules/registry.ts');
    expect(registry).toContain('onboarding: onboardingGet');
    expect(registry).toContain('onboarding: onboardingPost');
    expect(read('ios/Shared/NativeModules.swift')).toContain('("/app/onboarding", "onboarding")');
  });
});

describe('iPad ネイティブの残りの画面（店舗名刺・メニュー集計・テーブルの準備）', () => {
  it('店舗名刺は Web と同じ読み込み（store.settings）。iPad は設定の中の画面として開く', () => {
    expect(read('app/app/settings/store/business-cards/page.tsx')).toContain('loadStoreBusinessCard(await createClient(), target.id)');
    const mod = read('lib/native-modules/business-cards.ts');
    expect(mod).toContain("can(ctx.role, 'store.settings')");
    expect(mod).toContain('loadStoreBusinessCard(');
    expect(read('lib/native-modules/registry.ts')).toContain('businessCards: businessCardsGet');
    const pages = read('ios/Shared/NativeSettingsPages.swift');
    expect(pages).toContain('case businessCards = "businessCards"');
    expect(pages).toContain('case .businessCards: return "/app/settings/store/business-cards"');
  });

  it('メニュー集計（/app/menu/summary）は 設定 › 集計 へ（Web は redirect、iPad はネイティブの集計）', () => {
    expect(read('app/app/menu/summary/page.tsx')).toContain("redirect('/app/settings/summary')");
    expect(read('ios/Shared/NativeSettingsPages.swift')).toContain('"/app/menu/summary": .summary');
  });

  it('テーブルの準備（/app/floor/<卓>/setup）はネイティブのテーブル一覧の来店登録で開く', () => {
    const app = read('ios/Shared/AppState.swift');
    expect(app).toContain('Self.setupTableId(fromPath: url.path)');
    expect(app).toContain('guard parts.count == 4, parts[0] == "app", parts[1] == "floor", parts[3] == "setup"');
    expect(read('ios/Shared/NativeFloorView.swift')).toContain('applySetupRequest()');
    expect(read('ios/Shared/NativePreview.swift')).toContain('setupRequest: state.floorSetupTableId');
  });
});
