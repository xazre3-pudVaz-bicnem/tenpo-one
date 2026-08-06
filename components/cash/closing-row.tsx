'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Tr, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { yen, formatDate } from '@/lib/format';
import { approveClosing, reopenClosing } from '@/app/app/cash/actions';
import { CLOSING_STATUS_LABELS, CLOSING_STATUS_TONES, METHOD_LABELS, type ClosingStatus } from '@/components/cash/labels';

export interface ClosingRowData {
  id: string;
  businessDate: string;
  storeName?: string;
  salesTotal: number;
  ordersCount: number;
  guestsCount: number;
  discountTotal: number;
  refundTotal: number;
  cashDifference: number;
  status: ClosingStatus;
  paymentBreakdown: Record<string, number>;
  note: string | null;
}

export function ClosingRow({ closing, showStore, canApprove }: { closing: ClosingRowData; showStore: boolean; canApprove: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const { toast } = useToast();

  const breakdownEntries = Object.entries(closing.paymentBreakdown).filter(([, v]) => v);

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
        </Td>
      </Tr>
      {expanded && (
        <Tr className="bg-gray-50">
          <Td colSpan={showStore ? 9 : 8}>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-gray-500">支払方法内訳</p>
                {breakdownEntries.length === 0 ? (
                  <p className="mt-1 text-sm text-gray-400">データがありません</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {breakdownEntries.map(([method, amt]) => (
                      <li key={method} className="flex justify-between">
                        <span className="text-gray-600">{METHOD_LABELS[method] ?? method}</span>
                        <span className="tabular-nums font-medium text-navy">{yen(amt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="text-sm">
                <p className="flex justify-between py-0.5">
                  <span className="text-gray-600">値引き合計</span>
                  <span className="tabular-nums">{yen(closing.discountTotal)}</span>
                </p>
                <p className="flex justify-between py-0.5">
                  <span className="text-gray-600">返金合計</span>
                  <span className="tabular-nums">{yen(closing.refundTotal)}</span>
                </p>
                {closing.note && (
                  <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-2 text-xs text-gray-600">{closing.note}</p>
                )}
              </div>
            </div>
          </Td>
        </Tr>
      )}
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
