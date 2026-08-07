'use client';

import { useEffect, useState, useTransition } from 'react';
import { Bell, Sparkles } from 'lucide-react';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { callWaitingTicket, markWaitingNoShow, cancelWaitlistEntry } from '@/app/app/reservations/actions';
import { GuideTableDialog, type GuideTableOption } from './guide-table-dialog';

export type WaitingTicketStatus = 'waiting' | 'called' | 'seated' | 'no_show' | 'cancelled';

export interface WaitingTicketRow {
  id: string;
  storeId: string;
  storeName: string | null;
  ticketNo: number;
  guestName: string;
  guestPhone: string;
  partySize: number;
  seatPreference: string | null;
  status: WaitingTicketStatus;
  createdAt: string;
}

export interface WaitingHint {
  ticketNo: number;
  guestName: string;
  partySize: number;
  label: string;
}

const STATUS_LABEL: Record<WaitingTicketStatus, string> = {
  waiting: '待機中',
  called: '呼出中',
  seated: '案内済み',
  no_show: '不在',
  cancelled: '取消',
};
const STATUS_TONE: Record<WaitingTicketStatus, BadgeTone> = {
  waiting: 'gray',
  called: 'warning',
  seated: 'success',
  no_show: 'danger',
  cancelled: 'gray',
};

function elapsedMinutesFrom(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
}

function useElapsedMinutes(createdAt: string): number {
  const [minutes, setMinutes] = useState(() => elapsedMinutesFrom(createdAt));
  useEffect(() => {
    const timer = setInterval(() => setMinutes(elapsedMinutesFrom(createdAt)), 30000);
    return () => clearInterval(timer);
  }, [createdAt]);
  return minutes;
}

function ElapsedCell({ createdAt }: { createdAt: string }) {
  const minutes = useElapsedMinutes(createdAt);
  return <span className="tabular-nums">{minutes}分</span>;
}

/** 本日の店頭ウェイティング一覧・受付番号・経過時間・呼出/案内/不在/取消の操作パネル */
export function WaitingQueuePanel({
  entries,
  tablesByStore,
  hints,
  showStore,
}: {
  entries: WaitingTicketRow[];
  tablesByStore: Record<string, GuideTableOption[]>;
  hints: WaitingHint[];
  showStore: boolean;
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

  return (
    <div className="space-y-4">
      {hints.length > 0 && (
        <Card className="border-success/40 bg-success-soft p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-success">
            <Sparkles className="h-4 w-4" />
            案内可能な組み合わせ
          </p>
          <div className="flex flex-wrap gap-2">
            {hints.map((h) => (
              <span key={h.ticketNo} className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-navy shadow-sm">
                #{h.ticketNo} {h.guestName} 様　{h.partySize}名様 → {h.label}
              </span>
            ))}
          </div>
        </Card>
      )}

      {entries.length === 0 ? (
        <EmptyState title="本日のウェイティングはありません" description="「受付」から店頭の待ちを登録できます。" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>受付番号</Th>
                <Th>お名前</Th>
                <Th className="text-right">人数</Th>
                <Th>経過</Th>
                {showStore && <Th>店舗</Th>}
                <Th>希望席</Th>
                <Th>状態</Th>
                <Th>操作</Th>
              </Tr>
            </THead>
            <TBody>
              {entries.map((w) => {
                const active = w.status === 'waiting' || w.status === 'called';
                return (
                  <Tr key={w.id} className={cn(w.status === 'called' && 'bg-warning-soft')}>
                    <Td className="text-base font-bold tabular-nums text-primary-deep">#{w.ticketNo}</Td>
                    <Td className="font-medium text-navy">
                      {w.guestName} 様
                      {w.guestPhone && <div className="text-xs text-gray-400">{w.guestPhone}</div>}
                    </Td>
                    <Td className="text-right tabular-nums">{w.partySize}名</Td>
                    <Td>{active ? <ElapsedCell createdAt={w.createdAt} /> : '—'}</Td>
                    {showStore && <Td>{w.storeName ?? '—'}</Td>}
                    <Td>{w.seatPreference ?? '—'}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[w.status]}>
                        {w.status === 'called' && <Bell className="mr-1 inline h-3 w-3" />}
                        {STATUS_LABEL[w.status]}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {w.status === 'waiting' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pending}
                            className="h-7 px-2 text-xs"
                            onClick={() => run(() => callWaitingTicket(w.id), '呼び出しました')}
                          >
                            <Bell className="h-3.5 w-3.5" />
                            呼出
                          </Button>
                        )}
                        {active && (
                          <GuideTableDialog
                            entryId={w.id}
                            guestName={w.guestName}
                            partySize={w.partySize}
                            tables={tablesByStore[w.storeId] ?? []}
                            disabled={pending}
                          />
                        )}
                        {active && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pending}
                            className="h-7 px-2 text-xs"
                            onClick={() => run(() => markWaitingNoShow(w.id), '不在にしました')}
                          >
                            不在
                          </Button>
                        )}
                        {active && (
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
      )}
    </div>
  );
}
