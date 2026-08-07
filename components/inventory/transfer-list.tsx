'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Truck, PackageCheck } from 'lucide-react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';
import { shipStockTransfer, receiveStockTransfer, cancelStockTransfer } from '@/app/app/inventory/actions';
import { TRANSFER_STATUS_LABELS, TRANSFER_STATUS_TONES, type TransferStatus } from './labels';

export interface TransferItemRow {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

export interface TransferRow {
  id: string;
  transferNo: number;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  status: TransferStatus;
  note: string | null;
  requestedByName: string | null;
  shippedByName: string | null;
  receivedByName: string | null;
  createdAt: string;
  items: TransferItemRow[];
}

export function TransferList({ rows, currentStoreId }: { rows: TransferRow[]; currentStoreId: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TransferRow | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  if (rows.length === 0) {
    return (
      <EmptyState
        title="店舗間移動の記録がありません"
        description="「移動を申請」から他店舗への在庫移動を申請してください"
      />
    );
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runShip = async (row: TransferRow) => {
    setBusyId(row.id);
    try {
      await shipStockTransfer(row.id);
      toast('発送を登録しました');
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '発送の登録に失敗しました', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const runReceive = async (row: TransferRow) => {
    setBusyId(row.id);
    try {
      await receiveStockTransfer(row.id);
      toast('受取を登録しました');
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '受取の登録に失敗しました', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <Tr>
              <Th />
              <Th>番号</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th>状態</Th>
              <Th className="text-right">品目数</Th>
              <Th>担当</Th>
              <Th>申請日時</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const isOpen = expanded.has(r.id);
              const isFromStore = r.fromStoreId === currentStoreId;
              const isToStore = r.toStoreId === currentStoreId;
              const canShip = isFromStore && r.status === 'requested';
              const canReceive = isToStore && r.status === 'shipped';
              const canCancel = isFromStore && r.status === 'requested';
              return (
                <Fragment key={r.id}>
                  <Tr className="cursor-pointer" onClick={() => toggle(r.id)}>
                    <Td>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      )}
                    </Td>
                    <Td className="font-medium text-navy">#{r.transferNo}</Td>
                    <Td>{r.fromStoreName}</Td>
                    <Td>{r.toStoreName}</Td>
                    <Td>
                      <Badge tone={TRANSFER_STATUS_TONES[r.status]}>{TRANSFER_STATUS_LABELS[r.status]}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{r.items.length}</Td>
                    <Td>{r.requestedByName ?? '—'}</Td>
                    <Td>{formatDateTime(r.createdAt)}</Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        {canShip && (
                          <Button size="sm" onClick={() => void runShip(r)} disabled={busyId === r.id}>
                            <Truck className="h-3.5 w-3.5" />
                            発送
                          </Button>
                        )}
                        {canReceive && (
                          <Button size="sm" variant="success" onClick={() => void runReceive(r)} disabled={busyId === r.id}>
                            <PackageCheck className="h-3.5 w-3.5" />
                            受取
                          </Button>
                        )}
                        {canCancel && (
                          <Button size="sm" variant="danger" onClick={() => setCancelTarget(r)} disabled={busyId === r.id}>
                            取消
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                  {isOpen && (
                    <Tr className="bg-gray-50 hover:bg-gray-50">
                      <Td colSpan={9}>
                        <div className="space-y-2 py-1">
                          <ul className="space-y-1 text-sm">
                            {r.items.map((it) => (
                              <li key={it.id} className="flex items-center justify-between text-navy">
                                <span>{it.name}</span>
                                <span className="tabular-nums text-gray-600">
                                  {it.quantity}
                                  {it.unit}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {r.note && <p className="text-xs text-gray-500">メモ: {r.note}</p>}
                          <p className="text-xs text-gray-400">
                            発送: {r.shippedByName ?? '—'}／受取: {r.receivedByName ?? '—'}
                          </p>
                        </div>
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              );
            })}
          </TBody>
        </Table>
      </TableWrap>

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="移動を取消"
        message={cancelTarget ? `#${cancelTarget.transferNo}（${cancelTarget.fromStoreName} → ${cancelTarget.toStoreName}）を取消します。` : ''}
        requireReason
        confirmLabel="取消する"
        onConfirm={async (reason) => {
          if (!cancelTarget) return;
          await cancelStockTransfer(cancelTarget.id, reason);
          toast('移動を取消しました');
          router.refresh();
        }}
      />
    </>
  );
}
