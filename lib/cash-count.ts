/**
 * 現金実査（金種別に枚数を数える）の計算。純関数のみ・テスト対象。
 * 並び順は現場が数える順（1円から）。レジ内のトレイの並びに合わせている。
 */
export const CASH_DENOMINATIONS = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000] as const;

export type CashDenomination = (typeof CASH_DENOMINATIONS)[number];

/** 金種 → 枚数。未入力の金種はキーごと無い */
export type DenominationCounts = Partial<Record<CashDenomination, number>>;

/** 硬貨（枚数の「枚」ではなく「個」と言う店もあるが、表記は「枚」で統一する） */
export function denominationLabel(denom: CashDenomination): string {
  return denom >= 1000 ? `${denom.toLocaleString('ja-JP')}円札` : `${denom}円`;
}

/** 1金種ぶんの金額。不正な枚数は0として扱う（入力途中で計算が壊れないように） */
export function denominationSubtotal(denom: CashDenomination, count: number | undefined | null): number {
  if (count == null || !Number.isFinite(count) || count < 0) return 0;
  return denom * Math.floor(count);
}

/** 実査額の合計 */
export function sumDenominations(counts: DenominationCounts): number {
  return CASH_DENOMINATIONS.reduce((total, denom) => total + denominationSubtotal(denom, counts[denom]), 0);
}

/** 1枚でも入力されているか（未入力のままクローズするのを止めるため） */
export function hasAnyCount(counts: DenominationCounts): boolean {
  return CASH_DENOMINATIONS.some((denom) => (counts[denom] ?? 0) > 0);
}
