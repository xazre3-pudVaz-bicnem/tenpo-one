'use client';

import Link from 'next/link';
import { BellRing, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen, formatTime } from '@/lib/format';
import { useNow } from '@/components/floor/use-now';
import {
  callToneByTable,
  elapsedLabel,
  serviceCallLabel,
  tableState,
  TABLE_STATE_LABEL,
  type HandyServiceCall,
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
}: {
  tables: HandyTableCard[];
  calls: HandyServiceCall[];
  serverNow: number;
}) {
  const now = useNow(serverNow);
  const toneByTable = callToneByTable(calls);

  if (tables.length === 0) {
    return (
      <p className="px-6 py-9 text-center text-[13px] leading-loose text-[#8a769d]">
        テーブルが登録されていません。
        <br />
        設定画面からフロア・テーブルを登録してください。
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-3 content-start gap-2 px-2 pt-1.5 pb-2.5 sm:grid-cols-4 lg:grid-cols-6">
      {tables.map((t) => (
        <li key={t.id}>
          <HandyTableTile table={t} now={now} callKind={toneByTable.get(t.id) ?? null} />
        </li>
      ))}
    </ul>
  );
}

function HandyTableTile({
  table,
  now,
  callKind,
}: {
  table: HandyTableCard;
  now: number;
  callKind: 'staff' | 'checkout' | null;
}) {
  const state = tableState(table.currentStatus, table.orderCount > 0);
  const occupied = state === 'occupied';

  return (
    <Link
      href={`/handy/${table.id}`}
      className={cn(
        'flex aspect-square w-full flex-col items-start rounded-[10px] border p-2 text-left shadow-[0_2px_5px_#24143605]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7b3fe4]',
        callKind === 'checkout'
          ? 'border-[#bd660f] bg-[#fbefdf]'
          : callKind === 'staff'
            ? 'border-[#7b3fe4] bg-[#f3ecfe]'
            : occupied
              ? 'border-[#cdb4ef] bg-[#efeaf8]'
              : state === 'blocked'
                ? 'border-[#c9c4d2] bg-[#e4e0ea]'
                : 'border-[#e3dbf1] bg-white'
      )}
      aria-label={`${table.name} ${TABLE_STATE_LABEL[state]}${callKind ? ` ${serviceCallLabel(callKind)}` : ''}`}
    >
      <span className="flex w-full items-start justify-between gap-1">
        <b className="min-w-0 truncate text-[15px] leading-tight font-semibold text-[#5e4777]">
          {table.name}
        </b>
        {callKind && (
          <span
            className={cn(
              'shrink-0 rounded-full p-0.5 text-white',
              callKind === 'checkout' ? 'bg-[#bd660f]' : 'bg-[#7b3fe4]'
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
        <span className="m-auto text-[9px] text-[#8a769d]">
          {state === 'available' ? `${table.capacityMax}名席` : TABLE_STATE_LABEL[state]}
        </span>
      )}
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
      <small className="shrink-0 text-[9px] text-[#8a769d]">{label}</small>
      <b
        className={cn(
          'min-w-0 truncate tabular-nums',
          accent
            ? 'text-[15px] font-bold text-[#7b3fe4]'
            : small
              ? 'text-[11px] font-bold text-[#5e4777]'
              : 'text-[13px] font-bold text-[#5e4777]'
        )}
      >
        {value}
      </b>
    </span>
  );
}
