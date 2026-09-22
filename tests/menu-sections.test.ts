import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { itemInMode } from '@/components/settings/menu-items-panel';
import { screenTitleFor } from '@/lib/nav';

const ROOT = join(__dirname, '..');

describe('設定のメニューを dinii と同じく メニュー／プラン／オプション／カテゴリ に分ける（2026-09-23）', () => {
  it('メニューは単品、プランはコースだけ', () => {
    expect(itemInMode('food', 'menu')).toBe(true);
    expect(itemInMode('drink', 'menu')).toBe(true);
    expect(itemInMode('option', 'menu')).toBe(true);
    expect(itemInMode('course', 'menu')).toBe(false);
    expect(itemInMode('course', 'plan')).toBe(true);
    expect(itemInMode('food', 'plan')).toBe(false);
    expect(itemInMode('course', 'all')).toBe(true);
  });

  it('画面が実在し、メニュー編集の権限で開く', () => {
    for (const path of ['menu', 'plans', 'categories', 'options', 'menu-book']) {
      const file = join(ROOT, 'app/app/settings', path, 'page.tsx');
      expect(existsSync(file), path).toBe(true);
    }
    for (const path of ['menu', 'plans', 'categories']) {
      const src = readFileSync(join(ROOT, 'app/app/settings', path, 'page.tsx'), 'utf8');
      expect(src).toContain("requirePermission('menu.manage')");
    }
  });

  it('設定の左メニューに「メニュー」のまとまりがある', () => {
    const src = readFileSync(join(ROOT, 'app/app/settings/layout.tsx'), 'utf8');
    const i = src.indexOf("label: 'メニュー',");
    expect(i).toBeGreaterThan(0);
    const group = src.slice(i, src.indexOf('],', i));
    const hrefs = [...group.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      '/app/settings/menu',
      '/app/settings/plans',
      '/app/settings/options',
      '/app/settings/categories',
      '/app/settings/menu-book',
    ]);
  });

  it('上部バーの画面名', () => {
    expect(screenTitleFor('/app/settings/menu')?.label).toBe('メニュー');
    expect(screenTitleFor('/app/settings/plans')?.label).toBe('プラン');
    expect(screenTitleFor('/app/settings/categories')?.label).toBe('カテゴリ');
    expect(screenTitleFor('/app/settings/options')?.label).toBe('オプション');
  });
});
