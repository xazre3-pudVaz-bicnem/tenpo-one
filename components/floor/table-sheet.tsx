'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import type { FloorTable, ReservationChip } from './floor-board';

export function TableSheet({
  table,
  reservation,
  canOperate,
  onClose,
  startWalkInAction,
  goToOrderAction,
  completeCleaningAction,
  setTableAvailabilityAction,
}: {
  table: FloorTable | null;
  reservation: ReservationChip | undefined;
  canOperate: boolean;
  onClose: () => void;
  startWalkInAction: (tableId: string, partySize: number) => Promise<{ orderId: string }>;
  goToOrderAction: (tableId: string) => Promise<{ orderId: string }>;
  completeCleaningAction: (tableId: string) => Promise<void>;
  setTableAvailabilityAction: (tableId: string, unavailable: boolean) => Promise<void>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [partySize, setPartySize] = useState(2);
  const [pending, startTransition] = useTransition();

  if (!table) return null;

  const run = (fn: () => Promise<void>) => {
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        toast(e instanceof Error ? e.message : '操作に失敗しました', 'error');
      }
    });
  };

  const goPos = (fn: () => Promise<{ orderId: string }>) => {
    startTransition(async () => {
      try {
        const { orderId } = await fn();
        router.push(`/app/pos?order=${orderId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : '操作に失敗しました', 'error');
      }
    });
  };

  const status = table.current_status;

  return (
    <Dialog open onClose={onClose} title={table.name}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="gray">
          {table.capacity_min}〜{table.capacity_max}名
          {table.is_private_room && '・個室'}
          {table.is_counter && '・カウンター'}
        </Badge>
      </div>

      {reservation && (
        <div className="mb-4 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-deep">
          本日の予約: {reservation.time}　{reservation.guestName} 様（{reservation.partySize}名）
        </div>
      )}

      <div className="space-y-3">
        {status === 'available' && (
          <div className="rounded-xl border border-gray-200 p-4">
            <Label htmlFor="party-size">人数</Label>
            <div className="flex items-center gap-2">
              <Input
                id="party-size"
                type="number"
                min={1}
                max={99}
                value={partySize}
                onChange={(e) => setPartySize(Math.max(1, Number(e.target.value) || 1))}
                className="w-24"
              />
              <span className="text-sm text-gray-500">名</span>
            </div>
            <Button
              size="pos"
              className="mt-3 w-full"
              disabled={pending}
              onClick={() => goPos(() => startWalkInAction(table.id, partySize))}
            >
              ウォークイン着席
            </Button>
          </div>
        )}

        {(status === 'seated' || status === 'ordering' || status === 'billing') && (
          <Button
            size="pos"
            className="w-full"
            disabled={pending}
            onClick={() => goPos(() => goToOrderAction(table.id))}
          >
            注文画面へ
          </Button>
        )}

        {status === 'cleaning' && (
          <Button
            size="pos"
            variant="navy"
            className="w-full"
            disabled={pending}
            onClick={() => run(() => completeCleaningAction(table.id))}
          >
            清掃完了
          </Button>
        )}

        {canOperate && (status === 'available' || status === 'unavailable') && (
          <Button
            size="lg"
            variant={status === 'unavailable' ? 'secondary' : 'ghost'}
            className="w-full"
            disabled={pending}
            onClick={() =>
              run(() => setTableAvailabilityAction(table.id, status !== 'unavailable'))
            }
          >
            {status === 'unavailable' ? 'テーブルを再開する' : 'このテーブルを利用停止にする'}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
