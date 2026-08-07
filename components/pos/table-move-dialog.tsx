'use client';

import { useRef, useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export interface AvailableTable {
  id: string;
  name: string;
  capacityMax: number;
}

export function TableMoveDialog({
  open,
  onClose,
  orderId,
  currentTableName,
  availableTables,
  moveTableAction,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  currentTableName: string | null;
  availableTables: AvailableTable[];
  moveTableAction: (orderId: string, newTableId: string) => Promise<{ tableName: string }>;
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
        const { tableName } = await moveTableAction(orderId, selectedId);
        toast(`「${tableName}」へ移動しました`, 'success');
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
    <Dialog open={open} onClose={handleClose} title="テーブル移動">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          現在のテーブル: {currentTableName ?? '—'}。移動先の空きテーブルを選択してください。
        </p>
        {availableTables.length === 0 ? (
          <p className="text-sm text-gray-400">空いているテーブルがありません</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {availableTables.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                disabled={pending}
                className={cn(
                  'rounded-xl border px-3 py-3 text-sm font-semibold transition-colors disabled:opacity-50',
                  selectedId === t.id
                    ? 'border-primary bg-primary-soft text-primary-deep'
                    : 'border-gray-200 text-navy hover:bg-gray-50'
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedId || pending}>
            {pending ? '処理中…' : '移動する'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
