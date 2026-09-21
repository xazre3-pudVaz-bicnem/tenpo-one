/**
 * 品切れ（売切）の設定画面の計算（DB・React 非依存・テスト対象）。
 * 2026-09-21 店舗要望「各ドリンクや料理の品切れ（Sold Out）の設定ができるようにしてほしい」。
 * ハンディ・レジのどちらからでも、スタッフが商品ごとに売切／販売再開を切り替える。
 * 売切にした商品はレジ・ハンディ・お客様QRで注文できなくなる（menu_items.is_sold_out）。
 */

export interface SoldOutItem {
  id: string;
  categoryId: string | null;
  name: string;
  nameKana: string | null;
  price: number;
  isSoldOut: boolean;
  sortOrder: number;
  /** 全店共通の商品（売切にすると全店に効く。店長以上だけが切り替えられる） */
  shared: boolean;
}

export interface SoldOutCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface SoldOutSection {
  id: string;
  name: string;
  items: SoldOutItem[];
}

export type SoldOutFilter = 'all' | 'soldOut';

/** 検索用に揃える（全角英数・カナの大小・空白の違いを吸収する） */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

const byOrder = <T extends { sortOrder: number; name: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja');

/**
 * カテゴリごとに並べる（レジ・ハンディと同じ並び順）。検索語と「売切中だけ」で絞り、商品が無いカテゴリは出さない。
 * カテゴリが無い商品は最後の「その他」にまとめる。
 */
export function soldOutSections(
  categories: readonly SoldOutCategory[],
  items: readonly SoldOutItem[],
  opts: { query?: string; filter?: SoldOutFilter } = {}
): SoldOutSection[] {
  const q = normalizeForSearch(opts.query ?? '');
  const matches = (i: SoldOutItem) =>
    (opts.filter !== 'soldOut' || i.isSoldOut) &&
    (!q || normalizeForSearch(i.name).includes(q) || normalizeForSearch(i.nameKana ?? '').includes(q));
  const known = new Set(categories.map((c) => c.id));
  const sections: SoldOutSection[] = [...categories]
    .sort(byOrder)
    .map((c) => ({ id: c.id, name: c.name, items: items.filter((i) => i.categoryId === c.id && matches(i)).sort(byOrder) }))
    .filter((s) => s.items.length > 0);
  const orphans = items.filter((i) => (!i.categoryId || !known.has(i.categoryId)) && matches(i)).sort(byOrder);
  if (orphans.length > 0) sections.push({ id: '__none__', name: 'その他', items: orphans });
  return sections;
}

/** 売切中の商品の数 */
export function soldOutCount(items: readonly Pick<SoldOutItem, 'isSoldOut'>[]): number {
  return items.reduce((n, i) => n + (i.isSoldOut ? 1 : 0), 0);
}
