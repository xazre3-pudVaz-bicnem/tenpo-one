import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ClosingSnapshot, type RegisterBreakdownRow } from '@/components/cash/closing-snapshot';
import { CLOSING_STATUS_LABELS, CLOSING_STATUS_TONES, type ClosingStatus } from '@/components/cash/labels';

/** daily_closings の1行のうち、サマリ表示に使う列 */
export interface TodayClosingRow {
  status: string;
  sales_total: number;
  refund_total: number;
  net_sales: number;
  discount_total: number;
  payment_breakdown: unknown;
  refund_breakdown: unknown;
  petty_in_total: number;
  petty_out_total: number;
  expected_cash: number | null;
  counted_cash: number | null;
  cash_difference: number;
}

/** 本日の店舗日次締めのサマリ（入出金・レジクローズ共通） */
export function TodayClosingSummary({
  closing,
  registerBreakdown,
}: {
  closing: TodayClosingRow;
  registerBreakdown: RegisterBreakdownRow[];
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle en="Day close">本日の締めサマリ</CardTitle>
        <Badge tone={CLOSING_STATUS_TONES[closing.status as ClosingStatus]}>
          {CLOSING_STATUS_LABELS[closing.status as ClosingStatus]}
        </Badge>
      </CardHeader>
      <CardContent>
        <ClosingSnapshot
          data={{
            salesTotal: closing.sales_total,
            refundTotal: closing.refund_total,
            netSales: closing.net_sales,
            discountTotal: closing.discount_total,
            paymentBreakdown: (closing.payment_breakdown as Record<string, number>) ?? {},
            refundBreakdown: (closing.refund_breakdown as Record<string, number>) ?? {},
            pettyInTotal: closing.petty_in_total,
            pettyOutTotal: closing.petty_out_total,
            expectedCash: closing.expected_cash,
            countedCash: closing.counted_cash,
            cashDifference: closing.cash_difference,
            registerBreakdown,
          }}
        />
      </CardContent>
    </Card>
  );
}
