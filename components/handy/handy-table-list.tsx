'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen, formatTime } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useNow } from '@/components/floor/use-now';
import { ChipButton } from '@/components/ui/chip';
import { stepFloor, swipeDirection } from '@/lib/floor-nav';
import {
  filterHandyTables,
  handyFloorStorageKey,
  handyFloorTabs,
  initialHandyFloor,
  type HandyFloorOption,
} from '@/lib/handy-floor';
import {
  callToneByTable,
  canStartOrder,
  elapsedLabel,
  serviceCallLabel,
  tableState,
  TABLE_STATE_LABEL,
  type HandyServiceCall,
  type HandyTableState,
} from './logic';

export interface HandyTableCard {
  id: string;
  name: string;
  /** フロア（決めていない卓は null） */
  floorId: string | null;
  capacityMax: number;
  currentStatus: string | null;
  /** 未会計伝票の枚数（0なら空席・清掃中など） */
  orderCount: number;
  openedAtMs: number | null;
  guestCount: number;
  total: number;
}

/**
 * テーブル一覧のタイル（承認済みレイアウトの `.tables-screen .tables`）。
 * 3列・正方形・白地のカードで、利用中の卓だけ薄紫にして「開始 / 経過 / 未会計」を出す。
 */
export function HandyTableList({
  tables,
  calls,
  serverNow,
  setTableLockAction,
  floors = [],
  defaultFloorId = null,
  storeId,
}: {
  tables: HandyTableCard[];
  calls: HandyServiceCall[];
  serverNow: number;
  /** フロア（3F・4F・5F）。2つ以上あるときだけ上にタブを出す（2026-10-16 SHUNKA 新宿） */
  floors?: HandyFloorOption[];
  /** 店舗の「レジで最初に出すフロア」。端末で選び直すまではこのフロアから始まる */
  defaultFloorId?: string | null;
  storeId?: string;
  /** 卓ロック（お客様が入っていない卓だけ）。レジのテーブル一覧と同じ（2026-09-24 店舗要望） */
  setTableLockAction?: (tableId: string, unavailable: boolean) => Promise<void>;
}) {
  const now = useNow(serverNow);
  const toneByTable = callToneByTable(calls);
  // フロアのタブ（3F・4F・5F）。卓が多い店でも担当のフロアだけ見られるように
  const hasUnassigned = tables.some((t) => !t.floorId);
  const floorTabs = useMemo(() => handyFloorTabs(floors, hasUnassigned), [floors, hasUnassigned]);
  const tabIds = useMemo(() => floorTabs.map((t) => t.id), [floorTabs]);
  const [floor, setFloor] = useState(() => initialHandyFloor(tabIds, defaultFloorId));
  // 端末で前に選んだフロアを思い出す。
  // SSRとのhydration不一致を避けるためマウント後に復元する（effect本体での同期setStateを避けてタスクへ遅延。components/layout/sidebar.tsx と同じ形）
  useEffect(() => {
    if (!storeId || tabIds.length === 0) return;
    const timer = setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(handyFloorStorageKey(storeId));
        setFloor(initialHandyFloor(tabIds, defaultFloorId, saved));
      } catch {
        // プライベートブラウズなどで localStorage が使えないときは店舗の設定のまま
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [storeId, tabIds, defaultFloorId]);
  const pickFloor = (id: string) => {
    setFloor(id);
    if (!storeId) return;
    try {
      window.localStorage.setItem(handyFloorStorageKey(storeId), id);
    } catch {
      // 覚えられなくても動く
    }
  };
  const shown = floorTabs.length > 0 ? filterHandyTables(tables, floor) : tables;
  // 左右スライドで隣のフロアへ（レジと同じ。右 → 次のフロア、左 → 前のフロア。ALL・未分類は除く）
  const floorOnlyIds = useMemo(() => floors.map((f) => f.id).filter((id) => tabIds.includes(id)), [floors, tabIds]);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const canSwipe = floorOnlyIds.length > 1;
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    const t = e.changedTouches[0];
    if (!s || !t) return;
    const dir = swipeDirection(t.clientX - s.x, t.clientY - s.y);
    if (dir) pickFloor(stepFloor(floorOnlyIds, floor, dir, defaultFloorId));
  };
  // 空いている卓はタップで画面遷移せず、真ん中に小さいポップアップを出す（2026-09-24 店舗要望）
  const [sheetTableId, setSheetTableId] = useState<string | null>(null);
  const sheetTable = tables.find((t) => t.id === sheetTableId) ?? null;

  if (tables.length === 0) {
    return (
      <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#766b62]">
        テーブルが登録されていません。
        <br />
        設定画面からフロア・テーブルを登録してください。
      </p>
    );
  }

  return (
    <div onTouchStart={canSwipe ? onTouchStart : undefined} onTouchEnd={canSwipe ? onTouchEnd : undefined} className="min-h-full">
      {floorTabs.length > 0 && (
        // レジ（オーダー・会計）と同じ見た目のタブ。真ん中に並べ、一覧をスクロールしても上に残す
        // （2026-10-16 Ronnie「ハンディにもレジのような ALL・3F・4F・5F」）
        <div className="sticky top-0 z-10 bg-[#fbf9f5]/95 px-2 pt-1.5 pb-1.5 backdrop-blur">
          <div className="flex justify-center gap-1.5 overflow-x-auto" role="group" aria-label="フロア">
            {floorTabs.map((t) => (
              <ChipButton
                key={t.id}
                on={t.id === floor}
                onClick={() => pickFloor(t.id)}
                className="min-h-[38px] shrink-0 px-4 text-[14px] whitespace-nowrap"
              >
                {t.label}
              </ChipButton>
            ))}
          </div>
        </div>
      )}
      {shown.length === 0 && (
        <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#766b62]">
          このフロアにテーブルがありません。
        </p>
      )}
      <ul className="grid grid-cols-3 content-start gap-2 px-2 pt-1.5 pb-2.5 sm:grid-cols-4 lg:grid-cols-6">
        {shown.map((t) => (
          <li key={t.id}>
            <HandyTableTile
              table={t}
              now={now}
              callKind={toneByTable.get(t.id) ?? null}
              onPick={setTableLockAction ? () => setSheetTableId(t.id) : undefined}
            />
          </li>
        ))}
      </ul>
      {sheetTable && setTableLockAction && (
        <HandyTableSheet
          table={sheetTable}
          setTableLockAction={setTableLockAction}
          onClose={() => setSheetTableId(null)}
        />
      )}
    </div>
  );
}

/** ポップアップを出す（画面遷移しない）卓の状態 */
function usesSheet(state: HandyTableState): boolean {
  return state === 'available' || state === 'blocked' || state === 'cleaning';
}

/**
 * 卓のポップアップ（承認済みレイアウトの一覧の上に小さく出す）。
 * 「注文を開始」と「テーブルをロック」だけ。お客様が入っている卓では出さない。
 */
function HandyTableSheet({
  table,
  setTableLockAction,
  onClose,
}: {
  table: HandyTableCard;
  setTableLockAction: (tableId: string, unavailable: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const state = tableState(table.currentStatus, table.orderCount > 0);
  const locked = state === 'blocked';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={table.name}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#29272588] p-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[250px] rounded-xl bg-white p-3.5 shadow-[0_20px_90px_#0005]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-center text-[15px] font-bold text-[#292725]">{table.name}</p>
        <p className="mt-0.5 text-center text-[11px] text-[#766b62]">
          {table.capacityMax}名席 · {TABLE_STATE_LABEL[state]}
        </p>
        <div className="mt-3 grid gap-1.5">
          {canStartOrder(state) && (
            <button
              type="button"
              disabled={pending}
              onClick={() => router.push(`/handy/${table.id}/setup`)}
              className="min-h-[43px] rounded-lg bg-[#bc5940] text-sm font-bold text-white disabled:opacity-40"
            >
              注文を開始
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await setTableLockAction(table.id, !locked);
                  toast(locked ? 'ロックを解除しました' : 'テーブルをロックしました');
                  router.refresh();
                  onClose();
                } catch (e) {
                  toast(e instanceof Error ? e.message : '変更できませんでした', 'error');
                }
              })
            }
            className="min-h-[43px] rounded-lg border border-[#e5dfd5] bg-[#f9f3ed] text-sm font-bold text-[#45403b] disabled:opacity-40"
          >
            {locked ? 'ロック解除' : 'テーブルをロック'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] rounded-lg bg-[#f3efe8] text-[13px] font-bold text-[#5c5650]"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function HandyTableTile({
  table,
  now,
  callKind,
  onPick,
}: {
  table: HandyTableCard;
  now: number;
  callKind: 'staff' | 'checkout' | null;
  /** 空いている卓のタップ（ポップアップ）。未指定なら従来どおり卓の画面へ移動する */
  onPick?: () => void;
}) {
  const state = tableState(table.currentStatus, table.orderCount > 0);
  const occupied = state === 'occupied';
  const sheet = onPick && usesSheet(state);

  const className = cn(
        'tap3d relative flex aspect-square w-full flex-col items-start rounded-[10px] border p-2 text-left',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bc5940]',
        callKind === 'checkout'
          ? 'border-[#b7791f] bg-[#fbf1d9]'
          : callKind === 'staff'
            ? 'border-[#bc5940] bg-[#f6e4da]'
            : occupied
              ? 'border-[#eac0ad] bg-[#f3efe8]'
              : state === 'blocked'
                ? 'border-[#d3ccc2] bg-[#e5dfd5]'
                : 'border-[#e5dfd5] bg-white'
  );
  const label = `${table.name} ${TABLE_STATE_LABEL[state]}${callKind ? ` ${serviceCallLabel(callKind)}` : ''}`;

  const body = (
    <>
      {/* 呼び出し中の卓は 箱の枠が点滅（2026-09-28 Ronnie「卓の箱に知らせを」） */}
      {callKind && (
        <span
          className={cn(
            'pointer-events-none absolute inset-0 animate-pulse rounded-[10px] ring-[3px] ring-inset',
            callKind === 'checkout' ? 'ring-[#b7791f]' : 'ring-[#bc5940]'
          )}
          aria-hidden
        />
      )}
      <span className="flex w-full items-start justify-between gap-1">
        <b className="min-w-0 truncate text-[15px] leading-tight font-semibold text-[#5c5650]">
          {table.name}
        </b>
        {callKind && (
          <span
            className={cn(
              'shrink-0 rounded-full p-0.5 text-white',
              callKind === 'checkout' ? 'bg-[#b7791f]' : 'bg-[#bc5940]'
            )}
            aria-hidden
          >
            {callKind === 'checkout' ? (
              <Wallet className="h-3 w-3" />
            ) : (
              <BellRing className="h-3 w-3" />
            )}
          </span>
        )}
      </span>

      {occupied ? (
        <>
          <span className="mt-px mb-auto block w-full truncate text-[10px] leading-tight font-normal text-black">
            {table.guestCount > 0 ? `${table.guestCount}名` : '利用中'}
            {table.orderCount > 1 ? ` · 伝票${table.orderCount}` : ''}
          </span>
          <TileRow label="開始" value={table.openedAtMs !== null ? formatTime(new Date(table.openedAtMs)) : '—'} />
          <TileRow
            label="経過"
            value={table.openedAtMs !== null ? elapsedLabel(table.openedAtMs, now) : '—'}
            accent
          />
          <TileRow label="未会計" value={yen(table.total)} small />
        </>
      ) : (
        <span className="m-auto text-[9px] text-[#766b62]">
          {state === 'available' ? `${table.capacityMax}名席` : TABLE_STATE_LABEL[state]}
        </span>
      )}
    </>
  );

  if (sheet) {
    return (
      <button type="button" onClick={onPick} className={className} aria-label={label}>
        {body}
      </button>
    );
  }
  return (
    <Link href={`/handy/${table.id}`} className={className} aria-label={label}>
      {body}
    </Link>
  );
}

function TileRow({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <span className="flex w-full items-baseline justify-between gap-1 leading-[1.5]">
      <small className="shrink-0 text-[9px] text-[#766b62]">{label}</small>
      <b
        className={cn(
          'min-w-0 truncate tabular-nums',
          accent
            ? 'text-[15px] font-bold text-[#bc5940]'
            : small
              ? 'text-[11px] font-bold text-[#5c5650]'
              : 'text-[13px] font-bold text-[#5c5650]'
        )}
      >
        {value}
      </b>
    </span>
  );
}
