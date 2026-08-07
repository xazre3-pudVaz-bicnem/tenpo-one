'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { guideWaitingTicket } from '@/app/app/reservations/actions';

export interface GuideTableOption {
  id: string;
  name: string;
  capacityMax: number;
}

/**
 * ウェイティングの「案内」ダイアログ。テーブルを選ぶと guideWaitingTicket を呼び、
 * 予約(walk_in/seated)+注文の作成後、POSへ自動遷移する（アクション側でredirect）。
 */
export function GuideTableDialog({
  entryId,
  guestName,
  partySize,
  tables,
  disabled,
}: {
  entryId: string;
  guestName: string;
  partySize: number;
  tables: GuideTableOption[];
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [tableId, setTableId] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!tableId) return;
    startTransition(async () => {
      try {
        await guideWaitingTicket(entryId, tableId);
      } catch (e) {
        toast(e instanceof Error ? e.message : '案内に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button
        size="sm"
        variant="success"
        disabled={disabled}
        className="h-7 px-2 text-xs"
        onClick={() => {
          setTableId('');
          setOpen(true);
        }}
      >
        <ArrowRight className="h-3.5 w-3.5" />
        案内
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="テーブルへ案内">
        <p className="mb-3 text-sm text-gray-600">
          {guestName} 様（{partySize}名）を案内するテーブルを選んでください。
        </p>
        <div>
          <Label htmlFor="guide-table">テーブル</Label>
          <Select id="guide-table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">選択してください</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}（最大{t.capacityMax}名）
              </option>
            ))}
          </Select>
          {tables.length === 0 && <p className="mt-2 text-xs text-danger">現在空席のテーブルがありません</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !tableId}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            案内してPOSへ
          </Button>
        </div>
      </Dialog>
    </>
  );
}
