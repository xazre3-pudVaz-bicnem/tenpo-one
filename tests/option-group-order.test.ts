import { describe, expect, it } from 'vitest';
import { sortOptionGroupLinks } from '@/lib/option-group-order';
import { optionGroupsFrom } from '@/lib/native-pos';

const link = (item: string, group: string, groupOrder: number, linkOrder: number) => ({
  menu_item_id: item,
  sort_order: linkOrder,
  menu_option_groups: {
    id: group,
    name: group,
    is_required: true,
    min_select: 1,
    max_select: 1,
    sort_order: groupOrder,
    status: 'active',
    menu_option_items: [{ id: `${group}-1`, name: 'x', name_en: null, price: 0, sort_order: 0, status: 'active' }],
  },
});

describe('選択肢グループの並び（レジ・ハンディのダイアログで上から出す順）', () => {
  it('グループの sort_order（設定画面の上へ・下へ）で並び、紐付けの順番は後', () => {
    // 紐付けの順番だけ見ると 辛さ → ドリンク → カレー → 主食 になってしまう
    const links = [
      link('item', '辛さ', 2, 0),
      link('item', 'ランチドリンク', 3, 1),
      link('item', 'カレーを選ぶ', 1, 2),
      link('item', '主食（ナン・ライス）', 0, 3),
    ];
    const sorted = sortOptionGroupLinks(links, (l) => l.menu_option_groups, (l) => l.sort_order);
    expect(sorted.map((l) => l.menu_option_groups.name)).toEqual([
      '主食（ナン・ライス）',
      'カレーを選ぶ',
      '辛さ',
      'ランチドリンク',
    ]);
  });

  it('iPad アプリ向け optionGroupsFrom も同じ並び', () => {
    const groups = optionGroupsFrom([link('item', 'B', 1, 0), link('item', 'A', 0, 1)]);
    expect(groups.item.map((g) => g.name)).toEqual(['A', 'B']);
  });

  it('グループの sort_order が同じなら紐付けの順番', () => {
    const sorted = sortOptionGroupLinks(
      [link('item', 'Y', 0, 1), link('item', 'X', 0, 0)],
      (l) => l.menu_option_groups,
      (l) => l.sort_order
    );
    expect(sorted.map((l) => l.menu_option_groups.name)).toEqual(['X', 'Y']);
  });
});
