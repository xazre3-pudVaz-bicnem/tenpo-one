import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { settingsHubs } from '@/lib/settings-hubs';
import { registerSettingSections } from '@/lib/register-settings';
import { isAdminOnlySetting } from '@/lib/admin-only-settings';

/**
 * ハードウェア（レジ端末・プリンター・キャッシュドロア）は管理画面だけ（2026-09-29 Ronnie「iPad に置くとスタッフが触って壊す」）。
 * レジ端末（<店舗名>（レジ）アカウント）では 設定に出さない・開けない・変えられない。
 */

const hrefs = (isRegisterDevice: boolean) =>
  settingsHubs({ role: 'store_manager', disabledFeatures: new Set(), isRegisterDevice }).flatMap((h) =>
    (h.children ?? []).map((c) => c.href)
  );

const registerLinks = (isRegisterDevice: boolean) =>
  registerSettingSections('store_manager', null, { isRegisterDevice }).flatMap((s) => s.links.map((l) => l.href));

describe('ハードウェアは管理画面だけ', () => {
  it('設定のタブ：管理画面には出る・レジ（iPad）には出ない', () => {
    expect(hrefs(false)).toContain('/app/settings/printers');
    expect(hrefs(true)).not.toContain('/app/settings/printers');
    // ほかの設定はそのまま
    expect(hrefs(true)).toContain('/app/pos/settings');
    expect(hrefs(true)).toContain('/app/settings/clerks');
  });

  it('レジの設定の一覧：レジ（iPad）には「プリンターのテスト印刷・接続」を出さない', () => {
    expect(registerLinks(false)).toContain('/app/settings/printers');
    expect(registerLinks(true)).not.toContain('/app/settings/printers');
    expect(registerLinks(true)).toContain('/app/settings/categories');
  });

  it('isAdminOnlySetting', () => {
    expect(isAdminOnlySetting('/app/settings/printers')).toBe(true);
    expect(isAdminOnlySetting('/app/settings/printers?from=register')).toBe(true);
    expect(isAdminOnlySetting('/app/pos/settings')).toBe(false);
  });

  it('画面を直接開いても・変えようとしても、レジ端末なら断る', () => {
    const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
    expect(read('app/app/settings/printers/page.tsx')).toContain('if (ctx.isRegisterDevice) {');
    const actions = read('app/app/settings/printers/actions.ts');
    for (const fn of [
      'addRegister',
      'renameRegister',
      'toggleRegisterActive',
      'savePrinterConfig',
      'deletePrinterConfig',
      'saveDrawerSettings',
      'setCloudPrntConfig',
      'regenerateCloudPrntToken',
    ]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
      const next = body.indexOf('export async function', 10);
      expect(body.slice(0, next), fn).toContain('if (ctx.isRegisterDevice) return { error: ADMIN_ONLY_MESSAGE };');
    }
    // 印刷そのもの（レシート・テスト印刷の完了）は止めない
    const mark = actions.slice(actions.indexOf('export async function markPrintJobPrinted('));
    expect(mark.slice(0, mark.indexOf('export async function', 10))).not.toContain('ADMIN_ONLY_MESSAGE');
  });
});
