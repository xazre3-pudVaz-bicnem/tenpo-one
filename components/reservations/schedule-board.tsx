'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { createOrderFromReservation } from '@/app/app/reservations/actions';
import type { ReservationStatus } from '@/lib/reservations';
import { cn } from '@/lib/utils';
import { ReservationDetailDialog } from './reservation-detail-dialog';
import type { AssignableTable } from './assign-table-dialog';
import type { ReservationListRow } from './list-types';
import { jstMinutesOfMs, useNow } from './use-now';
import { BOARD_SLOT } from './constants';

export { BOARD_SLOT } from './constants';
/**
 * 30分のマスの幅。
 * 店舗要望（2026-09-24）「画面いっぱいで6時間ぐらい見えるように」。
 * iPad 横（1366px）で テーブル列128px を引いた約1240px に 12マス（＝6時間）入る幅にする。
 */
const SLOT_W = 100;
const LABEL_W = 128;
const HEAD_H = 40;
/**
 * 1行の高さ。画面に10卓ぶんが入る大きさにする（店舗要望 2026-09-24）。
 * 44px だと12卓入って細かすぎたので、少し戻して10卓ちょうどにした。
 */
const ROW_H = 53;

export interface BoardTable extends AssignableTable {
  /** 例: 「着席中 2名・高橋 様」「空席」。当日以外は空文字 */
  statusLabel: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function hm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function jstMinutes(iso: string): number {
  return jstMinutesOfMs(new Date(iso).getTime());
}

function jstDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

type BarKind = 'tentative' | 'wait' | 'arrived' | 'in' | 'pay' | 'out' | 'unset';

function barKind(status: ReservationStatus, unassigned: boolean): BarKind {
  if (unassigned && status !== 'completed') return 'unset';
  switch (status) {
    case 'pending':
    case 'waitlisted':
      return 'tentative';
    case 'arrived':
      return 'arrived';
    case 'seated':
      return 'in';
    case 'billing':
      return 'pay';
    case 'completed':
      return 'out';
    default:
      return 'wait';
  }
}

const BAR_CLASS: Record<BarKind, string> = {
  tentative: 'border-dashed border-ink-3 bg-white text-ink-2',
  wait: 'border-iris bg-white text-royal',
  arrived: 'border-iris bg-iris-soft text-royal',
  in: 'border-iris bg-iris text-white',
  pay: 'border-iris bg-iris text-white',
  out: 'border-transparent bg-[#DDD8E6] text-ink-2',
  unset: 'border-danger bg-white text-danger',
};

const SOURCE_SHORT: Record<string, string> = { web: 'WEB', phone: 'TEL', walk_in: '来店', manual: '手動' };

function sourceBadge(r: ReservationListRow): string | null {
  if (r.createdVia === 'phone' || r.createdVia === 'walk_in' || r.createdVia === 'manual') return SOURCE_SHORT[r.createdVia];
  if (r.sourceName) return r.sourceName.length <= 4 ? r.sourceName : r.sourceName.slice(0, 3);
  return SOURCE_SHORT[r.createdVia] ?? null;
}

interface Placed {
  r: ReservationListRow;
  s: number;
  e: number;
}

function place(list: ReservationListRow[], viewStart: number, viewEnd: number): Placed[] {
  const out: Placed[] = [];
  for (const r of list) {
    let s = jstMinutes(r.startAt);
    let e = jstMinutes(r.endAt);
    // 深夜営業（日付をまたぐ）: 開始が表示範囲より前で、翌日扱いなら範囲に入る場合は +24h
    if (s < viewStart && s + 1440 < viewEnd) s += 1440;
    while (e <= s) e += 1440;
    if (e <= viewStart || s >= viewEnd) continue;
    out.push({ r, s, e });
  }
  return out.sort((a, b) => a.s - b.s);
}

/**
 * 店舗台帳のスケジュール（テーブル × 時間のタイムライン）。
 * バーをタップすると予約詳細（状態変更・テーブル割当・日時変更・メモ）を開く。
 */
export function ScheduleBoard({
  reservations,
  tables,
  viewStartMin,
  viewEndMin,
  openMin,
  closeMin,
  isClosedDay,
  bufferMinutes,
  staffOptions,
  canManagePrivateHire,
  isToday,
  nowMs,
  updatedAt,
}: {
  reservations: ReservationListRow[];
  tables: BoardTable[];
  viewStartMin: number;
  viewEndMin: number;
  openMin: number;
  closeMin: number;
  isClosedDay: boolean;
  bufferMinutes: number;
  staffOptions: { id: string; name: string }[];
  canManagePrivateHire: boolean;
  isToday: boolean;
  nowMs: number;
  updatedAt: string;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<ReservationListRow | null>(null);
  const [payPending, startPay] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  const now = useNow(nowMs);
  let nowMin = jstMinutesOfMs(now);
  if (nowMin < viewStartMin && nowMin + 1440 <= viewEndMin) nowMin += 1440;
  const showNow = isToday && nowMin >= viewStartMin && nowMin <= viewEndMin;
  const nowX = ((nowMin - viewStartMin) / BOARD_SLOT) * SLOT_W;

  // 万一おかしな値が来ても表が崩れないようにする（NaN だと grid が1列に潰れる）
  const rawCols = Math.round((viewEndMin - viewStartMin) / BOARD_SLOT);
  const cols = Number.isFinite(rawCols) && rawCols > 0 ? rawCols : 24;
  const gridWidth = cols * SLOT_W;
  const x = (min: number) => ((Math.min(Math.max(min, viewStartMin), viewEndMin) - viewStartMin) / BOARD_SLOT) * SLOT_W;

  useEffect(() => {
    if (scrolled.current || !scrollRef.current || !showNow) return;
    scrolled.current = true;
    scrollRef.current.scrollLeft = Math.max(0, nowX - 220);
  }, [showNow, nowX]);

  const live = reservations.filter((r) => r.status !== 'cancelled' && r.status !== 'no_show');
  const totalGuests = live.reduce((sum, r) => sum + r.partySize, 0);
  const unassigned = live.filter((r) => r.tableIds.length === 0 && r.status !== 'completed');

  const goPay = (id: string) => {
    startPay(async () => {
      try {
        await createOrderFromReservation(id);
      } catch (e) {
        toast(e instanceof Error ? e.message : '会計画面を開けませんでした', 'error');
      }
    });
  };

  const renderBar = ({ r, s, e }: Placed, unassignedRow: boolean) => {
    const kind = barKind(r.status, unassignedRow);
    const left = x(s) + 2;
    const width = Math.max(18, x(e) - x(s) - 4);
    const badge = sourceBadge(r);
    const sameDay = r.createdAt && r.createdVia !== 'walk_in' && jstDate(r.createdAt) === r.reservedDate;
    const filled = kind === 'in' || kind === 'pay';
    const extraTables = !unassignedRow && r.tableNames.length > 1 ? r.tableNames.join('+') : null;
    return (
      <div
        key={r.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelected(r)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            setSelected(r);
          }
        }}
        title={`${r.guestName} 様 ${hm(s)}〜${hm(e)}`}
        className={cn(
          'absolute top-[6px] flex h-10 cursor-pointer items-center gap-2 overflow-hidden rounded-lg border-[1.5px] py-1 pr-1.5 pl-2 text-left text-xs leading-tight transition-shadow hover:z-[2] hover:shadow-card focus-visible:z-[2] focus-visible:outline-2 focus-visible:outline-saffron',
          BAR_CLASS[kind],
          r.isPrivateHire && 'ring-2 ring-gold ring-offset-1'
        )}
        style={{ left, width }}
      >
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-px">
          <b className="flex items-center gap-1 truncate font-[family-name:var(--font-num)] text-[12.5px] font-bold whitespace-nowrap">
            <span className="tabular-nums">
              {r.partySize}
              <span className="font-sans">名</span>
            </span>
            {badge && (
              <span
                className={cn(
                  'rounded-[5px] px-1.5 font-[family-name:var(--font-num)] text-[10px] leading-[1.4] font-extrabold',
                  filled ? 'bg-white/25 text-white' : 'bg-danger text-white'
                )}
              >
                {badge}
              </span>
            )}
            {kind === 'tentative' && <span className="rounded-full bg-lilac px-1.5 text-[10px] font-bold text-ink-2">仮</span>}
            {sameDay && (
              <span className={cn('rounded-full px-1.5 text-[10px] font-bold', filled ? 'bg-white/25 text-white' : 'bg-danger-soft text-danger')}>
                当日
              </span>
            )}
            {r.isPrivateHire && (
              <span className={cn('rounded-full px-1.5 text-[10px] font-bold', filled ? 'bg-white/25 text-white' : 'bg-iris-soft text-royal')}>
                貸切
              </span>
            )}
          </b>
          <span className="truncate text-[10.5px] whitespace-nowrap opacity-90">
            {r.guestName} 様{r.courseName ? `・${r.courseName}` : ''}
            {extraTables ? `・${extraTables}` : ''}・<span className="tabular-nums">{hm(s)}〜{hm(e)}</span>
          </span>
        </span>
        {kind === 'pay' && (
          <button
            type="button"
            disabled={payPending}
            onClick={(ev) => {
              ev.stopPropagation();
              goPay(r.id);
            }}
            onKeyDown={(ev) => ev.stopPropagation()}
            className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-[7px] border border-white/60 bg-white px-2 py-1 text-[11px] leading-[1.1] font-extrabold text-royal hover:bg-gold disabled:opacity-60"
          >
            会計
            <small className="font-[family-name:var(--font-num)] text-[8.5px] font-semibold text-ink-3">Pay</small>
          </button>
        )}
      </div>
    );
  };

  const offHours = (
    <>
      {openMin > viewStartMin && <i className="board-off absolute inset-y-0 left-0" style={{ width: x(openMin) }} aria-hidden />}
      {closeMin < viewEndMin && <i className="board-off absolute inset-y-0 right-0" style={{ left: x(closeMin) }} aria-hidden />}
    </>
  );

  const bufferStripes = (placed: Placed[]) =>
    bufferMinutes > 0
      ? placed
          .filter((p) => p.r.status !== 'completed')
          .map((p) => (
            <i
              key={`buf-${p.r.id}`}
              title={`清掃時間（バッファ${bufferMinutes}分）`}
              className="board-buffer absolute top-[6px] h-10 rounded-md"
              style={{ left: x(p.e), width: Math.max(0, x(p.e + bufferMinutes) - x(p.e)) }}
            />
          ))
      : null;

  const rowBg = {
    backgroundImage: `repeating-linear-gradient(to right, var(--color-line) 0 1px, transparent 1px ${SLOT_W * 2}px), repeating-linear-gradient(to right, rgba(227,219,241,.55) 0 1px, transparent 1px ${SLOT_W}px)`,
  } as const;

  const unassignedPlaced = place(unassigned, viewStartMin, viewEndMin);

  return (
    <Card className="overflow-hidden print:shadow-none">
      <style>{`
        .board-off{background:repeating-linear-gradient(135deg,rgba(201,184,234,.35) 0 6px,transparent 6px 12px);pointer-events:none}
        .board-buffer{background:repeating-linear-gradient(45deg,rgba(122,112,144,.18) 0 3px,transparent 3px 6px);pointer-events:auto}
      `}</style>
      {/* 見出しは出さない（店舗要望 2026-09-24）。日付ナビは上のバー、
          「最終更新・組数・人数・営業時間」は下の行にまとめた */}

      {tables.length === 0 && unassigned.length === 0 ? (
        <div className="p-5">
          <EmptyState title="テーブルが登録されていません" description="設定 > テーブル管理からテーブルを登録してください。" />
        </div>
      ) : (
        <div ref={scrollRef} className="relative max-h-[calc(100dvh-12rem)] overflow-auto print:max-h-none print:overflow-visible">
          <div
            className="relative grid min-w-max"
            style={{ gridTemplateColumns: `${LABEL_W}px ${gridWidth}px` }}
          >
            {/* 見出し行 */}
            <div
              className="sticky top-0 left-0 z-[4] flex flex-col justify-center border-r border-b border-line bg-lilac-soft px-3 text-[12px] leading-tight font-bold text-ink-2"
              style={{ height: HEAD_H }}
            >
              テーブル
              <span className="en-sub">Table</span>
            </div>
            <div
              className="sticky top-0 z-[3] grid border-b border-line bg-lilac-soft"
              style={{ gridTemplateColumns: `repeat(${cols}, ${SLOT_W}px)`, height: HEAD_H }}
            >
              {Array.from({ length: cols }, (_, i) => {
                const m = viewStartMin + i * BOARD_SLOT;
                const full = m % 60 === 0;
                return (
                  <span
                    key={m}
                    className={cn(
                      'pt-2.5 pl-1.5 font-[family-name:var(--font-num)] text-[12px] font-bold whitespace-nowrap text-ink-2 tabular-nums',
                      full ? 'border-l border-line' : 'text-transparent'
                    )}
                  >
                    {full ? hm(m) : ''}
                  </span>
                );
              })}
            </div>

            {/* 席未定 */}
            {unassigned.length > 0 && (
              <>
                <div className="sticky left-0 z-[2] flex flex-col justify-center border-r border-b border-line bg-white px-1.5 py-1" style={{ minHeight: ROW_H }}>
                  <div className="flex flex-col justify-center rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-1 leading-tight">
                    <span className="text-[13px] font-extrabold text-danger">席未定</span>
                    <small className="text-[11px] text-ink-2">{unassigned.length}組 ・ 席選択が必要</small>
                  </div>
                </div>
                <div className="relative border-b border-line bg-danger-soft/70" style={{ ...rowBg, minHeight: ROW_H }}>
                  {offHours}
                  {unassignedPlaced.map((p) => renderBar(p, true))}
                </div>
              </>
            )}

            {/* テーブル行 */}
            {tables.map((t) => {
              const placed = place(
                live.filter((r) => r.tableIds.includes(t.id)),
                viewStartMin,
                viewEndMin
              );
              return (
                <div key={t.id} className="contents">
                  {/* 卓はうすい紫のボタンのような見た目にする（店舗要望 2026-09-24）。
                      出すのは卓の名前と「◯〜◯名席」だけ */}
                  <div className="sticky left-0 z-[2] flex flex-col justify-center border-r border-b border-line bg-white px-1.5 py-1" style={{ minHeight: ROW_H }}>
                    <div className="flex flex-col justify-center rounded-lg border border-lilac bg-lilac-soft px-2.5 py-1 leading-tight">
                      <span className="font-[family-name:var(--font-num)] text-[13px] font-extrabold text-royal">
                        <span className="mr-1 text-[9px]">▶</span>
                        {t.name}
                      </span>
                      <small className="text-[11px] text-ink-2">
                        <span className="tabular-nums">
                          {t.capacityMin === t.capacityMax ? t.capacityMax : `${t.capacityMin}〜${t.capacityMax}`}
                        </span>
                        名席
                      </small>
                    </div>
                  </div>
                  <div className="relative border-b border-line" style={{ ...rowBg, minHeight: ROW_H }}>
                    {offHours}
                    {bufferStripes(placed)}
                    {placed.map((p) => renderBar(p, false))}
                  </div>
                </div>
              );
            })}

            {/* 現在時刻 */}
            {showNow && (
              <div
                className="pointer-events-none absolute bottom-0 z-[3] w-0"
                style={{ left: LABEL_W + nowX, top: HEAD_H - 14 }}
                aria-hidden
              >
                <i className="absolute inset-y-0 -left-px w-0.5 bg-saffron" />
                <b className="absolute top-0 -left-[21px] rounded-full bg-saffron px-1.5 font-[family-name:var(--font-num)] text-[10px] leading-[1.5] font-extrabold text-white tabular-nums shadow-card">
                  {hm(nowMin)}
                </b>
                <i className="absolute -bottom-1 -left-1 h-2 w-2 rounded-full bg-saffron" />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line bg-lilac-soft px-4 py-2 text-[11.5px] text-ink-3">
        <span className="tabular-nums">
          最終更新 {updatedAt} ・ {live.length}組 {totalGuests}名
          {!isClosedDay && ` ・ ${hm(openMin)}〜${hm(closeMin)}`}
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-medium text-ink-2">
          <Legend className="border-2 border-dashed border-ink-3 bg-white">仮予約</Legend>
          <Legend className="border-2 border-iris bg-white">来店待ち</Legend>
          <Legend className="bg-iris">来店済み</Legend>
          <Legend className="bg-[#CFC9DA]">退店</Legend>
          <Legend className="bg-danger">席未定</Legend>
          {bufferMinutes > 0 && <Legend className="board-buffer border border-line">清掃（{bufferMinutes}分）</Legend>}
          {isToday && <Legend className="bg-saffron">現在時刻</Legend>}
          <span className="text-ink-3">バーをタップ＝詳細（状態・テーブル割当・日時変更）</span>
        </div>
      </div>

      <ReservationDetailDialog
        reservation={selected}
        onClose={() => setSelected(null)}
        tables={tables}
        staffOptions={staffOptions}
        canManagePrivateHire={canManagePrivateHire}
      />
    </Card>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center">
      <i className={cn('mr-1.5 inline-block h-[9px] w-[9px] rounded-full', className)} />
      {children}
    </span>
  );
}
