/** 原価管理（レシピ・原価率・仕入影響・廃棄）モジュール共通のラベル・しきい値・型定義 */
import type { BadgeTone } from '@/components/ui/badge';

/** 原価管理の対象とする商品種別（オプション品目は対象外） */
export type CostableItemType = 'food' | 'drink' | 'course';
export const COSTABLE_ITEM_TYPES: CostableItemType[] = ['food', 'drink', 'course'];
export const ITEM_TYPE_LABELS: Record<CostableItemType, string> = {
  food: 'フード',
  drink: 'ドリンク',
  course: 'コース',
};

/**
 * 原価率のしきい値（%）。飲食店の一般的な目安として、
 * 30%超は「要注意」（黄）、40%超は「危険水準」（赤）とする。
 */
export const COST_RATE_WARNING_THRESHOLD = 30;
export const COST_RATE_DANGER_THRESHOLD = 40;

/** 原価率に応じたバッジの色調 */
export function costRateTone(rate: number | null): BadgeTone {
  if (rate == null) return 'gray';
  if (rate > COST_RATE_DANGER_THRESHOLD) return 'danger';
  if (rate > COST_RATE_WARNING_THRESHOLD) return 'warning';
  return 'success';
}

/** 仕入単価の乖離率しきい値（%）。|最終仕入単価 − 平均仕入単価| / 平均仕入単価 が この値以上なら一覧表示する */
export const PRICE_DEVIATION_THRESHOLD = 10;

/** 廃棄・在庫差異タブのデフォルト集計期間（日数） */
export const WASTE_DEFAULT_DAYS = 30;

/** 商品原価一覧の1行 */
export interface MenuItemCostRow {
  id: string;
  name: string;
  categoryName: string;
  itemType: CostableItemType;
  price: number;
  /** menu_items.cost（手入力原価） */
  manualCost: number | null;
  /** レシピから算出した原価。レシピ未設定（食材0件）は null */
  recipeCost: number | null;
  ingredientCount: number;
  missingCostCount: number;
  /** 画面表示に使う原価（レシピ原価を優先、なければ手入力原価） */
  displayCost: number | null;
  costRate: number | null;
  grossProfitYen: number | null;
  grossProfitRate: number | null;
}

/** レシピ原価を優先し、なければ手入力原価を使う */
export function resolveDisplayCost(recipeCost: number | null, manualCost: number | null): number | null {
  return recipeCost ?? manualCost ?? null;
}
