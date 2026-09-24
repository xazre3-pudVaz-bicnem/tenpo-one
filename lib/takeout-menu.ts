/**
 * テイクアウト専用メニュー（2026-09-25 店舗要望）。
 *
 * テイクアウトは軽減税率8%で、店内のメニューをそのまま出すと税率も値段も合わない。
 * そこで「テイクアウトメニュー」に入れた商品だけをテイクアウト伝票で打てるようにする。
 * まだ設定していない店舗は、テイクアウトでは何も打てない（空のまま）。
 *
 * データベースの列は増やさず店舗設定に持つ:
 *   store_settings.settings.takeoutMenu = { itemIds: [...] }
 */

/** テイクアウトと同じ扱いにする伝票の種類（値段は takeout_price・税率は8%） */
export const TAKEOUT_LIKE_ORDER_TYPES = ['takeout', 'delivery', 'pre_order'] as const;

export function isTakeoutLikeOrder(orderType: string | null | undefined): boolean {
  return (TAKEOUT_LIKE_ORDER_TYPES as readonly string[]).includes(orderType ?? '');
}

export interface TakeoutMenu {
  /** テイクアウトで打てる商品（menu_items.id）。空＝未設定＝テイクアウトでは何も打てない */
  itemIds: string[];
}

export function emptyTakeoutMenu(): TakeoutMenu {
  return { itemIds: [] };
}

/** 店舗設定から読む（壊れた値は捨てる） */
export function takeoutMenuFrom(settings: unknown): TakeoutMenu {
  const raw = (settings as { takeoutMenu?: unknown } | null)?.takeoutMenu;
  const ids = (raw as { itemIds?: unknown } | null)?.itemIds;
  if (!Array.isArray(ids)) return emptyTakeoutMenu();
  return { itemIds: [...new Set(ids.filter((v): v is string => typeof v === 'string' && v.length > 0))] };
}

/** 保存する形に整える（重複を取り、多すぎる分は切る） */
export const TAKEOUT_MENU_MAX = 500;

export function cleanTakeoutItemIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((v): v is string => typeof v === 'string' && v.length > 0))].slice(
    0,
    TAKEOUT_MENU_MAX
  );
}

/**
 * テイクアウト伝票で出す商品だけに絞る。
 * 未設定（空）のときは何も返さない＝テイクアウトに店内のメニューが紛れ込まない。
 */
export function filterTakeoutItems<I extends { id: string }>(items: readonly I[], menu: TakeoutMenu): I[] {
  if (menu.itemIds.length === 0) return [];
  const allow = new Set(menu.itemIds);
  return items.filter((i) => allow.has(i.id));
}

/** その商品をテイクアウトで打ってよいか（サーバー側の締め） */
export function allowsTakeoutItem(menu: TakeoutMenu, itemId: string): boolean {
  return menu.itemIds.includes(itemId);
}
