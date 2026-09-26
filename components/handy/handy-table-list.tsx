'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen, formatTime } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useNow } from '@/components/floor/use-now';
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
}: {
  tables: HandyTableCard[];
  calls: HandyServiceCall[];
  serverNow: number;
  /** 卓ロック（お客様が入っていない卓だけ）。レジのテーブル一覧と同じ（2026-09-24 店舗要望） */
  setTableLockAction?: (tableId: string, unavailable: boolean) => Promise<void>;
}) {
  const now = useNow(serverNow);
  const toneByTable = callToneByTable(calls);
  // 空いている卓はタップで画面遷移せず、真ん中に小さいポップアップを出す（2026-09-24 店舗要望）
  const [sheetTableId, setSheetTableId] = useState<string | null>(null);
  const sheetTable = tables.find((t) => t.id === sheetTableId) ?? null;

  if (tables.length === 0) {
    return (
      <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#7f6e7a]">
        テーブルが登録されていません。
        <br />
        設定画面からフロア・テーブルを登録してください。
      </p>
    );
  }

  return (
    <>
      <ul className="grid grid-cols-3 content-start gap-2 px-2 pt-1.5 pb-2.5 sm:grid-cols-4 lg:grid-cols-6">
        {tables.map((t) => (
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
    </>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#211c2888] p-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[250px] rounded-xl bg-white p-3.5 shadow-[0_20px_90px_#0005]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-center text-[15px] font-bold text-[#2a1f2e]">{table.name}</p>
        <p className="mt-0.5 text-center text-[11px] text-[#7f6e7a]">
          {table.capacityMax}名席 · {TABLE_STATE_LABEL[state]}
        </p>
        <div className="mt-3 grid gap-1.5">
          {canStartOrder(state) && (
            <button
              type="button"
              disabled={pending}
              onClick={() => router.push(`/handy/${table.id}/setup`)}
              className="min-h-[43px] rounded-lg bg-[#9f2c6c] text-sm font-bold text-white disabled:opacity-40"
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
            className="min-h-[43px] rounded-lg border border-[#e8dce4] bg-[#f7f1f5] text-sm font-bold text-[#4a3444] disabled:opacity-40"
          >
            {locked ? 'ロック解除' : 'テーブルをロック'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] rounded-lg bg-[#f3ecf1] text-[13px] font-bold text-[#5e4e5a]"
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
        'tap3d flex aspect-square w-full flex-col items-start rounded-[10px] border p-2 text-left',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f2c6c]',
        callKind === 'checkout'
          ? 'border-[#bd660f] bg-[#fbefdf]'
          : callKind === 'staff'
            ? 'border-[#9f2c6c] bg-[#f7e4ee]'
            : occupied
              ? 'border-[#e2b5cf] bg-[#f3ecf1]'
              : state === 'blocked'
                ? 'border-[#c9c4d2] bg-[#e8dce4]'
                : 'border-[#e8dce4] bg-white'
  );
  const label = `${table.name} ${TABLE_STATE_LABEL[state]}${callKind ? ` ${serviceCallLabel(callKind)}` : ''}`;

  const body = (
    <>
      <span className="flex w-full items-start justify-between gap-1">
        <b className="min-w-0 truncate text-[15px] leading-tight font-semibold text-[#5e4e5a]">
          {table.name}
        </b>
        {callKind && (
          <span
            className={cn(
              'shrink-0 rounded-full p-0.5 text-white',
              callKind === 'checkout' ? 'bg-[#bd660f]' : 'bg-[#9f2c6c]'
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
        <span className="m-auto text-[9px] text-[#7f6e7a]">
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
      <small className="shrink-0 text-[9px] text-[#7f6e7a]">{label}</small>
      <b
        className={cn(
          'min-w-0 truncate tabular-nums',
          accent
            ? 'text-[15px] font-bold text-[#9f2c6c]'
            : small
              ? 'text-[11px] font-bold text-[#5e4e5a]'
              : 'text-[13px] font-bold text-[#5e4e5a]'
        )}
      >
        {value}
      </b>
    </span>
  );
}
