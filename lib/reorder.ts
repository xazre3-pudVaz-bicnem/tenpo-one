/**
 * 発注提案（純関数・テスト対象）。
 * 自動発注はしない。推奨数を提示し、人が確認して発注書へ変換する。
 */

export interface ReorderInput {
  currentQuantity: number;
  /** 適正在庫（未設定時は 発注点 + 平均日販×リードタイム で代替） */
  optimalQuantity: number | null;
  minQuantity: number | null;
  reorderPoint: number | null;
  avgDailySales: number; // 過去実績からの平均日販（在庫単位）
  leadTimeDays: number;  // 発注リードタイム（既定3日）
}

export interface ReorderSuggestion {
  /** 発注が必要か（現在庫 <= 発注点 or 最低在庫） */
  needed: boolean;
  /** 推奨在庫水準 */
  targetQuantity: number;
  /** 推奨発注数（= 推奨在庫 − 現在庫 − 入荷待ち。0未満は0） */
  suggestedQuantity: number;
  /** 判定根拠の説明（UI表示用） */
  basis: string;
}

export function suggestReorder(input: ReorderInput, incomingQuantity = 0): ReorderSuggestion {
  const reorderPoint = input.reorderPoint ?? input.minQuantity ?? 0;
  const needed = input.currentQuantity <= reorderPoint;

  let targetQuantity: number;
  let basis: string;
  if (input.optimalQuantity != null && input.optimalQuantity > 0) {
    targetQuantity = input.optimalQuantity;
    basis = `適正在庫 ${input.optimalQuantity}`;
  } else {
    targetQuantity = reorderPoint + Math.ceil(input.avgDailySales * input.leadTimeDays);
    basis = `発注点 ${reorderPoint} + 平均日販 ${input.avgDailySales} × リードタイム ${input.leadTimeDays}日`;
  }

  const suggestedQuantity = Math.max(
    0,
    Math.ceil(targetQuantity - input.currentQuantity - incomingQuantity)
  );
  return { needed, targetQuantity, suggestedQuantity, basis };
}
