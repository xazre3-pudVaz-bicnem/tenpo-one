import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isNativeMenuPagesActionType, parseNativeMenuPagesAction } from '@/lib/native-menu-pages';

const STORE = '11111111-1111-4111-8111-111111111111';
const CAT = '22222222-2222-4222-8222-222222222222';
const route = readFileSync('app/api/app/v1/pos/route.ts', 'utf8');

describe('オーダー画面の「編集 Edit tabs」（Web のレジの MenuPagesDialog と同じ保存）', () => {
  it('ページの並び・名前とカテゴリの行き先を受け付ける', () => {
    expect(isNativeMenuPagesActionType('menuPagesSave')).toBe(true);
    const ok = parseNativeMenuPagesAction({
      type: 'menuPagesSave',
      storeId: STORE,
      pages: [{ key: 'picks', name: 'おすすめ' }, { key: 'drink', name: 'DRINK' }, { key: 'page1', name: 'ランチ' }],
      categoryPage: { [CAT]: 'drink' },
    });
    expect(ok).toEqual({
      ok: true,
      action: {
        type: 'menuPagesSave',
        storeId: STORE,
        pages: [{ key: 'picks', name: 'おすすめ' }, { key: 'drink', name: 'DRINK' }, { key: 'page1', name: 'ランチ' }],
        categoryPage: { [CAT]: 'drink' },
      },
    });
  });

  it('変な形は受け付けない', () => {
    const base = { type: 'menuPagesSave', storeId: STORE, pages: [{ key: 'drink', name: 'DRINK' }], categoryPage: {} };
    expect(parseNativeMenuPagesAction(base).ok).toBe(true);
    expect(parseNativeMenuPagesAction({ ...base, storeId: 'x' }).ok).toBe(false);
    expect(parseNativeMenuPagesAction({ ...base, pages: [] }).ok).toBe(false);
    expect(parseNativeMenuPagesAction({ ...base, pages: [{ key: 'Bad Key', name: 'x' }] }).ok).toBe(false);
    expect(parseNativeMenuPagesAction({ ...base, categoryPage: { x: 'drink' } }).ok).toBe(false);
    expect(parseNativeMenuPagesAction({ ...base, categoryPage: { [CAT]: 1 } }).ok).toBe(false);
  });

  it('中身は Web と同じ Server Action・店長以上（menu.manage）・店の回線', () => {
    expect(route).toContain('saveMenuBookPages(pa.storeId');
    expect(route).toContain("part === 'menuPages'");
    const block = route.slice(route.indexOf('isNativeMenuPagesActionType((raw'));
    expect(block.indexOf("can(ctx.role, 'menu.manage')")).toBeLessThan(block.indexOf('networkProblem(ctx)'));
  });
});
