import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MENU_SETTINGS_KEYS, cloneRow, copyMenuSettings, remapIds } from '@/lib/store-menu-copy';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const CAT_OLD = '11111111-1111-4111-8111-111111111111';
const CAT_NEW = '22222222-2222-4222-8222-222222222222';
const ITEM_OLD = '33333333-3333-4333-8333-333333333333';
const ITEM_NEW = '44444444-4444-4444-8444-444444444444';
const SHARED = '55555555-5555-4555-8555-555555555555';
const map = new Map([
  [CAT_OLD, CAT_NEW],
  [ITEM_OLD, ITEM_NEW],
]);

/** 2026-10-14 Ronnie「FULLMOoN 五反田を追加。メニューとレジの設定は肉ギャング渋谷と同じ」 */
describe('店舗のメニューをコピー', () => {
  it('設定の中の ID（値・オブジェクトのキー）を新しい ID に置き換える。全店共通の ID はそのまま', () => {
    const src = {
      menuBook: { categories: { [CAT_OLD]: 'tab', [SHARED]: 'hide' }, plans: { [ITEM_OLD]: [CAT_OLD, SHARED] }, lunch: { start: '11:00', end: '15:00' } },
      dynamicPricing: { rules: [{ target: 'categories', categoryIds: [CAT_OLD], itemIds: [] }] },
      takeoutMenu: { itemIds: [ITEM_OLD] },
      courseSteps: { [ITEM_OLD]: [CAT_OLD] },
    };
    const out = remapIds(src, map) as typeof src;
    expect(out.menuBook.categories).toEqual({ [CAT_NEW]: 'tab', [SHARED]: 'hide' });
    expect(out.menuBook.plans).toEqual({ [ITEM_NEW]: [CAT_NEW, SHARED] });
    expect(out.menuBook.lunch).toEqual({ start: '11:00', end: '15:00' });
    expect(out.dynamicPricing.rules[0].categoryIds).toEqual([CAT_NEW]);
    expect(out.takeoutMenu.itemIds).toEqual([ITEM_NEW]);
    expect(out.courseSteps).toEqual({ [ITEM_NEW]: [CAT_NEW] });
  });

  it('メニューのキーだけコピー。コピー先のテーブル・回線・通知などはそのまま、コピー元のそれは入れない', () => {
    const src = { menuBook: { categories: { [CAT_OLD]: 'tab' } }, tableGroups: [{ id: 'x' }], handyQr: { networks: ['a'] }, pushSubscriptions: [1] };
    const dst = { tableGroups: [{ id: 'mine' }], policy: { key: 'k' } };
    const out = copyMenuSettings(src, dst, map);
    expect(out.menuBook).toEqual({ categories: { [CAT_NEW]: 'tab' } });
    expect(out.tableGroups).toEqual([{ id: 'mine' }]);
    expect(out.policy).toEqual({ key: 'k' });
    expect(out.handyQr).toBeUndefined();
    expect(out.pushSubscriptions).toBeUndefined();
    expect(MENU_SETTINGS_KEYS).not.toContain('tableGroups');
    expect(MENU_SETTINGS_KEYS).not.toContain('registerReport');
  });

  it('行の複製：作成日時を外し、店舗・ID を差し替える', () => {
    const row = { id: ITEM_OLD, store_id: 'src', name: 'ハラミ', created_at: 'x', updated_at: 'y', is_sold_out: true };
    expect(cloneRow(row, { id: ITEM_NEW, store_id: 'dst', is_sold_out: false })).toEqual({
      id: ITEM_NEW,
      store_id: 'dst',
      name: 'ハラミ',
      is_sold_out: false,
    });
  });

  it('運営管理だけ・同じ企業の店舗だけ・空の店舗にだけ', () => {
    const actions = read('app/admin/organizations/actions.ts');
    const fn = actions.slice(actions.indexOf('export async function copyStoreMenu'));
    expect(fn).toContain('await requireCypressAdmin()');
    expect(fn).toContain('source.organization_id !== org || target.organization_id !== org');
    expect(fn).toContain('にはもうメニューがあります。空の店舗にだけコピーできます');
    expect(fn).toContain('is_sold_out: false');
    expect(fn).toContain("p_action: 'store.menu_copy'");
  });
});
