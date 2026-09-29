import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { settingsHubOf, settingsHubs } from '@/lib/settings-hubs';

/** 設定の中は全部 上のタブ（2026-09-29 Ronnie「設定の中は全部このタブを付けて」） */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('設定の上のタブ', () => {
  const hubs = settingsHubs({ role: 'org_owner', disabledFeatures: new Set(), isRegisterDevice: true });

  it('レジの設定は デバイス管理 のタブ（レジの設定／ハードウェア／iPhoneハンディ／ハンディ端末／テーブルQRコード）', () => {
    const hub = settingsHubOf(hubs, '/app/pos/settings');
    expect(hub?.label).toBe('デバイス管理');
    expect(hub?.children?.map((c) => c.label)).toEqual(['レジの設定', 'ハードウェア', 'iPhoneハンディ', 'ハンディ端末', 'テーブルQRコード']);
  });

  it('スタッフは 予約・顧客 のタブ', () => {
    expect(settingsHubOf(hubs, '/app/staff')?.label).toBe('予約・顧客');
  });

  it('設定の外にある画面（レジの設定・スタッフ）にも同じタブを出し、その画面を選択中にする', () => {
    const pos = read('app/app/pos/settings/page.tsx');
    expect(pos).toContain('<SettingsSubTabs item={hub} pathname={SELF_HREF} activeHref={SELF_HREF} />');
    const staff = read('app/app/staff/page.tsx');
    expect(staff).toContain('<SettingsSubTabs item={hub} pathname="/app/staff" activeHref="/app/staff" />');
    const nav = read('components/settings/settings-nav.tsx');
    expect(nav).toContain('activeHref ? c.href === activeHref : isActive(pathname, c)');
  });

  it('設定の枠も同じ定義（lib/settings-hubs.ts）を使う', () => {
    expect(read('app/app/settings/layout.tsx')).toContain('const hubs = settingsHubs(ctx);');
  });
});
