'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Tr, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate } from '@/lib/format';
import { approveClosing, reopenClosing, reopenStoreDay } from '@/app/app/cash/actions';
import { CLOSING_STATUS_LABELS, CLOSING_STATUS_TONES, type ClosingStatus } from '@/components/cash/labels';
import { ClosingSnapshot, type RegisterBreakdownRow } from '@/components/cash/closing-snapshot';

export interface ClosingRowData {
  id: string;
  storeId: string;
  businessDate: string;
  storeName?: string;
  salesTotal: number;
  ordersCount: number;
  guestsCount: number;
  discountTotal: number;
  refundTotal: number;
  /** 純売上（net_sales）。旧締め（expectedCashがnull）ではdefault 0のままなので信用しない */
  netSales: number;
  cashDifference: number;
  status: ClosingStatus;
  paymentBreakdown: Record<string, number>;
  refundBreakdown: Record<string, number>;
  pettyInTotal: number;
  pettyOutTotal: number;
  /** null許容。null = v0.4.2以前の締め（新snapshot列は記録されていない） */
  expectedCash: number | null;
  countedCash: number | null;
  note: string | null;
  /** レジ別内訳（v0.4.3 close_store_day）。旧データは空配列 */
  registerBreakdown: RegisterBreakdownRow[];
}

export function ClosingRow({
  closing,
  showStore,
  canApprove,
  canReopenStoreDay,
}: {
  closing: ClosingRowData;
  showStore: boolean;
  canApprove: boolean;
  /** reopen_store_day（org_owner/hq_admin/area_managerのみ）を実行できるか */
  canReopenStoreDay: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenStoreDayOpen, setReopenStoreDayOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const { toast } = useToast();

  const isLegacy = closing.expectedCash == null;

  const handleApprove = async () => {
    setPending(true);
    try {
      await approveClosing(closing.id);
      toast('承認しました');
    } catch (err) {
      toast(err instanceof Error ? err.message : '承認に失敗しました', 'error');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Tr className="cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <Td>
          <span className="flex items-center gap-1 text-gray-400">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        </Td>
        <Td className="font-medium text-navy">{formatDate(closing.businessDate)}</Td>
        {showStore && <Td>{closing.storeName ?? '—'}</Td>}
        <Td className="text-right tabular-nums">{yen(closing.salesTotal)}</Td>
        <Td className="text-right tabular-nums font-medium">{isLegacy ? '—' : yen(closing.netSales)}</Td>
        <Td className="text-right tabular-nums">{closing.ordersCount}件</Td>
        <Td className="text-right tabular-nums">{closing.guestsCount}名</Td>
        <Td className={`text-right tabular-nums font-medium ${closing.cashDifference !== 0 ? 'text-danger' : ''}`}>
          {closing.cashDifference > 0 ? '+' : ''}
          {yen(closing.cashDifference)}
        </Td>
        <Td>
          <Badge tone={CLOSING_STATUS_TONES[closing.status]}>{CLOSING_STATUS_LABELS[closing.status]}</Badge>
        </Td>
        <Td onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap gap-1.5">
            {canApprove && (closing.status === 'closed' || closing.status === 'reopened') && (
              <Button size="sm" variant="success" onClick={handleApprove} disabled={pending}>
                承認する
              </Button>
            )}
            {canApprove && closing.status === 'approved' && (
              <Button size="sm" variant="secondary" onClick={() => setReopenOpen(true)} disabled={pending}>
                締め後修正
              </Button>
            )}
            {canReopenStoreDay && (closing.status === 'closed' || closing.status === 'approved') && (
              <Button size="sm" variant="danger" onClick={() => setReopenStoreDayOpen(true)} disabled={pending}>
                店舗日次締めを再オープン
              </Button>
            )}
          </div>
        </Td>
      </Tr>
      {expanded && (
        <Tr className="bg-gray-50">
          <Td colSpan={showStore ? 10 : 9}>
            <div className="py-2">
              <ClosingSnapshot
                data={{
                  salesTotal: closing.salesTotal,
                  refundTotal: closing.refundTotal,
                  netSales: closing.netSales,
                  discountTotal: closing.discountTotal,
                  paymentBreakdown: closing.paymentBreakdown,
                  refundBreakdown: closing.refundBreakdown,
                  pettyInTotal: closing.pettyInTotal,
                  pettyOutTotal: closing.pettyOutTotal,
                  expectedCash: closing.expectedCash,
                  countedCash: closing.countedCash,
                  cashDifference: closing.cashDifference,
                  registerBreakdown: closing.registerBreakdown,
                }}
              />
              {closing.note && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white p-2 text-xs text-gray-600">{closing.note}</p>
              )}
            </div>
          </Td>
        </Tr>
      )}
      <ConfirmDialog
        open={reopenStoreDayOpen}
        onClose={() => setReopenStoreDayOpen(false)}
        title="店舗日次締めを再オープン"
        message="この日の店舗日次締め（daily_closings）を再オープン（reopened）状態に戻します。レジ締めをやり直してから、再度「店舗日次締めを実行」してください。理由は監査ログに記録されます（reopen_store_day）。"
        confirmLabel="再オープンする"
        requireReason
        onConfirm={async (reason) => {
          try {
            await reopenStoreDay(closing.storeId, closing.businessDate, reason);
            toast('店舗日次締めを再オープンしました');
          } catch (err) {
            toast(err instanceof Error ? err.message : '再オープンに失敗しました', 'error');
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        title="締め後修正"
        message="承認済みの締めを修正待ち（reopened）に戻します。理由は監査ログに記録されます。数値の直接編集はできません。"
        confirmLabel="修正する"
        requireReason
        onConfirm={async (reason) => {
          try {
            await reopenClosing(closing.id, reason);
            toast('締め後修正として登録しました');
          } catch (err) {
            toast(err instanceof Error ? err.message : '修正処理に失敗しました', 'error');
            throw err;
          }
        }}
      />
    </>
  );
}
