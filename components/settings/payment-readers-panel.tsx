'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import { Input, FieldError } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';
import { registerSimulatedReader, deleteTerminalReader } from '@/app/app/settings/payments/actions';

export interface TerminalReaderRow {
  id: string;
  label: string;
  deviceType: string | null;
  isSimulated: boolean;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: string | null;
}

const STATUS_LABEL: Record<TerminalReaderRow['status'], string> = {
  online: 'オンライン',
  offline: 'オフライン',
  unknown: '不明',
};

const STATUS_TONE: Record<TerminalReaderRow['status'], BadgeTone> = {
  online: 'success',
  offline: 'gray',
  unknown: 'warning',
};

export function PaymentReadersPanel({
  storeId,
  testMode,
  initial,
}: {
  storeId: string;
  testMode: boolean;
  initial: TerminalReaderRow[];
}) {
  const readers = initial;
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TerminalReaderRow | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleAdd = () => {
    setError(null);
    if (!label.trim()) {
      setError('端末名を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await registerSimulatedReader(storeId, label);
      if (result.error) {
        setError(result.error);
        return;
      }
      setLabel('');
      toast('シミュレーション端末を追加しました');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>決済端末</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {readers.length === 0 ? (
          <p className="text-sm text-gray-500">決済端末が登録されていません</p>
        ) : (
          <ul className="space-y-2">
            {readers.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-navy">{r.label}</span>
                    {r.isSimulated && <Badge tone="gray">シミュレーション端末</Badge>}
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {r.deviceType ?? '種別不明'}｜最終接続: {r.lastSeenAt ? formatDateTime(r.lastSeenAt) : '—'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="削除"
                  onClick={() => setDeleteTarget(r)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="端末名（例: レジ1台目）"
            className="h-9 w-56"
            disabled={!testMode}
          />
          <Button size="sm" onClick={handleAdd} disabled={pending || !testMode}>
            <Plus className="h-4 w-4" />
            シミュレーション端末を追加
          </Button>
        </div>
        {!testMode && (
          <p className="text-xs text-warning">シミュレーション端末はテストモードでのみ登録できます。</p>
        )}
        <FieldError message={error ?? undefined} />
      </CardContent>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="決済端末を削除しますか"
        message={deleteTarget ? `「${deleteTarget.label}」を削除します。この操作は取り消せません。` : ''}
        confirmLabel="削除する"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const result = await deleteTerminalReader(deleteTarget.id, storeId);
          if (result.error) {
            toast(result.error, 'error');
            return;
          }
          toast('決済端末を削除しました');
        }}
      />
    </Card>
  );
}
