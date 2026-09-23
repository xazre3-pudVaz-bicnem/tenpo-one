import { describe, it, expect } from 'vitest';
import { menuLayout, SUMMARY_ITEM } from '@/app/app/menu/data';
import { NAV_GROUPS, NAV_TILES, MOBILE_NAV, TABLET_NAV } from '@/lib/nav';

describe('menuLayout（iPad・スマホのメニュー一覧）', () => {
  const layout = menuLayout('org_owner');
  const mainHrefs = layout.main.map((i) => i.href);
  const summaryHrefs = layout.summaryGroups.flatMap((g) => g.items).map((i) => i.href);
  const allHrefs = [...mainHrefs, ...summaryHrefs, ...layout.tiles.map((t) => t.href)];

  it('メニュー一覧から外した画面は出さない', () => {
    for (const href of ['/app/pos', '/app/handy', '/app/pos/settings', '/app/scan', '/app/staff']) {
      expect(allHrefs).not.toContain(href);
    }
  });

  it('テイクアウト→伝票明細→入出金の順、仕入・経費はレジクローズの手前（大きなタイルにはしない）', () => {
    const tiles = layout.tiles.map((t) => t.href);
    expect(tiles).not.toContain('/app/cash');
    expect(tiles).not.toContain('/app/expenses');
    // テイクアウトは伝票明細の上（2026-09-24 要望でテーブル一覧の上のボタンから移した）
    expect(mainHrefs[0]).toBe('#takeout');
    expect(mainHrefs[1]).toBe('/app/orders');
    expect(mainHrefs[2]).toBe('/app/cash');
    expect(mainHrefs.indexOf('/app/expenses')).toBe(mainHrefs.indexOf('/app/cash/close') - 1);
  });

  it('在庫設定は一覧に出し、集計の中には入れない', () => {
    expect(mainHrefs).toContain('/app/inventory');
    const purchasing = layout.summaryGroups.find((g) => g.label === '仕入・在庫');
    expect(purchasing?.items.map((i) => i.href)).not.toContain('/app/inventory');
  });

  it('集計ボタンはアラートの手前（設定とアラートの間）に入れる', () => {
    const at = mainHrefs.indexOf(SUMMARY_ITEM.href);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(mainHrefs[at + 1]).toBe('/app/notifications');
  });

  it('権限で集計の中身が無ければ集計ボタンも出さない', () => {
    const staff = menuLayout('staff');
    if (staff.summaryGroups.length === 0) {
      expect(staff.main.map((i) => i.href)).not.toContain(SUMMARY_ITEM.href);
    }
  });
});

describe('左メニュー・下部ナビ（2026-09-23 要望）', () => {
  it('即会計は左メニューに出さない（オーダー・会計の中のテイクアウトから）', () => {
    const hrefs = NAV_GROUPS.flatMap((g) => g.items).map((i) => i.href);
    expect(hrefs).not.toContain('/app/pos');
    expect(NAV_TILES.map((t) => t.href)).toContain('/app/floor');
    // テーブル一覧（/app/floor）を開くタイルは 即会計 の画面も選択中として扱う
    expect(NAV_TILES.find((t) => t.href === '/app/floor')?.match).toContain('/app/pos');
  });

  it('レジ（iPad）の下部ナビはハンディを出さず、オーダー・会計を出す', () => {
    const hrefs = TABLET_NAV.map((i) => i.href);
    expect(hrefs).not.toContain('/app/handy');
    expect(hrefs).toContain('/app/floor');
    expect(hrefs).toContain('/app/menu');
    expect(TABLET_NAV.length).toBeLessThanOrEqual(5);
  });

  it('スマホの下部ナビはハンディのまま', () => {
    expect(MOBILE_NAV.map((i) => i.href)).toContain('/app/handy');
  });
});

describe('レジの左メニュー（keepActions）', () => {
  it('ドロアオープンは左メニューには残し、メニュー一覧の画面からは外す', () => {
    const sidebar = menuLayout('org_owner', undefined, { keepActions: true }).main.map((i) => i.href);
    const page = menuLayout('org_owner').main.map((i) => i.href);
    expect(sidebar).toContain('#drawer');
    expect(page).not.toContain('#drawer');
  });
});

describe('ホームは上部バーから開く（2026-09-23 要望）', () => {
  it('レジの一覧にホームは出さない', () => {
    const sidebar = menuLayout('org_owner', undefined, { keepActions: true }).main.map((i) => i.href);
    expect(sidebar).not.toContain('/app/dashboard');
  });

  it('スマホの下部ナビにはホームを残す（上部バーの戻るボタンは幅が狭いと出ないため）', () => {
    expect(MOBILE_NAV.map((i) => i.href)).toContain('/app/dashboard');
    expect(TABLET_NAV.map((i) => i.href)).toContain('/app/dashboard');
  });
});

describe('在庫設定の位置（2026-09-23 要望）', () => {
  const main = menuLayout('org_owner', undefined, { keepActions: true }).main.map((i) => i.href);

  it('一覧では「設定」の手前に出す', () => {
    expect(main.indexOf('/app/inventory')).toBe(main.indexOf('/app/settings') - 1);
  });

  it('集計の「仕入・在庫」の中には出さない（二重に出さない）', () => {
    const groups = menuLayout('org_owner').summaryGroups;
    const purchasing = groups.find((g) => g.label === '仕入・在庫');
    expect(purchasing?.items.map((i) => i.href)).not.toContain('/app/inventory');
  });
});

describe('同じものを2か所に出さない（2026-09-23 要望）', () => {
  it('メニュー・集計の中で重複しない', () => {
    const l = menuLayout('org_owner', undefined, { keepActions: true });
    const all = [
      ...l.tiles.map((t) => t.href),
      ...l.main.map((i) => i.href),
      ...l.summaryGroups.flatMap((g) => g.items).map((i) => i.href),
    ];
    expect(all.filter((h, i) => all.indexOf(h) !== i)).toEqual([]);
  });
});
