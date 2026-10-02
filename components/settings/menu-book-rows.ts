/**
 * メニューブックの「カテゴリの行」を作る（設定のメニューブック画面と、レジの「タブを編集」で共通）。
 * 純粋な関数だけ（DB・React 非依存）。
 */
import { classifyMenuItem, HANDY_GROUPS, type HandyGroupId } from '@/components/handy/logic';
import { autoCategoryShow, categoryShow, type MenuBookItemInput, type MenuBookSettings, type MenuBookShow } from '@/lib/menu-book';

export interface MenuBookCategoryRow {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  sortOrder: number;
  /** 全店共通のカテゴリ（並び順を変えると全店に効く） */
  shared: boolean;
  itemCount: number;
  /** 厨房のステーション（ページの自動振り分けに使う） */
  station: string | null;
  /** 売る商品が全部0円か（＝食べ放題・飲み放題の中身） */
  allZeroPrice: boolean;
  /** ハンディの上位分類（フード／ドリンク…） */
  group: string;
  show: MenuBookShow | 'auto';
  autoShow: MenuBookShow;
}

export interface MenuBookCategorySource {
  id: string;
  name: string;
  name_en: string | null;
  color: string | null;
  sort_order: number;
  station: string | null;
  store_id: string | null;
}

export interface MenuBookItemSource {
  category_id: string | null;
  name: string;
  price: number | string;
  item_type: string;
}

/** カテゴリ（並び順どおり）と販売中の商品から、メニューブックの行を作る */
export function menuBookCategoryRows(
  categories: readonly MenuBookCategorySource[],
  activeItems: readonly MenuBookItemSource[],
  book: MenuBookSettings
): MenuBookCategoryRow[] {
  const itemInputs: MenuBookItemInput[] = activeItems.map((i) => ({
    categoryId: i.category_id,
    name: i.name,
    price: Number(i.price),
    itemType: i.item_type,
  }));
  const groupLabel = new Map(HANDY_GROUPS.map((g) => [g.id, g.label]));

  return categories.map((c) => {
    const mine = activeItems.filter((i) => i.category_id === c.id);
    // ハンディの上位分類（フード／ドリンク…）は商品の種類で決まる。カテゴリでいちばん多いものを見出しに出す
    const counts = new Map<HandyGroupId, number>();
    for (const i of mine) {
      const g = classifyMenuItem(i.item_type, c.station);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const { show, auto } = categoryShow({ id: c.id, name: c.name }, itemInputs, book);
    return {
      id: c.id,
      name: c.name,
      nameEn: c.name_en ?? '',
      color: c.color ?? '#7b3fe4',
      sortOrder: c.sort_order,
      shared: c.store_id === null,
      itemCount: mine.length,
      station: c.station ?? null,
      // 0円だけのカテゴリ＝食べ放題・飲み放題の中身（ページの自動振り分けに使う）
      allZeroPrice: mine.length > 0 && mine.every((i) => Number(i.price) === 0),
      group: top ? (groupLabel.get(top) ?? '') : '',
      show: auto ? 'auto' : show,
      autoShow: autoCategoryShow({ id: c.id, name: c.name }, itemInputs),
    };
  });
}
