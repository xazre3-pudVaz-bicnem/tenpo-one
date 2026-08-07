'use client';

import { useRef, useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MergeCandidate {
  id: string;
  orderNo: number;
  tableName: string | null;
  total: number;
  guestCount: number;
}

export function MergeDialog({
  open,
  onClose,
  orderId,
  candidates,
  mergeOrdersAction,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  candidates: MergeCandidate[];
  mergeOrdersAction: (targetOrderId: string, sourceOrderId: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState('');
  const inFlightRef = useRef(false);

  const handleClose = () => {
    setSelectedId('');
    onClose();
  };

  const handleConfirm = () => {
    if (!selectedId || inFlightRef.current) return;
    inFlightRef.current = true;
    startTransition(async () => {
      try {
        await mergeOrdersAction(orderId, selectedId);
        toast('伝票を統合しました', 'success');
        handleClose();
      } catch (e) {
        toast(
          e instanceof Error ? e.message : '処理に失敗しました。通信状態を確認して再度お試しください',
          'error'
        );
      } finally {
        inFlightRef.current = false;
      }
    });
  };

  return (
    <Dialog open={open} onClose={handleClose} title="伝票統合">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          この店舗の他の会計前伝票を、この伝票へ統合します。統合された伝票は無効になり、品目はこの伝票へ移動します。
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-gray-400">統合できる他の伝票がありません</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  disabled={pending}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors',
                    selectedId === c.id ? 'bg-primary-soft/50' : 'hover:bg-gray-50'
                  )}
                >
                  <div>
                    <p className="text-sm font-medium text-navy">
                      {c.tableName ?? 'テイクアウト等'}　#{c.orderNo}
                    </p>
                    <p className="text-xs text-gray-500">{c.guestCount}名</p>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-navy">{yen(c.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedId || pending}>
            {pending ? '処理中…' : '統合する'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
