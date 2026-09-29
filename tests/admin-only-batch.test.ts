import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { settingsHubs } from '@/lib/settings-hubs';
import { registerSettingSections } from '@/lib/register-settings';
import { isAdminOnlySetting } from '@/lib/admin-only-settings';

/**
 * 2026-09-29〜30 Ronnie「管理画面だけ。レジ（iPad）からは要らない」:
 *   一括編集・予約受付ルール・テーブル・フロア（画面ごと）、レシート・インボイス設定、厨房伝票・来店経路、
 *   オーナーの担当者の削除。
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const hrefs = (isRegisterDevice: boolean) =>
  settingsHubs({ role: 'store_manager', disabledFeatures: new Set(), isRegisterDevice }).flatMap((h) =>
    (h.children ?? []).map((c) => c.href)
  );

const registerLinks = (isRegisterDevice: boolean) =>
  registerSettingSections('store_manager', null, { isRegisterDevice }).flatMap((s) => s.links.map((l) => l.href));

/** 関数の中身（次の export async function まで） */
function fnBody(src: string, fn: string): string {
  const body = src.slice(src.indexOf(`export async function ${fn}(`));
  const next = body.indexOf('export async function', 10);
  return next === -1 ? body : body.slice(0, next);
}

describe('管理画面だけの設定', () => {
  const pages = ['/app/settings/menu-bulk', '/app/settings/booking', '/app/settings/tables'];

  it('設定のタブ：管理画面には出る・レジ（iPad）には出ない', () => {
    for (const p of pages) {
      expect(hrefs(false), p).toContain(p);
      expect(hrefs(true), p).not.toContain(p);
      expect(isAdminOnlySetting(p), p).toBe(true);
    }
    // テーブルQRの印刷・店舗情報・予約台帳設定はレジにも出る
    expect(hrefs(true)).toContain('/app/settings/tables/qr-print');
    expect(hrefs(true)).toContain('/app/settings/store');
    expect(hrefs(true)).toContain('/app/settings/reservation-book');
    expect(isAdminOnlySetting('/app/settings/tables/qr-print')).toBe(false);
  });

  it('レジの設定の一覧にも出さない', () => {
    expect(registerLinks(false)).toContain('/app/settings/tables');
    expect(registerLinks(true)).not.toContain('/app/settings/tables');
    expect(registerLinks(true)).not.toContain('/app/settings/booking');
  });

  it('画面を直接開いても断る', () => {
    for (const p of ['app/app/settings/menu-bulk/page.tsx', 'app/app/settings/booking/page.tsx', 'app/app/settings/tables/page.tsx']) {
      expect(read(p), p).toContain('if (ctx.isRegisterDevice) {');
    }
  });

  it('保存もレジ端末なら断る', () => {
    const guard = 'if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_SETTINGS_NOTE };';
    const cases: [string, string[]][] = [
      ['app/app/settings/menu-bulk/actions.ts', ['saveMenuBulk']],
      ['app/app/settings/booking/actions.ts', ['updateBookingSettings', 'importStorePhotoFromPage']],
      ['app/app/settings/printers/actions.ts', ['saveKitchenTicketSettings', 'saveVisitSources']],
      [
        'app/app/settings/tables/actions.ts',
        [
          'saveDefaultFloor',
          'addFloor',
          'renameFloor',
          'deleteFloor',
          'saveTable',
          'toggleTableAvailability',
          'deleteTable',
          'saveTablePlacement',
          'saveTableShape',
          'invalidateTableQrToken',
          'regenerateTableQrToken',
        ],
      ],
    ];
    for (const [file, fns] of cases) {
      const src = read(file);
      for (const fn of fns) expect(fnBody(src, fn), `${file} ${fn}`).toContain(guard);
    }
    // QR を見るだけ（getTableQr）は止めない
    expect(fnBody(read('app/app/settings/tables/actions.ts'), 'getTableQr')).not.toContain(guard);
  });

  it('レシート・インボイス設定：レジ端末からの保存では今の値を変えない', () => {
    const src = fnBody(read('app/app/settings/store/actions.ts'), 'updateStoreInfo');
    expect(src).toContain('const receiptLocked = ctx.isRegisterDevice === true;');
    expect(src).toContain('...receiptFields,');
    expect(read('app/app/settings/store/page.tsx')).toContain('receiptLocked={ctx.isRegisterDevice === true}');
  });

  it('厨房伝票・来店経路：レジの設定（iPad）には出さない', () => {
    const src = read('app/app/pos/settings/page.tsx');
    expect(src).toContain("const canKitchen = can(ctx.role, 'store.settings') && !adminOnly;");
  });

  it('オーナーの担当者はレジから削除・役職の変更ができない', () => {
    const src = read('app/app/settings/clerks/actions.ts');
    expect(fnBody(src, 'deletePosClerk')).toContain("if (ctx.isRegisterDevice && (await currentClerkRole(supabase, id, storeId)) === 'owner')");
    expect(fnBody(src, 'setPosClerkRole')).toContain("(await currentClerkRole(supabase, id, storeId)) === 'owner'");
    expect(read('app/app/settings/clerks/page.tsx')).toContain('lockOwner={ctx.isRegisterDevice === true}');
  });

  it('予約QR：店舗情報に置き、予約受付ルールからは外した', () => {
    expect(read('app/app/settings/store/page.tsx')).toContain('<BookingUrlPanel');
    expect(read('app/app/settings/booking/page.tsx')).not.toContain('<BookingUrlPanel');
    const card = read('components/settings/booking-qr-card.tsx');
    expect(card).toContain('data-qr-card');
    expect(card).toContain('h-[148mm] w-[105mm]');
  });
});
