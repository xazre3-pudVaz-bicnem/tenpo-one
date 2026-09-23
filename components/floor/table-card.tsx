'use client';

import { Clock, Lock, Sparkles, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import {
  TILE_LABEL,
  nextReservation,
  tileState,
  tileTime,
  type TableView,
  type TileState,
  type UpcomingReservation,
} from './types';

/** 状態ごとの面の色・状態テキストの色・残り時間バーの色（プロトタイプの .tbl.s-*） */
const SURFACE: Partial<Record<TileState, string>> = {
  lo: 'bg-[#FFFBEB]',
  over: 'bg-danger-soft',
  pay: 'bg-saffron-soft',
  cleaning: 'bg-lilac-soft',
  unavailable: 'bg-lilac-soft',
};

const LABEL_COLOR: Record<TileState, string> = {
  free: 'text-ink-3',
  reserved: 'text-royal',
  waiting: 'text-royal',
  seated: 'text-royal',
  ordered: 'text-iris',
  lo: 'text-[#8A6100]',
  over: 'text-danger',
  pay: 'text-saffron',
  cleaning: 'text-ink-2',
  unavailable: 'text-ink-3',
};

const BAR_COLOR: Partial<Record<TileState, string>> = {
  lo: 'bg-[#E0AE00]',
  over: 'bg-danger',
  pay: 'bg-saffron',
};

function capacityText(t: TableView) {
  return `${t.capacity_max}名席`;
}

function NextLine({ r, tone }: { r: UpcomingReservation; tone: 'danger' | 'royal' }) {
  return (
    <span
      title={`次の予約 ${r.time} ${r.name} ${r.partySize}名`}
      className={cn(
        'block truncate text-[11px] font-bold leading-snug',
        tone === 'danger' ? 'text-danger' : 'text-royal'
      )}
    >
      次 <span className="tabular-nums">{r.time}</span> {r.name.replace(/ ?様$/, '')}{' '}
      <span className="tabular-nums">{r.partySize}</span>名{' '}
      <span className="font-medium opacity-75">{r.sourceLabel}</span>
    </span>
  );
}

export function TableCard({
  table: t,
  now,
  onSelect,
}: {
  table: TableView;
  now: number;
  onSelect: (t: TableView, el?: HTMLElement | null) => void;
}) {
  const state = tileState(t, now);
  const next = nextReservation(t, now);
  const order = t.order;
  const empty = !order && state !== 'seated' && state !== 'pay';
  const dashed = state === 'free' || state === 'reserved' || state === 'waiting';

  return (
    <button
      type="button"
      onClick={(e) => onSelect(t, e.currentTarget)}
      aria-label={`${t.name} ${TILE_LABEL[state]}`}
      className={cn(
        'relative flex min-h-[170px] min-w-0 flex-col gap-[3px] overflow-hidden rounded-[10px] border border-line bg-white px-3 pt-2.5 text-left transition-[box-shadow,transform] hover:shadow-card active:scale-[0.98]',
        SURFACE[state],
        dashed && 'border-dashed border-wisteria',
        state === 'reserved' && 'border-royal',
        state === 'unavailable' && 'opacity-70'
      )}
    >
      {/* 1行目: テーブル名・人数 */}
      <span className="flex min-w-0 items-center justify-between gap-1.5">
        <b
          className={cn(
            'truncate text-[15px] leading-tight font-extrabold tabular-nums',
            empty ? 'text-ink-3' : 'text-ink'
          )}
        >
          {t.name}
        </b>
        <span className="inline-flex flex-none items-center gap-0.5 text-[11.5px] font-bold whitespace-nowrap text-ink-2 tabular-nums">
          <Users className="h-3 w-3 text-ink-3" strokeWidth={2.2} aria-hidden />
          {order ? `${order.guestCount}名` : capacityText(t)}
        </span>
      </span>

      {order ? (
        <OccupiedBody t={t} now={now} state={state} next={next} />
      ) : (
        <span className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-center">
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-3">
            {state === 'unavailable' && <Lock className="h-3.5 w-3.5" aria-hidden />}
            {state === 'cleaning' && <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            {state === 'seated' || state === 'pay' ? '注文なし / No order' : TILE_LABEL[state]}
          </span>
          {(t.is_private_room || t.is_counter) && (
            <span className="text-[10.5px] text-ink-3">
              {t.is_private_room ? '個室' : 'カウンター'}
            </span>
          )}
        </span>
      )}

      {!order && next && <NextLine r={next} tone="royal" />}

      {/* 下段: 状態・金額 */}
      {order ? (
        <span className="mt-auto flex min-h-[30px] items-center justify-between gap-1.5 border-t border-dashed border-line pt-1.5 pb-1.5">
          <span className={cn('text-[10.5px] font-extrabold tracking-wide whitespace-nowrap', LABEL_COLOR[state])}>
            {TILE_LABEL[state]}
          </span>
          <span className="flex min-w-0 flex-col items-end leading-tight">
            <b className="text-[14px] font-extrabold whitespace-nowrap text-ink tabular-nums">{yen(order.total)}</b>
            <small className="text-[10px] font-semibold whitespace-nowrap text-ink-3 tabular-nums">
              {order.guestCount > 0 ? yen(Math.round(order.total / order.guestCount)) : '—'}/人
            </small>
          </span>
        </span>
      ) : state === 'seated' || state === 'pay' || state === 'cleaning' || state === 'unavailable' ? (
        <span className="mt-auto flex min-h-[26px] items-center border-t border-dashed border-line py-1">
          <span className={cn('text-[10.5px] font-extrabold tracking-wide', LABEL_COLOR[state])}>
            {TILE_LABEL[state]}
          </span>
        </span>
      ) : (
        <span className="mt-auto" />
      )}

      {/* 残り時間の線 */}
      <span className={cn('-mx-3 block h-1.5 flex-none', order ? 'bg-plum/[0.08]' : 'bg-transparent')}>
        {order && (
          <i
            className={cn('block h-full transition-[width] duration-500', BAR_COLOR[state] ?? 'bg-iris')}
            style={{ width: `${Math.round(tileTime(order, now).frac * 100)}%` }}
          />
        )}
      </span>
    </button>
  );
}

function OccupiedBody({
  t,
  now,
  state,
  next,
}: {
  t: TableView;
  now: number;
  state: TileState;
  next: UpcomingReservation | null;
}) {
  const order = t.order!;
  const tt = tileTime(order, now);
  const visits = order.visitCount;
  const isNew = visits != null && visits <= 1;
  const name = order.customerName ?? order.guestName;

  return (
    <>
      <span className="flex items-center justify-between gap-1.5">
        <span className="inline-flex items-center gap-[3px] text-[15px] leading-tight font-extrabold whitespace-nowrap text-royal tabular-nums">
          <Clock className="h-[13px] w-[13px]" strokeWidth={2.2} aria-hidden />
          {tt.elapsed}
          <small className="text-[10.5px] font-semibold text-ink-3">分</small>
        </span>
        {visits != null && visits >= 2 && (
          <i className="flex-none rounded-full bg-iris-soft px-1.5 text-[10px] leading-[1.4] font-extrabold whitespace-nowrap text-royal not-italic tabular-nums">
            {visits}回
          </i>
        )}
        {isNew && (
          <i className="flex-none rounded-full bg-success-soft px-1.5 text-[10px] leading-[1.4] font-extrabold whitespace-nowrap text-success not-italic">
            新規
          </i>
        )}
      </span>

      {order.course && (
        <span className="flex justify-between gap-1.5 text-[10.5px] font-semibold whitespace-nowrap text-ink-3">
          <span>
            {order.course.label} <span className="tabular-nums">{order.course.minutes}</span>分
          </span>
          <b
            className={cn(
              'tabular-nums',
              state === 'over' ? 'text-danger' : state === 'lo' ? 'text-[#8A6100]' : 'text-royal'
            )}
          >
            {tt.left > 0 ? `残 ${tt.left}分` : `超過 ${-tt.left}分`}
          </b>
        </span>
      )}

      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-px text-[11px] leading-snug font-bold text-ink-2">
        <span className="truncate">
          {name ? `${name.replace(/ ?様$/, '')} 様` : isNew ? '新規のお客様' : '顧客 未登録'}
        </span>
        <span className="text-[10.5px] font-medium text-ink-3">{order.sourceLabel}</span>
      </span>

      {next && <NextLine r={next} tone="danger" />}
    </>
  );
}
