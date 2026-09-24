'use client';

import { useLayoutEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { enqueueOrderSlipPrint } from '@/app/app/pos/print-actions';
import { Lock, LockOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { yen, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TILE_LABEL, nextReservation, tileState, type TableView } from './types';

/** 着席（ファーストオーダー）のときに決めるコース・時間 */
export interface WalkInSeatOptions {
  durationMinutes?: number;
  courseId?: string;
}

/** ポップアップの幅（レジのテーブル一覧で使う小さいカード） */
const POP_W = 244;

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
  const popRef = useRef<HTMLDivElement>(null);

  // 押したテーブルの「上」に出す。上に入らないときだけ、テーブルに重ねて下へ伸ばす。
  // 高さは中身で変わるので、描画後に実寸を測って位置をあてる（state は使わない＝再描画しない）
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el || !anchor) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(8, anchor.x + anchor.w / 2 - POP_W / 2), Math.max(8, vw - POP_W - 8));
    const above = anchor.y - h - 8;
    const top = above >= 64 ? above : Math.min(Math.max(64, anchor.y), Math.max(64, vh - h - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
  });
  const { toast } = useToast();
  const [partySize, setPartySize] = useState(2);
  const [slipId, setSlipId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!table) return null;

  /**
   * この卓の未会計伝票（古い順）。伝票分割・相席・締め忘れで2枚以上あることがある。
   * 以前は一番新しい伝票しか開けず、古い伝票が会計できないまま卓に残ってしまった（2026-09-24 高田馬場 T12）。
   * ここで全部出して、どれを会計・追加オーダーするか選べるようにする。
   */
  const slips = table.order?.slips ?? [];
  const selected = slips.find((s) => s.id === slipId) ?? slips[0] ?? null;

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
    if (!selected) return;
    startTransition(async () => {
      try {
        const res = await enqueueOrderSlipPrint(selected.id);
        toast(res.ok ? 'お会計伝票を印刷します' : (res.error ?? 'お会計伝票の印刷に失敗しました'), res.ok ? 'success' : 'error');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'お会計伝票の印刷に失敗しました', 'error');
      }
    });
  };

  const status = table.current_status;
  const next = nextReservation(table, now);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} role="presentation">
      <div
        ref={popRef}
        role="dialog"
        aria-label={table.name}
        onClick={(e) => e.stopPropagation()}
        style={{ width: POP_W, visibility: 'hidden' }}
        className="absolute max-h-[calc(100vh-72px)] overflow-y-auto rounded-2xl border border-line bg-white p-2.5 shadow-[0_18px_44px_rgba(36,20,54,0.28)]"
      >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg font-extrabold text-royal">{table.name}</span>
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

      {next && (
        <div className="mb-2.5 rounded-lg bg-iris-soft px-2.5 py-1.5 text-[11px] text-royal">
          次の予約 <span className="tabular-nums">{next.time}</span>　{next.name.replace(/ ?様$/, '')} 様（{next.partySize}名）
        </div>
      )}

      <div className="space-y-3">
        {status === 'available' && (
          <div className="rounded-xl border border-line p-2.5">
            {/* レジで一番多い操作は「人数だけ入れて着席」。指で押せる大きさにして一番上・一番大きく置く */}
            <p className="mb-1.5 text-[11px] font-bold text-ink-2">人数 / Guests</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="人数を1人減らす"
                disabled={pending || partySize <= 1}
                onClick={() => setPartySize((n) => Math.max(1, n - 1))}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-lilac-soft text-xl font-bold text-royal disabled:opacity-40"
              >
                −
              </button>
              <div className="flex h-12 flex-1 items-baseline justify-center gap-1 rounded-xl border border-line">
                <span className="text-2xl font-extrabold tabular-nums text-navy">{partySize}</span>
                <span className="text-sm text-ink-3">名</span>
              </div>
              <button
                type="button"
                aria-label="人数を1人増やす"
                disabled={pending || partySize >= 99}
                onClick={() => setPartySize((n) => Math.min(99, n + 1))}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-lilac-soft text-xl font-bold text-royal disabled:opacity-40"
              >
                ＋
              </button>
            </div>
            <Button
              size="pos"
              className="mt-2 h-[44px] w-full flex-col gap-0 text-[15px] leading-tight"
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
              className="mt-1.5 h-[40px] w-full flex-col gap-0 text-[13px] leading-tight"
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
          <div className="space-y-1.5">
            {/* 伝票が2枚以上ある卓は、どの伝票を操作するか先に選ぶ（2026-09-24 店舗要望） */}
            {slips.length > 1 && (
              <div className="rounded-xl border border-line p-1.5">
                <p className="mb-1 px-0.5 text-[11px] font-bold text-ink-2">伝票を選ぶ / Slip</p>
                <div className="space-y-1">
                  {slips.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSlipId(s.id)}
                      className={cn(
                        'flex w-full items-baseline justify-between gap-1 rounded-lg border px-2 py-1.5 text-left',
                        selected?.id === s.id
                          ? 'border-royal bg-lilac-soft'
                          : 'border-line bg-white'
                      )}
                    >
                      <span className="text-[12px] font-bold text-royal tabular-nums">
                        #{s.orderNo}
                      </span>
                      <span className="text-[10px] text-ink-3 tabular-nums">
                        {formatTime(new Date(s.openedAtMs))} · {s.guestCount}名
                      </span>
                      <span className="text-[12px] font-bold text-navy tabular-nums">
                        {yen(s.total)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Button
              size="md"
              className="h-[44px] w-full flex-col gap-0 text-[15px] leading-tight"
              disabled={pending}
              onClick={() =>
                selected
                  ? router.push(`/app/pos?order=${selected.id}`)
                  : goPos(() => goToOrderAction(table.id))
              }
            >
              追加オーダー
              <span className="text-[10px] font-semibold opacity-80">Add order</span>
            </Button>
            <Button
              size="md"
              variant="secondary"
              className="h-[40px] w-full flex-col gap-0 text-[14px] leading-tight"
              disabled={pending || !selected}
              onClick={() => selected && router.push(`/app/pos?order=${selected.id}&move=1`)}
            >
              テーブル移動
              <span className="text-[10px] font-semibold text-ink-3">Move table</span>
            </Button>
            <Button
              size="md"
              variant="secondary"
              className="h-[40px] w-full flex-col gap-0 text-[14px] leading-tight"
              disabled={pending || !selected}
              onClick={handlePrintBill}
            >
              会計伝票
              <span className="text-[10px] font-semibold text-ink-3">Print bill</span>
            </Button>
            <Button
              size="md"
              variant="navy"
              className="h-[44px] w-full flex-col gap-0 text-[15px] leading-tight"
              disabled={pending || !selected}
              onClick={() => selected && router.push(`/app/pos?order=${selected.id}&checkout=1`)}
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

        {/* 卓ロック：空いている卓だけ。お客様が入っている卓はロックできない（2026-09-24 店舗要望） */}
        {canOperate && (status === 'available' || status === 'unavailable') && (
          <Button
            size="md"
            variant="secondary"
            className="h-[40px] w-full flex-col gap-0 text-[14px] leading-tight"
            disabled={pending}
            onClick={() => run(() => setTableAvailabilityAction(table.id, status !== 'unavailable'))}
          >
            <span className="flex items-center gap-1.5">
              {status === 'unavailable' ? <LockOpen className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
              {status === 'unavailable' ? 'ロック解除' : 'テーブルをロック'}
            </span>
            <span className="text-[10px] font-semibold text-ink-3">{status === 'unavailable' ? 'Unlock' : 'Lock table'}</span>
          </Button>
        )}
      </div>
      </div>
    </div>
  );
}
