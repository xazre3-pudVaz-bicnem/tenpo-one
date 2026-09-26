'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, Map as MapIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChipButton } from '@/components/ui/chip';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';
import { TableSheet } from './table-sheet';
import { TableCard } from './table-card';
import { ReservationPanel } from './reservation-panel';
import { useNow } from './use-now';
import type { WalkInSeatOptions } from './table-sheet';
import type { SeatCourseOption } from '@/lib/seat-time';
import type { SeatTimeInput } from '@/app/app/pos/actions';
import { initialFloorFilter, stepFloor, swipeDirection } from '@/lib/floor-nav';
import {
  TILE_LABEL,
  tileState,
  type FloorRow,
  type PanelReservation,
  type TableView,
  type TileState,
} from './types';

export type { FloorRow, FloorTable, ReservationChip, TableView, PanelReservation } from './types';

const SHAPE_CLASS: Record<string, string> = {
  square: 'rounded-xl',
  round: 'rounded-full',
  counter: 'rounded-md',
};

const MAP_TONE: Record<TileState, string> = {
  free: 'border-dashed border-wisteria bg-white text-ink-3',
  reserved: 'border-dashed border-royal bg-white text-royal',
  waiting: 'border-dashed border-royal bg-iris-soft text-royal',
  seated: 'border-wisteria bg-iris-soft text-royal',
  ordered: 'border-iris bg-iris-soft text-royal',
  lo: 'border-[#E0AE00] bg-[#FFFBEB] text-[#8A6100]',
  over: 'border-danger bg-danger-soft text-danger',
  pay: 'border-saffron bg-saffron-soft text-saffron',
  cleaning: 'border-line bg-lilac-soft text-ink-2',
  unavailable: 'border-line bg-lilac-soft text-ink-3',
};

type View = 'cards' | 'map';

export function FloorBoard({
  storeId,
  floors,
  defaultFloorId = null,
  tables,
  reservations,
  serverNow,
  canOperate,
  startWalkInAction,
  defaultStayMinutes = 120,
  goToOrderAction,
  completeCleaningAction,
  setTableAvailabilityAction,
  saveTableGroupAction,
  mergeOrdersAction,
  setGuestCountAction,
  setPaymentMemoAction,
  printExpoSlipAction,
  printSelectedItemsAction,
  seatCourses = [],
  setSeatTimeAction,
  releaseFinishedCleaningAction,
  topSlot,
  bottomSlot,
}: {
  storeId: string;
  floors: FloorRow[];
  /** 最初に出すフロア（設定 > テーブル・フロア）。無ければ「すべて」 */
  defaultFloorId?: string | null;
  tables: TableView[];
  reservations: PanelReservation[];
  serverNow: number;
  canOperate: boolean;
  startWalkInAction: (tableId: string, partySize: number, options?: WalkInSeatOptions) => Promise<{ orderId: string }>;
  /** 店舗の既定滞在時間（分） */
  defaultStayMinutes?: number;
  goToOrderAction: (tableId: string) => Promise<{ orderId: string }>;
  completeCleaningAction: (tableId: string) => Promise<void>;
  setTableAvailabilityAction: (tableId: string, unavailable: boolean) => Promise<void>;
  /** テーブルグループ（まとめる卓）の保存。1卓以下を渡すと解除（2026-09-25 店舗要望） */
  saveTableGroupAction: (tableIds: string[]) => Promise<{ error?: string }>;
  /** テーブル合算・お客様情報・支払メモ・印刷（2026-09-25 店舗要望） */
  mergeOrdersAction: (targetOrderId: string, sourceOrderId: string) => Promise<void>;
  setGuestCountAction: (orderId: string, guestCount: number) => Promise<void>;
  setPaymentMemoAction: (orderId: string, memo: string) => Promise<{ error?: string }>;
  printExpoSlipAction: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
  printSelectedItemsAction: (orderId: string, itemIds: string[]) => Promise<{ ok: boolean; error?: string }>;
  /** 席の時間・コースを卓のポップアップから直す（2026-09-25 店舗要望） */
  seatCourses?: SeatCourseOption[];
  setSeatTimeAction?: (orderId: string, input: SeatTimeInput) => Promise<void>;
  /** テーブルの上に出すもの（テイクアウト）。右のご予約は一番上から出したいのでここに入れる */
  topSlot?: ReactNode;
  /** テーブルの下に出すもの（色の見方）。上に置くとテーブルが下がるので一番下に置く */
  bottomSlot?: ReactNode;
  /** 清掃中のまま時間が過ぎたテーブルを空席に戻す。省略時は自動解除しない */
  releaseFinishedCleaningAction?: (storeId: string) => Promise<{ released: number }>;
}) {
  const router = useRouter();
  const now = useNow(serverNow);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 押したテーブルの画面上の位置。ポップアップをその近くに出す */
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  /**
   * テーブルを押したときの動き（2026-09-25 店舗要望）。
   * どの状態でも、押した卓の上に小さいポップアップを出す。
   *   空席   → 注文 ／ テーブルブロック ／ テーブルグループ設定
   *   着席中 → まとめ・注文・レジ会計・テーブル・印刷・お客様情報・支払メモ
   */
  const openTable = (t: TableView, el?: HTMLElement | null) => {
    if (el) {
      const r = el.getBoundingClientRect();
      setAnchor({ x: r.left, y: r.top, w: r.width, h: r.height });
    } else {
      setAnchor(null);
    }
    setSelectedId(t.id);
  };
  const floorIds = floors.map((f) => f.id);
  const [floorFilter, setFloorFilter] = useState<string>(() => initialFloorFilter(floorIds, defaultFloorId));
  // 左右スライドで隣のフロアへ（右 → 次のフロア、左 → 前のフロア）
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    const t = e.changedTouches[0];
    if (!s || !t || floorIds.length < 2) return;
    const dir = swipeDirection(t.clientX - s.x, t.clientY - s.y);
    if (dir) setFloorFilter((cur) => stepFloor(floorIds, cur, dir, defaultFloorId));
  };
  const [view, setView] = useState<View>('cards');

  // テーブル状態（着席・清掃中など）と、テーブルに紐づく注文・予約の変化をRealtimeで検知して画面を更新する。
  // 15秒ごとに自動更新（Realtime が届かない端末でも遅れないように。2026-09-25 店舗要望）
  useStoreRealtimeRefresh({
    storeId,
    tables: ['restaurant_tables', 'orders', 'reservations'],
    fallbackMs: 15_000,
  });

  // 清掃中のまま放置されたテーブルを自動で空席に戻す。
  // 「清掃完了」の押し忘れで席が埋まったままに見える、という現場の詰まりを防ぐ。
  // テーブル一覧を開いている端末が1分ごとに片付ける（サーバー側でも時間を検証している）。
  useEffect(() => {
    if (!releaseFinishedCleaningAction) return;
    let cancelled = false;
    const sweep = async () => {
      try {
        const { released } = await releaseFinishedCleaningAction(storeId);
        if (!cancelled && released > 0) router.refresh();
      } catch {
        // 自動解除は best effort（失敗しても手動の「清掃完了」で戻せる）
      }
    };
    void sweep();
    const timer = setInterval(() => void sweep(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [storeId, releaseFinishedCleaningAction, router]);

  const selected = tables.find((t) => t.id === selectedId) ?? null;
  const unassigned = tables.filter((t) => !floors.some((f) => f.id === t.floor_id));
  const hasPlacement = tables.some((t) => t.pos_x != null && t.pos_y != null);

  const visible =
    floorFilter === 'all'
      ? tables
      : floorFilter === '_none'
        ? unassigned
        : tables.filter((t) => t.floor_id === floorFilter);

  // 配置図はフロア単位で描く
  const mapGroups =
    floors.length > 0
      ? [
          ...floors.map((f) => ({ id: f.id, name: f.name, tables: tables.filter((t) => t.floor_id === f.id) })),
          ...(unassigned.length > 0 ? [{ id: '_none', name: '未分類', tables: unassigned }] : []),
        ].filter((g) => floorFilter === 'all' || g.id === floorFilter)
      : [{ id: '_', name: 'テーブル', tables }];

  const showToolbar = floors.length > 1 || (floors.length > 0 && unassigned.length > 0) || hasPlacement;
  /** フロアが2つ以上あるときだけ左右スライドでフロアを変える */
  const canSwipeFloor = floorIds.length > 1;

  return (
    // パソコン・iPad は「テーブル」と「本日のご予約」を別々にスクロールさせる（画面の高さで止める）
    <div className="grid items-start gap-3.5 lg:h-[calc(100vh-7rem)] lg:grid-cols-[minmax(0,1fr)_270px]">
      <div className="min-w-0 space-y-3 lg:h-full lg:overflow-y-auto lg:pr-1">
        {topSlot}
        {showToolbar && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span aria-hidden />
            <div className="flex flex-wrap justify-center gap-1.5">
              {(floors.length > 1 || (floors.length > 0 && unassigned.length > 0)) && (
                <>
                  {/* 全フロアは「ALL」だけ（日本語は出さない。2026-09-24 店舗要望） */}
                  <ChipButton on={floorFilter === 'all'} onClick={() => setFloorFilter('all')}>
                    ALL
                  </ChipButton>
                  {floors.map((f) => (
                    <ChipButton key={f.id} on={floorFilter === f.id} onClick={() => setFloorFilter(f.id)}>
                      {f.name}
                    </ChipButton>
                  ))}
                  {unassigned.length > 0 && (
                    <ChipButton on={floorFilter === '_none'} onClick={() => setFloorFilter('_none')}>
                      未分類
                    </ChipButton>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end">
              {hasPlacement && (
              <div className="inline-flex overflow-hidden rounded-lg border border-line bg-white p-0.5">
                {(
                  [
                    { key: 'cards', label: '一覧 / List', Icon: LayoutGrid },
                    { key: 'map', label: '配置図 / Map', Icon: MapIcon },
                  ] as const
                ).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
                      view === key ? 'bg-royal text-white' : 'text-ink-2 hover:bg-lilac-soft'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
              )}
            </div>
          </div>
        )}

        {/* 左右スライドで隣のフロアへ。テーブルの並びの上だけで効かせる（フロアが2つ以上のときだけ） */}
        <div
          onTouchStart={canSwipeFloor ? onTouchStart : undefined}
          onTouchEnd={canSwipeFloor ? onTouchEnd : undefined}
        >
          {view === 'map' && hasPlacement ? (
            <div className="space-y-3">
              {mapGroups.map((g) => {
                const placed = g.tables.filter((t) => t.pos_x != null && t.pos_y != null);
                const unplaced = g.tables.filter((t) => t.pos_x == null || t.pos_y == null);
                return (
                  <section key={g.id} className="ui-card border border-line bg-white p-4">
                    <h2 className="mb-3 text-[13px] font-bold text-royal">{g.name}</h2>
                    {g.tables.length === 0 ? (
                      <p className="text-xs text-ink-3">このフロアにテーブルはありません</p>
                    ) : (
                      <>
                        {placed.length > 0 && (
                          <div className="overflow-x-auto">
                            <div
                              className="grid min-w-[40rem] gap-2"
                              style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gridAutoRows: '5rem' }}
                            >
                              {placed.map((t) => {
                                const st = tileState(t, now);
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={(e) => openTable(t, e.currentTarget)}
                                    style={{
                                      gridColumnStart: (t.pos_x as number) + 1,
                                      gridRowStart: (t.pos_y as number) + 1,
                                    }}
                                    className={cn(
                                      'flex flex-col items-center justify-center gap-0.5 border p-1.5 text-center transition-transform active:scale-[0.97]',
                                      MAP_TONE[st],
                                      SHAPE_CLASS[t.shape] ?? SHAPE_CLASS.square
                                    )}
                                  >
                                    <b className="text-[13px] font-extrabold text-ink tabular-nums">{t.name}</b>
                                    <span className="text-[10.5px] font-bold">{TILE_LABEL[st]}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {unplaced.length > 0 && (
                          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                            {unplaced.map((t) => (
                              <TableCard key={t.id} table={t} now={now} onSelect={openTable} />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          ) : visible.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-wisteria bg-white px-4 py-10 text-center text-[13px] text-ink-3">
              このフロアにテーブルはありません
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {visible.map((t) => (
                <TableCard key={t.id} table={t} now={now} onSelect={openTable} />
              ))}
            </div>
          )}
        </div>

        {bottomSlot}
      </div>

      <div className="min-w-0 lg:h-full lg:min-h-0">
        <ReservationPanel reservations={reservations} now={now} />
      </div>

      <TableSheet
        key={selected?.id ?? 'none'}
        table={selected}
        anchor={anchor}
        now={now}
        canOperate={canOperate}
        onClose={() => {
          setSelectedId(null);
          setAnchor(null);
        }}
        startWalkInAction={startWalkInAction}
        defaultStayMinutes={defaultStayMinutes}
        goToOrderAction={goToOrderAction}
        completeCleaningAction={completeCleaningAction}
        setTableAvailabilityAction={setTableAvailabilityAction}
        saveTableGroupAction={saveTableGroupAction}
        mergeOrdersAction={mergeOrdersAction}
        setGuestCountAction={setGuestCountAction}
        setPaymentMemoAction={setPaymentMemoAction}
        printExpoSlipAction={printExpoSlipAction}
        printSelectedItemsAction={printSelectedItemsAction}
        seatCourses={seatCourses}
        setSeatTimeAction={setSeatTimeAction}
        allTables={tables}
      />
    </div>
  );
}
