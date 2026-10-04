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

  it('伝票明細→入出金の順、仕入・経費はレジクローズの手前（大きなタイルにはしない）。テイクアウトは出さない', () => {
    const tiles = layout.tiles.map((t) => t.href);
    expect(tiles).not.toContain('/app/cash');
    expect(tiles).not.toContain('/app/expenses');
    // テイクアウトはテーブル一覧（卓1の上の小さいボタン）から。メニューには出さない（2026-09-28 Ronnie）
    expect(mainHrefs).not.toContain('#takeout');
    expect(menuLayout('org_owner', undefined, { keepActions: true }).main.map((i) => i.href)).not.toContain('#takeout');
    expect(mainHrefs[0]).toBe('/app/orders');
    expect(mainHrefs[1]).toBe('/app/cash');
    expect(mainHrefs.indexOf('/app/expenses')).toBe(mainHrefs.indexOf('/app/cash/close') - 1);
  });

  it('管理画面だけの画面（月次清算）はレジのメニュー・集計に出さない。パソコンの左メニューには出す（2026-10-04 Ronnie）', () => {
    expect(allHrefs).not.toContain('/app/settlement');
    const pcHrefs = NAV_GROUPS.flatMap((g) => g.items).map((i) => i.href);
    expect(pcHrefs).toContain('/app/settlement');
    expect(NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === '/app/settlement')?.adminOnly).toBe(true);
  });

  it('在庫設定は一覧に出し、集計の中には入れない', () => {
    expect(mainHrefs).toContain('/app/inventory');
    const purchasing = layout.summaryGroups.find((g) => g.label === '仕入・在庫');
    expect(purchasing?.items.map((i) => i.href)).not.toContain('/app/inventory');
  });

  it('集計は一覧に出さず 設定 > 集計 に、アラートはホームの「お知らせ&アラート」に（2026-09-28 Ronnie）', () => {
    expect(mainHrefs).not.toContain(SUMMARY_ITEM.href);
    expect(mainHrefs).not.toContain('/app/menu/summary');
    expect(mainHrefs).not.toContain('/app/notifications');
    expect(SUMMARY_ITEM.href).toBe('/app/settings/summary');
    // 設定の中に入れた集計には、これまでの中身（店舗運営〜管理）がそのまま入る
    expect(layout.summaryGroups.map((g) => g.label)).toContain('経理');
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
