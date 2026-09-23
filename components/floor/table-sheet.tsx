'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { TILE_LABEL, nextReservation, tileState, tileTime, type TableView } from './types';

/** 着席（ファーストオーダー）のときに決めるコース・時間 */
export interface WalkInSeatOptions {
  durationMinutes?: number;
  courseId?: string;
}

export function TableSheet({
  table,
  now,
  canOperate,
  onClose,
  startWalkInAction,
  defaultStayMinutes = 120,
  goToOrderAction,
  completeCleaningAction,
  setTableAvailabilityAction,
}: {
  table: TableView | null;
  now: number;
  canOperate: boolean;
  onClose: () => void;
  startWalkInAction: (tableId: string, partySize: number, options?: WalkInSeatOptions) => Promise<{ orderId: string }>;
  defaultStayMinutes?: number;
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
  const order = table.order;
  const next = nextReservation(table, now);
  const tt = order ? tileTime(order, now) : null;

  return (
    // レジでは左のフロアを見たまま操作できるよう、右側から出す（2026-09-23 要望）
    <Dialog open onClose={onClose} title={table.name} side="right">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="primary">{TILE_LABEL[tileState(table, now)]}</Badge>
        <Badge tone="gray">
          {table.capacity_min}〜{table.capacity_max}名
          {table.is_private_room && '・個室'}
          {table.is_counter && '・カウンター'}
        </Badge>
      </div>

      {order && tt && (
        <div className="mb-4 rounded-xl bg-lilac-soft p-3">
          <dl className="grid grid-cols-3 gap-2 text-center">
          <div>
            <dt className="text-[11px] text-ink-3">経過</dt>
            <dd className="text-lg font-extrabold text-royal tabular-nums">{tt.elapsed}分</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-3">残り</dt>
            <dd className={tt.left > 0 ? 'text-lg font-extrabold text-ink tabular-nums' : 'text-lg font-extrabold text-danger tabular-nums'}>
              {tt.left > 0 ? `${tt.left}分` : `超過${-tt.left}分`}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-3">お会計</dt>
            <dd className="text-lg font-extrabold text-ink tabular-nums">{yen(order.total)}</dd>
          </div>
          </dl>
          <p className="mt-2 text-xs text-ink-2">
            {order.guestCount}名
            {(order.customerName ?? order.guestName) && `・${order.customerName ?? order.guestName} 様`}
            {`・${order.sourceLabel}`}
            {order.course && `・${order.course.label}${order.course.minutes}分`}
            {order.clerkName && `・担当 ${order.clerkName}`}
          </p>
        </div>
      )}

      {next && (
        <div className="mb-4 rounded-lg bg-iris-soft px-3 py-2 text-sm text-royal">
          次の予約: <span className="tabular-nums">{next.time}</span>　{next.name.replace(/ ?様$/, '')} 様（{next.partySize}名・{next.sourceLabel}）
        </div>
      )}

      <div className="space-y-3">
        {status === 'available' && (
          <div className="rounded-xl border border-line p-4">
            {/* レジで一番多い操作は「人数だけ入れて着席」。指で押せる大きさにして一番上・一番大きく置く */}
            <p className="mb-2 text-xs font-bold text-ink-2">人数 / Guests</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="人数を1人減らす"
                disabled={pending || partySize <= 1}
                onClick={() => setPartySize((n) => Math.max(1, n - 1))}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line bg-lilac-soft text-2xl font-bold text-royal disabled:opacity-40"
              >
                −
              </button>
              <div className="flex h-14 flex-1 items-baseline justify-center gap-1 rounded-xl border border-line">
                <span className="text-3xl font-extrabold tabular-nums text-navy">{partySize}</span>
                <span className="text-sm text-ink-3">名</span>
              </div>
              <button
                type="button"
                aria-label="人数を1人増やす"
                disabled={pending || partySize >= 99}
                onClick={() => setPartySize((n) => Math.min(99, n + 1))}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line bg-lilac-soft text-2xl font-bold text-royal disabled:opacity-40"
              >
                ＋
              </button>
            </div>
            <Button
              size="pos"
              className="mt-3 h-[60px] w-full text-[18px]"
              disabled={pending}
              onClick={() =>
                goPos(() =>
                  startWalkInAction(table.id, partySize, {
                    durationMinutes: defaultStayMinutes,
                  })
                )
              }
            >
              着席して注文へ / Seat
            </Button>
            {/* ファーストオーダー: ハンディと同じ「お客様情報」（モード・プラン・時間制・開始時間・男女の人数）を出してから着席する */}
            <Button
              size="md"
              variant="secondary"
              className="mt-2 w-full"
              disabled={pending}
              onClick={() => router.push(`/app/floor/${table.id}/setup`)}
            >
              お客様情報を入力して着席
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
            {status === 'billing' ? '注文・会計画面へ / Order & Pay' : '注文画面へ / Order'}
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
            清掃完了 / Cleaned
          </Button>
        )}

        {/* 利用停止はめったに使わないので、間違って押さないよう小さく下に置く */}
        {canOperate && (status === 'available' || status === 'unavailable') && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setTableAvailabilityAction(table.id, status !== 'unavailable'))}
            className="mx-auto block rounded-lg px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-lilac hover:text-royal disabled:opacity-40"
          >
            {status === 'unavailable' ? 'テーブルを再開する' : 'このテーブルを利用停止にする'}
          </button>
        )}
      </div>
    </Dialog>
  );
}
