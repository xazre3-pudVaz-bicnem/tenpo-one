import { describe, it, expect } from 'vitest';
import { menuLayout, SUMMARY_ITEM } from '@/app/app/menu/data';

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

  it('入金出金・仕入経費は上のタイルに出す', () => {
    const tiles = layout.tiles.map((t) => t.href);
    expect(tiles).toContain('/app/cash');
    expect(tiles).toContain('/app/expenses');
    expect(mainHrefs).not.toContain('/app/cash');
    expect(mainHrefs).not.toContain('/app/expenses');
  });

  it('在庫設定は「仕入・在庫」の中に入れる', () => {
    const purchasing = layout.summaryGroups.find((g) => g.label === '仕入・在庫');
    expect(purchasing?.items[0]?.href).toBe('/app/inventory');
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
