import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 注文画面（/app/pos）を速く（2026-10-21 Ronnie「Airレジ・USEN より遅い」）。
 * 読み込みを順番に待たず、まとめて並列に取る。
 */
describe('注文画面の読み込みは並列', () => {
  const page = readFileSync(new URL('../app/app/pos/page.tsx', import.meta.url), 'utf8');
  it('伝票の本体のあとの待ち（await）は 1 回だけ（メニュー・明細・設定・担当者・選択肢・売切・端末・空き卓を全部まとめて）', () => {
    const after = page.slice(page.indexOf("const { data: order, error: orderError } = orderRes!;"));
    const awaits = after.match(/\bawait\b/g) ?? [];
    expect(awaits.length).toBe(1);
    expect(after).toContain('loadMenuBook(supabase, store.id),');
    expect(after).toContain('loadMenuStock(supabase, store.id),');
    expect(after).toContain("supabase.from('pos_clerks')");
    expect(after).toContain("canCheckout ? getPaymentAvailability()");
  });
  it('契約のアクセス制限と伝票の読み込みも同時に', () => {
    expect(page).toContain('const [accessBlock, orderRes] = await Promise.all([');
  });
  it('店舗設定は1回だけ読む（会計の選択肢・ドロア・テイクアウトで使い回す）', () => {
    expect((page.match(/from\('store_settings'\)/g) ?? []).length).toBe(1);
  });
});

describe('テーブル一覧（オーダー・会計のホーム）の読み込みも並列', () => {
  // データの組み立ては lib/floor-view-server.ts（Web と iPad ネイティブのフロアで共通。2026-10-24）
  const page = readFileSync(new URL('../app/app/floor/page.tsx', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../lib/floor-view-server.ts', import.meta.url), 'utf8');
  it('卓・伝票・予約・担当者・呼び出し・コース・契約の制限を 1 回の Promise.all で', () => {
    // 契約の制限とデータの組み立てを同時に
    expect(page).toContain('const [accessBlock, view] = await Promise.all([');
    expect(page).toContain('storeAccessBlock(store, { countDevice: false }),');
    expect(page).toContain('loadFloorView(ctx, supabase, store),');
    expect(view).toContain('reservationClerkOptions(supabase, [store.id]),');
    expect(view).toContain("from('service_calls')");
    const after = view.slice(view.indexOf('const today = todayJst();'));
    // 残る await は 2 回だけ：1回目（全部まとめて）と、1回目の結果が要る 2回目（伝票の品・予約のキーワード）
    expect((after.match(/\bawait\b/g) ?? []).length).toBe(2);
    expect(after).toContain('const [{ data: itemRows }, panelTags] = await Promise.all([');
  });
});
