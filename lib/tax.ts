/**
 * 税率の適用判定。
 * 店内飲食 = 標準税率10% / テイクアウト・デリバリー = 軽減税率8%（飲食料品）
 * 酒類はテイクアウトでも10%。
 */

export type OrderType = 'dine_in' | 'takeout' | 'delivery' | 'course' | 'pre_order';

export function applicableTaxRate(orderType: OrderType, isAlcohol: boolean): number {
  if (orderType === 'takeout' || orderType === 'delivery' || orderType === 'pre_order') {
    return isAlcohol ? 10 : 8;
  }
  return 10;
}

export const TAX_RATE_STANDARD = 10;
export const TAX_RATE_REDUCED = 8;
