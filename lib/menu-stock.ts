/**
 * メニューの売り切り（本日の食数）。2026-09-24 店舗要望「在庫の中でメニューの在庫管理・売り切り」。
 *
 * 数はデータベースの列を増やさず、店舗設定（store_settings.settings.menuStock）に持つ:
 *   { "<menu_items.id>": 20, ... }
 * 「今日あと何食あるか」は、その日（business_date）に売れた数を引いて出す。
 * 0 になった商品はレジ・ハンディ・お客様QRで自動的に売り切れになる（手動の品切れとは別）。
 */

/** 設定に入れられる食数の上限（入力ミスで在庫を無限にしないための歯止め） */
export const MENU_STOCK_MAX = 9999;

export type MenuStockLimits = Record<string, number>;

/** store_settings.settings から本日の食数の設定を取り出す（壊れた値は無視する） */
export function menuStockLimitsFrom(settings: unknown): MenuStockLimits {
  const raw = (settings as { menuStock?: unknown } | null)?.menuStock;
  if (!raw || typeof raw !== 'object') return {};
  const out: MenuStockLimits = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isInteger(n) && n >= 0 && n <= MENU_STOCK_MAX) out[id] = n;
  }
  return out;
}

/** 設定に書き戻す形（0未満・上限超え・整数でない値は入れない。null は「設定しない」＝削除） */
export function mergeMenuStockLimits(
  current: MenuStockLimits,
  changes: Record<string, number | null>
): MenuStockLimits {
  const next: MenuStockLimits = { ...current };
  for (const [id, value] of Object.entries(changes)) {
    if (value === null) {
      delete next[id];
      continue;
    }
    if (Number.isInteger(value) && value >= 0 && value <= MENU_STOCK_MAX) next[id] = value;
  }
  return next;
}

export interface MenuStockState {
  /** 本日の食数（設定した数） */
  limit: number;
  /** 本日すでに売れた数 */
  sold: number;
  /** 残り（0未満にはしない） */
  remaining: number;
  /** 残り0＝売り切れ */
  soldOut: boolean;
}

export function menuStockState(limit: number, sold: number): MenuStockState {
  const remaining = Math.max(0, limit - sold);
  return { limit, sold, remaining, soldOut: remaining <= 0 };
}

/** 商品IDごとの残数表を作る。設定が無い商品は表に入れない（＝在庫管理しない） */
export function buildMenuStock(
  limits: MenuStockLimits,
  soldByItem: Map<string, number>
): Map<string, MenuStockState> {
  const out = new Map<string, MenuStockState>();
  for (const [id, limit] of Object.entries(limits)) {
    out.set(id, menuStockState(limit, soldByItem.get(id) ?? 0));
  }
  return out;
}

/** その商品が今この瞬間「売り切れ」か（手動の品切れ or 残り0） */
export function isMenuSoldOut(
  manualSoldOut: boolean,
  stock: MenuStockState | undefined | null
): boolean {
  return manualSoldOut || !!stock?.soldOut;
}
