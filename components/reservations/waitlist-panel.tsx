'use client';

import { useTransition } from 'react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/format';
import { markWaitlistContacted, markWaitlistExpired, cancelWaitlistEntry } from '@/app/app/reservations/actions';
import { ManualReservationDialog } from './manual-reservation-dialog';
import type { StoreRef } from '@/lib/auth';

export type WaitlistStatus = 'waiting' | 'contacted' | 'converted' | 'expired' | 'cancelled';

export interface WaitlistRow {
  id: string;
  storeId: string;
  storeName: string | null;
  guestName: string;
  guestPhone: string;
  partySize: number;
  desiredDate: string;
  desiredTimeFrom: string | null;
  desiredTimeTo: string | null;
  note: string | null;
  status: WaitlistStatus;
}

const STATUS_LABEL: Record<WaitlistStatus, string> = {
  waiting: '連絡待ち',
  contacted: '連絡済み',
  converted: '予約済み',
  expired: '期限切れ',
  cancelled: '取消',
};
const STATUS_TONE: Record<WaitlistStatus, BadgeTone> = {
  waiting: 'warning',
  contacted: 'primary',
  converted: 'success',
  expired: 'gray',
  cancelled: 'gray',
};

function timeRange(from: string | null, to: string | null): string {
  if (!from && !to) return '指定なし';
  return `${from?.slice(0, 5) ?? ''}〜${to?.slice(0, 5) ?? ''}`;
}

/** キャンセル待ち一覧・操作パネル。「予約へ変換」は手動予約ダイアログへ内容を引き継ぎ、作成成功で converted になる。 */
export function WaitlistPanel({
  entries,
  showStore,
  allStores,
}: {
  entries: WaitlistRow[];
  showStore: boolean;
  allStores: StoreRef[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<void>, successMessage: string) => {
    startTransition(async () => {
      try {
        await fn();
        toast(successMessage);
      } catch (e) {
        toast(e instanceof Error ? e.message : '処理に失敗しました', 'error');
      }
    });
  };

  if (entries.length === 0) {
    return <EmptyState title="キャンセル待ちはありません" description="満席の日時に登録すると、ここに一覧表示されます。" />;
  }

  return (
    <TableWrap>
      <Table>
        <THead>
          <Tr>
            <Th>希望日</Th>
            <Th>希望時間</Th>
            <Th>お名前</Th>
            <Th className="text-right">人数</Th>
            {showStore && <Th>店舗</Th>}
            <Th>メモ</Th>
            <Th>状態</Th>
            <Th>操作</Th>
          </Tr>
        </THead>
        <TBody>
          {entries.map((w) => {
            const store = allStores.find((s) => s.id === w.storeId);
            const actionable = w.status === 'waiting' || w.status === 'contacted';
            return (
              <Tr key={w.id}>
                <Td>{formatDate(w.desiredDate)}</Td>
                <Td>{timeRange(w.desiredTimeFrom, w.desiredTimeTo)}</Td>
                <Td className="font-medium text-navy">
                  {w.guestName} 様
                  <div className="text-xs text-gray-400">{w.guestPhone}</div>
                </Td>
                <Td className="text-right tabular-nums">{w.partySize}名</Td>
                {showStore && <Td>{w.storeName ?? '—'}</Td>}
                <Td className="max-w-[16rem] truncate">{w.note ?? '—'}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[w.status]}>{STATUS_LABEL[w.status]}</Badge>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {w.status === 'waiting' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        className="h-7 px-2 text-xs"
                        onClick={() => run(() => markWaitlistContacted(w.id), '連絡済みにしました')}
                      >
                        連絡済みにする
                      </Button>
                    )}
                    {actionable && store && (
                      <ManualReservationDialog
                        stores={[store]}
                        defaultStoreId={store.id}
                        waitlistEntryId={w.id}
                        triggerLabel="予約へ変換"
                        triggerVariant="primary"
                        triggerSize="sm"
                        prefill={{
                          storeId: w.storeId,
                          date: w.desiredDate,
                          time: w.desiredTimeFrom ? w.desiredTimeFrom.slice(0, 5) : '18:00',
                          adults: w.partySize,
                          children: 0,
                          name: w.guestName,
                          phone: w.guestPhone,
                          note: w.note ?? '',
                        }}
                      />
                    )}
                    {actionable && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        className="h-7 px-2 text-xs"
                        onClick={() => run(() => markWaitlistExpired(w.id), '期限切れにしました')}
                      >
                        期限切れ
                      </Button>
                    )}
                    {actionable && (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={pending}
                        className="h-7 px-2 text-xs"
                        onClick={() => run(() => cancelWaitlistEntry(w.id), '取消しました')}
                      >
                        取消
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </TableWrap>
  );
}
