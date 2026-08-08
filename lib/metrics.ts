/**
 * 売上指標の正式定義（shared metrics layer）。
 * ダッシュボード・レポート・予算・日報・レジ締め・CSVはすべてこの定義を使い、
 * 画面ごとに別の式を書かないこと（v0.4.2 TRANSACTION & ACCOUNTING CONSISTENCY）。
 *
 * 正式定義:
 *   gross_sales   = 会計成立注文（status: paid + refunded）の total 合計。返金は控除しない
 *   discounts     = 同注文の discount_total 合計（gross_salesは値引後金額）
 *   refunds       = 期間内の refunds.amount 合計（**返金の営業日**で計上。元取引の営業日ではない）
 *   net_sales     = gross_sales − refunds
 *   transaction_count = 会計成立注文の件数（paid + refunded）
 *   guests        = 会計成立注文の guest_count 合計
 *   avg_spend     = net_sales ÷ guests（floor・guests=0なら0）
 *
 * 設計原則:
 * - 元取引（orders.total）は返金があっても上書きしない。grossとして保持し、
 *   返金は refunds テーブルで別計上 → net はこの層で導出する。
 * - 全額返金された注文も gross・件数・客数に含まれる（返金側で相殺される）。
 *   これにより「売上日と返金日が異なる」ケースでも各営業日の数字が確定後に変わらない。
 * - VOID（kind='void'・取引取消）も返金として控除に含むが、区別して表示できるよう分離集計を提供。
 */

export interface SettledOrderLike {
  total: number;
  discount_total?: number;
  guest_count?: number;
  /** 'paid' | 'refunded'（それ以外は集計前に除外しておくこと） */
  status?: string;
  /** 'dine_in' | 'course' | 'takeout' | 'delivery' | 'pre_order'。客数KPIのテイクアウト包含判定に使用 */
  order_type?: string;
}

export interface SalesMetricsOptions {
  /**
   * 客数KPIにテイクアウト/デリバリー/事前注文の guest_count を含めるか。
   * organizations.kpi_settings.includeTakeoutGuests（省略時 true）。
   * order_type が無いデータは店内扱い（常に含める）。
   */
  includeTakeoutGuests?: boolean;
}

const OFF_PREMISE_TYPES = new Set(['takeout', 'delivery', 'pre_order']);

/** 客数KPIの対象判定（有効客数）。店内飲食は常に対象。 */
export function isGuestCountedOrder(order: SettledOrderLike, opts?: SalesMetricsOptions): boolean {
  if (opts?.includeTakeoutGuests === false && order.order_type && OFF_PREMISE_TYPES.has(order.order_type)) {
    return false;
  }
  return true;
}

export interface RefundLike {
  amount: number;
  /** 'refund' | 'void' */
  kind?: string;
}

export interface SalesMetrics {
  grossSales: number;
  discounts: number;
  refunds: number;
  /** うちVOID（取引取消）分 */
  voidAmount: number;
  netSales: number;
  transactionCount: number;
  guests: number;
  /** net_sales ÷ guests */
  avgSpend: number;
}

/**
 * 正式定義に基づく売上指標の集計。orders は paid/refunded のみを渡すこと。
 * 客数は有効客数（isGuestCountedOrder。企業設定でテイクアウトを除外可能）で、
 * 客単価 = net_sales ÷ 有効客数。
 */
export function computeSalesMetrics(
  orders: SettledOrderLike[],
  refunds: RefundLike[],
  opts?: SalesMetricsOptions
): SalesMetrics {
  const grossSales = orders.reduce((a, o) => a + o.total, 0);
  const discounts = orders.reduce((a, o) => a + (o.discount_total ?? 0), 0);
  const refundTotal = refunds.reduce((a, r) => a + r.amount, 0);
  const voidAmount = refunds.filter((r) => r.kind === 'void').reduce((a, r) => a + r.amount, 0);
  const netSales = grossSales - refundTotal;
  const guests = orders
    .filter((o) => isGuestCountedOrder(o, opts))
    .reduce((a, o) => a + (o.guest_count ?? 0), 0);
  return {
    grossSales,
    discounts,
    refunds: refundTotal,
    voidAmount,
    netSales,
    transactionCount: orders.length,
    guests,
    avgSpend: guests > 0 ? Math.floor(netSales / guests) : 0,
  };
}

/** settled（会計成立）注文のstatusフィルタ。クエリの .in('status', SETTLED_ORDER_STATUSES) に使う */
export const SETTLED_ORDER_STATUSES = ['paid', 'refunded'] as const;

// -------------------------------------------------------------
// レジ現金の正式定義
// -------------------------------------------------------------

export interface CashDrawerInput {
  openingFloat: number;
  cashSales: number;
  /** その他現金入金（deposit / petty_in） */
  cashIn: number;
  cashRefunds: number;
  /** 小口現金出金・出金（withdrawal / petty_out） */
  cashOut: number;
}

/**
 * 理論現金 = 開始現金 + 現金売上 + その他現金入金 − 現金返金 − 小口現金出金。
 * クレジット/QR/電子マネー返金は現金残高へ影響しない（DB側 close_register_session と同一式）。
 */
export function expectedCash(input: CashDrawerInput): number {
  return input.openingFloat + input.cashSales + input.cashIn - input.cashRefunds - input.cashOut;
}

// -------------------------------------------------------------
// 原価の正式定義（理論原価と実原価を混同しない）
// -------------------------------------------------------------

/**
 * 理論原価: 販売商品 × レシピ × 平均仕入単価（stock_movements 'sale' の理論消費）。
 * 実原価  : 理論原価 + 廃棄 + 棚卸差異等の実在庫変動を加えた「実際に消えた在庫価値」。
 *   実原価 = 理論原価 + 廃棄額 + 棚卸差異額(不足を正) + その他調整
 * 差異の内訳（廃棄 / 棚卸差異 / その他）へドリルダウンできる形で返す。
 */
export interface CostVarianceInput {
  /** 理論原価（レシピ×平均仕入単価。components/reports/cost.ts の集計値） */
  theoreticalCost: number;
  /** 廃棄額（stock_movements movement_type='waste' の |quantity|×unit_cost 合計） */
  wasteAmount: number;
  /** 棚卸差異額（movement_type='count_adjust'。在庫不足（マイナス調整）を正の費用として渡す） */
  countAdjustmentAmount: number;
  /** その他調整（手動調整等。通常0） */
  otherAdjustmentAmount?: number;
}

export interface CostVariance {
  theoreticalCost: number;
  actualCost: number;
  /** 実原価 − 理論原価 */
  variance: number;
  /** variance ÷ 理論原価 ×100（理論原価0なら0） */
  varianceRate: number;
  breakdown: {
    waste: number;
    countAdjustment: number;
    other: number;
  };
}

export function computeCostVariance(input: CostVarianceInput): CostVariance {
  const other = input.otherAdjustmentAmount ?? 0;
  const actualCost =
    input.theoreticalCost + input.wasteAmount + input.countAdjustmentAmount + other;
  const variance = actualCost - input.theoreticalCost;
  return {
    theoreticalCost: input.theoreticalCost,
    actualCost,
    variance,
    varianceRate:
      input.theoreticalCost > 0 ? (variance / input.theoreticalCost) * 100 : 0,
    breakdown: {
      waste: input.wasteAmount,
      countAdjustment: input.countAdjustmentAmount,
      other,
    },
  };
}

// -------------------------------------------------------------
// 仕入価格変動（分析用の参考指標）
// -------------------------------------------------------------

export interface PurchaseReceiptLike {
  quantity: number;
  /** 今回の仕入単価（在庫単位あたり・円） */
  unitCost: number;
  /** 基準単価（期首時点の平均仕入単価等。nullなら比較不能で除外） */
  baselineUnitCost: number | null;
}

export interface PurchasePriceVariance {
  /** Σ 数量 × (今回単価 − 基準単価)。正=値上がりによる原価増 */
  totalVariance: number;
  /** 比較可能だった仕入額（基準単価×数量の合計） */
  baselineAmount: number;
  /** totalVariance ÷ baselineAmount ×100 */
  varianceRate: number;
  /** 基準単価が無く比較できなかった受入件数 */
  excludedCount: number;
}

/**
 * 仕入価格変動 = Σ 数量×(今回単価−基準単価)。
 * 注意: 実原価（理論+廃棄+棚卸差異）の恒等式とは**独立した参考指標**。
 * 理論原価は平均仕入単価を使うため価格変動は理論側にも徐々に反映される。
 * 差異内訳に加算して二重計上しないこと。
 */
export function computePurchasePriceVariance(receipts: PurchaseReceiptLike[]): PurchasePriceVariance {
  let totalVariance = 0;
  let baselineAmount = 0;
  let excludedCount = 0;
  for (const r of receipts) {
    if (r.baselineUnitCost == null) {
      excludedCount += 1;
      continue;
    }
    totalVariance += Math.round(r.quantity * (r.unitCost - r.baselineUnitCost));
    baselineAmount += Math.round(r.quantity * r.baselineUnitCost);
  }
  return {
    totalVariance,
    baselineAmount,
    varianceRate: baselineAmount > 0 ? (totalVariance / baselineAmount) * 100 : 0,
    excludedCount,
  };
}

/** 値上がり検出（前期比 rate% 以上の上昇）。ルールベースの単純判定 */
export function isPriceIncreaseSignificant(
  currentUnitCost: number,
  previousUnitCost: number | null,
  thresholdPct = 10
): boolean {
  if (previousUnitCost == null || previousUnitCost <= 0) return false;
  return ((currentUnitCost - previousUnitCost) / previousUnitCost) * 100 >= thresholdPct;
}

// -------------------------------------------------------------
// 返金可能額
// -------------------------------------------------------------

/** 返金可能残額 = 支払済み合計 − 返金済み合計（DB側 refund_order でも同一検証を強制） */
export function refundableAmount(paidTotal: number, refundedTotal: number): number {
  return Math.max(0, paidTotal - refundedTotal);
}
