'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, ChevronRight, RefreshCw, User, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen, formatTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';
import { useNow } from '@/components/floor/use-now';
import {
  callToneByTable,
  elapsedLabel,
  serviceCallLabel,
  sortServiceCalls,
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

export function HandyTableList({
  storeId,
  storeName,
  staffName,
  tables,
  calls,
  serverNow,
  resolveServiceCallAction,
}: {
  storeId: string;
  storeName: string;
  staffName: string;
  tables: HandyTableCard[];
  calls: HandyServiceCall[];
  serverNow: number;
  resolveServiceCallAction: (callId: string) => Promise<{ alreadyResolved: boolean }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const now = useNow(serverNow);
  const [pending, startTransition] = useTransition();
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // 注文・呼び出しは他端末やお客様QRからも増えるため、常に最新を表示する
  useStoreRealtimeRefresh({
    storeId,
    tables: ['orders', 'order_items', 'restaurant_tables', 'service_calls'],
  });

  const sortedCalls = sortServiceCalls(calls);
  const toneByTable = callToneByTable(calls);

  const handleResolve = (call: HandyServiceCall) => {
    if (pending) return;
    setResolvingId(call.id);
    startTransition(async () => {
      try {
        const result = await resolveServiceCallAction(call.id);
        toast(
          result.alreadyResolved
            ? 'この呼び出しは既に対応済みでした'
            : `${call.tableName ?? '卓'} の${serviceCallLabel(call.kind)}を対応済みにしました`,
          result.alreadyResolved ? 'warning' : 'success'
        );
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '対応済みにできませんでした', 'error');
      } finally {
        setResolvingId(null);
      }
    });
  };

  return (
    <div className="pb-4">
      {/* 担当者と更新（承認済みUIの operator バー） */}
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <User className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0">
            <b className="block truncate text-[15px] font-bold leading-tight text-navy">{staffName}</b>
            <span className="block truncate text-[11px] leading-tight text-ink-3">{storeName}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium text-ink-3">
            {tables.length}テーブル<span className="en-inline ml-1 text-[10px]">HANDY</span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.refresh()}
            aria-label="テーブル一覧を更新"
            className="h-9 w-9 p-0"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        </span>
      </div>

      {/* 未対応の呼び出し（時刻順・古い順） */}
      {sortedCalls.length > 0 && (
        <section aria-labelledby="handy-calls" className="mb-4">
          <h2 id="handy-calls" className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy">
            <BellRing className="h-4 w-4 text-saffron" aria-hidden />
            お客様の呼び出し
            <span className="rounded-full bg-saffron px-2 py-0.5 text-[11px] font-bold text-white">
              {sortedCalls.length}件
            </span>
          </h2>
          <ul className="space-y-2">
            {sortedCalls.map((call) => (
              <li
                key={call.id}
                className={cn(
                  'flex items-center gap-2 rounded-xl border-l-4 bg-white p-3 shadow-sm',
                  call.kind === 'checkout'
                    ? 'border-l-saffron bg-saffron-soft'
                    : 'border-l-iris bg-iris-soft/40'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <b className="text-base font-bold text-navy">{call.tableName ?? '—'}</b>
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-xs font-bold',
                        call.kind === 'checkout' ? 'bg-saffron text-white' : 'bg-iris text-white'
                      )}
                    >
                      {serviceCallLabel(call.kind)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-2">
                    {formatTime(new Date(call.createdAtMs))}　{elapsedLabel(call.createdAtMs, now)}経過
                    {call.note ? `　${call.note}` : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant={call.kind === 'checkout' ? 'primary' : 'navy'}
                  className="h-11 shrink-0 px-3"
                  disabled={pending && resolvingId === call.id}
                  onClick={() => handleResolve(call)}
                >
                  {pending && resolvingId === call.id ? '処理中…' : '対応済み'}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tables.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-6 text-center text-sm text-ink-2">
          テーブルが登録されていません。設定画面からフロア・テーブルを登録してください。
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {tables.map((t) => (
            <li key={t.id}>
              <HandyTableTile table={t} now={now} callKind={toneByTable.get(t.id) ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
      href={`/app/handy/${table.id}`}
      className={cn(
        'flex aspect-square w-full flex-col rounded-xl border p-2 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        callKind === 'checkout'
          ? 'border-saffron bg-saffron-soft ring-2 ring-saffron/50'
          : callKind === 'staff'
            ? 'border-iris bg-iris-soft ring-2 ring-iris/40'
            : occupied
              ? 'border-wisteria bg-iris-soft/60'
              : state === 'available'
                ? 'border-line bg-white'
                : 'border-line bg-gray-50'
      )}
      aria-label={`${table.name} ${TABLE_STATE_LABEL[state]}${callKind ? ` ${serviceCallLabel(callKind)}` : ''}`}
    >
      <span className="flex items-start justify-between gap-1">
        <b className="text-[15px] font-bold leading-tight text-royal">{table.name}</b>
        {callKind && (
          <span
            className={cn(
              'shrink-0 rounded-full p-0.5 text-white',
              callKind === 'checkout' ? 'bg-saffron' : 'bg-iris'
            )}
            aria-hidden
          >
            {callKind === 'checkout' ? <Wallet className="h-3.5 w-3.5" /> : <BellRing className="h-3.5 w-3.5" />}
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-[11px] font-medium text-ink-2">
        {TABLE_STATE_LABEL[state]}
        {occupied && table.guestCount > 0 ? ` · ${table.guestCount}名` : ''}
      </span>

      <span className="mt-auto block space-y-0.5">
        {occupied && table.openedAtMs !== null ? (
          <>
            <span className="flex items-baseline justify-between text-[11px] text-ink-3">
              経過
              <b className="text-xs font-bold text-ink">{elapsedLabel(table.openedAtMs, now)}</b>
            </span>
            <span className="flex items-baseline justify-between text-[11px] text-ink-3">
              未会計
              <b className="font-mono text-xs font-bold text-navy">{yen(table.total)}</b>
            </span>
            {table.orderCount > 1 && (
              <span className="block text-right text-[10px] text-ink-3">伝票{table.orderCount}枚</span>
            )}
          </>
        ) : (
          <span className="flex items-center justify-end text-[11px] text-ink-3">
            {table.capacityMax}名席
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </span>
    </Link>
  );
}
