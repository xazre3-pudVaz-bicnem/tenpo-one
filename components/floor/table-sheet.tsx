'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { enqueueOrderSlipPrint } from '@/app/app/pos/print-actions';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  anchor,
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
  /** 押したテーブルの画面上の位置。その近くに小さく出す */
  anchor?: { x: number; y: number; w: number; h: number } | null;
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

  /** お会計伝票をその場で印刷する（レジ画面へ移動しない） */
  const handlePrintBill = () => {
    if (!table.order) return;
    startTransition(async () => {
      try {
        const res = await enqueueOrderSlipPrint(table.order!.id);
        toast(res.ok ? 'お会計伝票を印刷します' : (res.error ?? 'お会計伝票の印刷に失敗しました'), res.ok ? 'success' : 'error');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'お会計伝票の印刷に失敗しました', 'error');
      }
    });
  };

  const status = table.current_status;
  const order = table.order;
  const next = nextReservation(table, now);
  const tt = order ? tileTime(order, now) : null;

  // 押したテーブルの近くに小さく出す（画面の端で切れないように寄せる）
  const POP_W = 288;
  const POP_H_EST = order ? 330 : 300;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1194;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 834;
  const a = anchor ?? null;
  const left = a ? Math.min(Math.max(8, a.x + a.w / 2 - POP_W / 2), Math.max(8, vw - POP_W - 8)) : vw / 2 - POP_W / 2;
  const above = a ? a.y > POP_H_EST + 16 : false;
  const top = a
    ? above
      ? Math.max(66, a.y - 10 - POP_H_EST)
      : Math.min(a.y + a.h + 10, Math.max(66, vh - POP_H_EST - 8))
    : 80;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-label={table.name}
        onClick={(e) => e.stopPropagation()}
        style={{ left, top, width: POP_W }}
        className="absolute max-h-[calc(100vh-80px)] overflow-y-auto rounded-2xl border border-line bg-white p-3 shadow-[0_18px_44px_rgba(36,20,54,0.28)]"
      >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xl font-extrabold text-royal">{table.name}</span>
        <Badge tone="primary">{TILE_LABEL[tileState(table, now)]}</Badge>
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          className="ml-auto rounded-lg p-1 text-ink-3 hover:bg-lilac"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {order && tt && (
        <div className="mb-2.5 rounded-xl bg-lilac-soft px-3 py-2">
          <dl className="grid grid-cols-3 gap-1 text-center">
            <div>
              <dt className="text-[10px] text-ink-3">経過</dt>
              <dd className="text-[15px] font-extrabold text-royal tabular-nums">{tt.elapsed}分</dd>
            </div>
            <div>
              <dt className="text-[10px] text-ink-3">残り</dt>
              <dd className={cn('text-[15px] font-extrabold tabular-nums', tt.left > 0 ? 'text-ink' : 'text-danger')}>
                {tt.left > 0 ? `${tt.left}分` : `超過${-tt.left}分`}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-ink-3">お会計</dt>
              <dd className="text-[15px] font-extrabold text-ink tabular-nums">{yen(order.total)}</dd>
            </div>
          </dl>
          <p className="mt-1 truncate text-[11px] text-ink-2">
            {order.guestCount}名
            {(order.customerName ?? order.guestName) && `・${order.customerName ?? order.guestName} 様`}
            {order.clerkName && `・担当 ${order.clerkName}`}
          </p>
        </div>
      )}

      {next && (
        <div className="mb-2.5 rounded-lg bg-iris-soft px-2.5 py-1.5 text-[11px] text-royal">
          次の予約 <span className="tabular-nums">{next.time}</span>　{next.name.replace(/ ?様$/, '')} 様（{next.partySize}名）
        </div>
      )}

      <div className="space-y-3">
        {status === 'available' && (
          <div className="rounded-xl border border-line p-4">
            {/* レジで一番多い操作は「人数だけ入れて着席」。指で押せる大きさにして一番上・一番大きく置く */}
            <p className="mb-1.5 text-[11px] font-bold text-ink-2">人数 / Guests</p>
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
              className="mt-2.5 h-[52px] w-full flex-col gap-0 text-[16px] leading-tight"
              disabled={pending}
              onClick={() =>
                goPos(() =>
                  startWalkInAction(table.id, partySize, {
                    durationMinutes: defaultStayMinutes,
                  })
                )
              }
            >
              着席して注文へ
              <span className="text-[10px] font-semibold opacity-80">Seat & order</span>
            </Button>
            {/* ファーストオーダー: ハンディと同じ「お客様情報」（モード・プラン・時間制・開始時間・男女の人数）を出してから着席する */}
            <Button
              size="md"
              variant="secondary"
              className="mt-2 h-[46px] w-full flex-col gap-0 text-[14px] leading-tight"
              disabled={pending}
              onClick={() => router.push(`/app/floor/${table.id}/setup`)}
            >
              お客様情報を入力して着席
              <span className="text-[10px] font-semibold text-ink-3">Guest info</span>
            </Button>
          </div>
        )}

        {/* お客様が入っている卓は、ここから4つの操作を選ぶ（2026-09-24 要望） */}
        {(status === 'seated' || status === 'ordering' || status === 'billing') && (
          <div className="space-y-2">
            <Button
              size="md"
              className="h-[52px] w-full flex-col gap-0 text-[16px] leading-tight"
              disabled={pending}
              onClick={() => goPos(() => goToOrderAction(table.id))}
            >
              追加オーダー
              <span className="text-[10px] font-semibold opacity-80">Add order</span>
            </Button>
            <Button
              size="md"
              variant="secondary"
              className="h-[46px] w-full flex-col gap-0 text-[15px] leading-tight"
              disabled={pending || !table.order}
              onClick={() => table.order && router.push(`/app/pos?order=${table.order.id}&move=1`)}
            >
              テーブル移動
              <span className="text-[10px] font-semibold text-ink-3">Move table</span>
            </Button>
            <Button
              size="md"
              variant="secondary"
              className="h-[46px] w-full flex-col gap-0 text-[15px] leading-tight"
              disabled={pending || !table.order}
              onClick={handlePrintBill}
            >
              会計伝票
              <span className="text-[10px] font-semibold text-ink-3">Print bill</span>
            </Button>
            <Button
              size="md"
              variant="navy"
              className="h-[52px] w-full flex-col gap-0 text-[16px] leading-tight"
              disabled={pending || !table.order}
              onClick={() => table.order && router.push(`/app/pos?order=${table.order.id}&checkout=1`)}
            >
              会計
              <span className="text-[10px] font-semibold opacity-80">Checkout</span>
            </Button>
          </div>
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
            <span className="text-[10px] font-semibold opacity-80">Cleaned</span>
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
      </div>
    </div>
  );
}
