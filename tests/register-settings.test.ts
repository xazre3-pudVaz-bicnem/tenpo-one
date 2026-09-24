import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FROM_REGISTER,
  REGISTER_SETTINGS_PATH,
  REGISTER_SETTING_SECTIONS,
  permissionHint,
  registerBackUrl,
  registerOrderId,
  registerSettingSections,
  registerSettingsUrl,
  withFromRegister,
} from '@/lib/register-settings';
import { MENU_BOOK_TABS, isMenuBookTab } from '@/lib/menu-book';
import { screenTitleFor, visibleNavGroups } from '@/lib/nav';

const ROOT = join(__dirname, '..');
const ORDER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const allLinks = REGISTER_SETTING_SECTIONS.flatMap((s) => s.links);

/** /app/settings/menu?tab=x → app/app/settings/menu/page.tsx */
function pageFileFor(href: string): string {
  const path = href.split('?')[0];
  return join(ROOT, 'app', path.replace(/^\//, ''), 'page.tsx');
}

describe('レジの設定の一覧（2026-09-21 店舗要望「レジから今までのことを変えられるように」）', () => {
  it('今日追加した設定が全部入っている', () => {
    const ids = allLinks.map((l) => l.id);
    for (const id of ['sold-out', 'menu-items', 'item-order', 'category-order', 'pages', 'plans', 'lunch', 'options', 'stations', 'printers', 'qr-print', 'tables', 'handy', 'clerks', 'booking', 'hours']) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ボタンの開く先の画面が実在する', () => {
    for (const link of allLinks) {
      expect(existsSync(pageFileFor(link.href)), link.href).toBe(true);
    }
    expect(existsSync(pageFileFor(REGISTER_SETTINGS_PATH))).toBe(true);
  });

  it('ボタンの権限は、開く先の画面が求める権限と同じ（押せるのに開けない、を作らない）', () => {
    for (const link of allLinks) {
      const src = readFileSync(pageFileFor(link.href), 'utf8');
      const required = src.match(/requirePermission\('([a-z.]+)'\)/)?.[1];
      if (required) expect(link.permission, link.href).toBe(required);
      else expect(src, link.href).toContain(`can(ctx.role, '${link.permission}')`);
    }
  });

  it('メニューブックのタブは実在するタブだけ', () => {
    for (const link of allLinks.filter((l) => l.href.startsWith('/app/settings/menu-book'))) {
      const tab = new URLSearchParams(link.href.split('?')[1] ?? '').get('tab');
      expect(isMenuBookTab(tab), link.href).toBe(true);
    }
    expect(MENU_BOOK_TABS).toEqual(['categories', 'pages', 'items', 'plans', 'lunch', 'takeout']);
    expect(isMenuBookTab('pages')).toBe(true);
    expect(isMenuBookTab('nope')).toBe(false);
    expect(isMenuBookTab(undefined)).toBe(false);
  });

  it('開く先には「レジの設定から開いた」印を付け、元のクエリ（tab）も残す', () => {
    expect(withFromRegister('/app/settings/menu')).toBe(`/app/settings/menu?from=${FROM_REGISTER}`);
    expect(withFromRegister('/app/settings/menu-book?tab=pages')).toBe('/app/settings/menu-book?tab=pages&from=register');
    expect(withFromRegister('/app/pos/sold-out', ORDER)).toBe(`/app/pos/sold-out?from=register&order=${ORDER}`);
    // 伝票 id でないものは持ち回らない
    expect(withFromRegister('/app/pos/sold-out', 'x<script>')).toBe('/app/pos/sold-out?from=register');
  });

  it('伝票から開いたときは、その伝票に戻れる', () => {
    expect(registerOrderId(ORDER)).toBe(ORDER);
    expect(registerOrderId('abc')).toBeNull();
    expect(registerOrderId(undefined)).toBeNull();
    expect(registerSettingsUrl(ORDER)).toBe(`/app/pos/settings?order=${ORDER}`);
    expect(registerSettingsUrl(null)).toBe('/app/pos/settings');
    expect(registerBackUrl(ORDER)).toBe(`/app/pos?order=${ORDER}`);
    expect(registerBackUrl('bad')).toBe('/app/pos');
  });

  it('オーナー・店長は全部押せる。アルバイトは品切れだけ押せて、ほかは「店長以上」', () => {
    for (const role of ['org_owner', 'store_manager'] as const) {
      expect(registerSettingSections(role).every((s) => s.links.every((l) => l.allowed))).toBe(true);
    }
    const partTime = registerSettingSections('part_time').flatMap((s) => s.links);
    expect(partTime.find((l) => l.id === 'sold-out')?.allowed).toBe(true);
    expect(partTime.filter((l) => l.id !== 'sold-out').every((l) => !l.allowed)).toBe(true);
    expect(permissionHint('menu.manage')).toBe('店長以上が変更できます');
    const withOrder = registerSettingSections('org_owner', ORDER).flatMap((s) => s.links);
    expect(withOrder.every((l) => l.url.includes('from=register') && l.url.includes(`order=${ORDER}`))).toBe(true);
  });

  it('左メニューに「レジの設定」が出る（スタッフも）。上部の画面タイトルも「レジの設定」', () => {
    const items = (role: Parameters<typeof visibleNavGroups>[0]) => visibleNavGroups(role).flatMap((g) => g.items.map((i) => i.href));
    expect(items('part_time')).toContain('/app/pos/settings');
    expect(items('org_owner')).toContain('/app/pos/settings');
    expect(screenTitleFor('/app/pos/settings')?.label).toBe('レジの設定');
    expect(screenTitleFor('/app/pos/sold-out')?.label).toBe('品切れ設定');
    expect(screenTitleFor('/app/pos')?.label).toBe('オーダー・会計');
  });
});
