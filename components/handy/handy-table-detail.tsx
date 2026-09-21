'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, ChevronLeft, Plus, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen, formatTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';
import { useNow } from '@/components/floor/use-now';
import {
  elapsedLabel,
  serviceCallLabel,
  sortServiceCalls,
  tableState,
  TABLE_STATE_LABEL,
  type HandyServiceCall,
} from './logic';

export interface HandySlipItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  optionLabel: string | null;
}

export interface HandySlip {
  id: string;
  orderNo: number;
  guestCount: number;
  openedAtMs: number;
  subtotal: number;
  discountTotal: number;
  total: number;
  items: HandySlipItem[];
}

export function HandyTableDetail({
  storeId,
  table,
  slips,
  calls,
  serverNow,
  goToOrderAction,
  resolveServiceCallAction,
}: {
  storeId: string;
  table: { id: string; name: string; capacityMax: number; currentStatus: string | null };
  slips: HandySlip[];
  calls: HandyServiceCall[];
  serverNow: number;
  goToOrderAction: (tableId: string) => Promise<{ orderId: string }>;
  resolveServiceCallAction: (callId: string) => Promise<{ alreadyResolved: boolean }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const now = useNow(serverNow);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  useStoreRealtimeRefresh({
    storeId,
    tables: ['orders', 'order_items', 'restaurant_tables', 'service_calls'],
  });

  const state = tableState(table.currentStatus, slips.length > 0);
  const totalAmount = slips.reduce((n, s) => n + s.total, 0);
  const guestCount = slips.reduce((n, s) => n + s.guestCount, 0);
  const openedAtMs = slips.length > 0 ? Math.min(...slips.map((s) => s.openedAtMs)) : null;

  /** 伝票が無い卓で注文を開始する（既存のフロア画面と同じサーバーアクションを使う） */
  const handleStart = () => {
    if (pending) return;
    setBusy('start');
    startTransition(async () => {
      try {
        const { orderId } = await goToOrderAction(table.id);
        router.push(`/app/handy/${table.id}/order?order=${orderId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : '注文を開始できませんでした', 'error');
        setBusy(null);
      }
    });
  };

  const handleResolve = (call: HandyServiceCall) => {
    if (pending) return;
    setBusy(call.id);
    startTransition(async () => {
      try {
        const result = await resolveServiceCallAction(call.id);
        toast(
          result.alreadyResolved ? 'この呼び出しは既に対応済みでした' : '対応済みにしました',
          result.alreadyResolved ? 'warning' : 'success'
        );
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '対応済みにできませんでした', 'error');
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <div className="pb-28">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link
          href="/app/handy"
          className="-ml-1 inline-flex items-center gap-0.5 rounded-lg px-1 py-2 text-sm font-medium text-ink-2 hover:text-navy"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
          テーブル一覧
        </Link>
        <span className="text-xs font-medium text-ink-3">{TABLE_STATE_LABEL[state]}</span>
      </div>

      <div className="mb-3 rounded-xl border border-line bg-white p-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-navy">{table.name}</h1>
          <span className="text-sm text-ink-2">
            {slips.length > 0 ? `${guestCount}名` : `${table.capacityMax}名席`}
          </span>
          {openedAtMs !== null && (
            <span className="text-sm text-ink-2">
              {formatTime(new Date(openedAtMs))}〜　経過 {elapsedLabel(openedAtMs, now)}
            </span>
          )}
        </div>
        {slips.length > 0 && (
          <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
            <span className="text-sm font-medium text-ink-2">
              未会計合計<span className="en-inline text-[10px]">Unpaid</span>
            </span>
            <b className="font-mono text-2xl font-bold text-navy">{yen(totalAmount)}</b>
          </div>
        )}
      </div>

      {calls.length > 0 && (
        <ul className="mb-3 space-y-2">
          {sortServiceCalls(calls).map((call) => (
            <li
              key={call.id}
              className={cn(
                'flex items-center gap-2 rounded-xl border-l-4 p-3',
                call.kind === 'checkout'
                  ? 'border-l-saffron bg-saffron-soft'
                  : 'border-l-iris bg-iris-soft/50'
              )}
            >
              <BellRing className="h-4 w-4 shrink-0 text-saffron" aria-hidden />
              <span className="min-w-0 flex-1 text-sm">
                <b className="font-bold text-navy">{serviceCallLabel(call.kind)}</b>
                <span className="ml-2 text-xs text-ink-2">
                  {formatTime(new Date(call.createdAtMs))}　{elapsedLabel(call.createdAtMs, now)}経過
                </span>
              </span>
              <Button
                size="sm"
                variant={call.kind === 'checkout' ? 'primary' : 'navy'}
                className="h-11 shrink-0"
                disabled={pending && busy === call.id}
                onClick={() => handleResolve(call)}
              >
                {pending && busy === call.id ? '処理中…' : '対応済み'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {slips.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-6 text-center">
          <p className="text-sm text-ink-2">この卓に未会計の注文はありません。</p>
          <p className="mt-1 text-xs text-ink-3">
            注文を開始すると、この卓に新しい伝票を作ります（人数は後からレジで変更できます）。
          </p>
          <Button className="mt-4 h-12 w-full" disabled={pending} onClick={handleStart}>
            {pending && busy === 'start' ? '開始中…' : '注文を開始'}
          </Button>
          <Link
            href="/app/floor"
            className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
          >
            人数を指定して着席する（フロア画面）
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {slips.map((slip) => (
            <section key={slip.id} className="overflow-hidden rounded-xl border border-line bg-white">
              <header className="flex items-center justify-between border-b border-line bg-lilac-soft px-3 py-2">
                <span className="flex items-center gap-1.5 text-sm font-bold text-navy">
                  <Receipt className="h-4 w-4 text-ink-3" aria-hidden />
                  伝票 #{slip.orderNo}
                </span>
                <span className="text-xs text-ink-2">{slip.guestCount}名</span>
              </header>
              {slip.items.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-ink-3">まだ注文はありません。</p>
              ) : (
                <ul className="divide-y divide-line">
                  {slip.items.map((item) => (
                    <li key={item.id} className="flex items-start gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-navy">{item.name}</span>
                        {item.optionLabel && (
                          <span className="block text-xs text-ink-3">{item.optionLabel}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm text-ink-2">×{item.quantity}</span>
                      <span className="w-20 shrink-0 text-right font-mono text-sm font-bold text-navy">
                        {yen(item.lineTotal)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-baseline justify-between border-t border-line px-3 py-2">
                <span className="text-xs text-ink-2">
                  小計 {yen(slip.subtotal)}
                  {slip.discountTotal > 0 ? `　値引 -${yen(slip.discountTotal)}` : ''}
                </span>
                <b className="font-mono text-base font-bold text-navy">{yen(slip.total)}</b>
              </div>
              <div className="border-t border-line p-2">
                <Link
                  href={`/app/handy/${table.id}/order?order=${slip.id}`}
                  className="flex h-12 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-base font-bold text-white hover:bg-primary-deep"
                >
                  <Plus className="h-5 w-5" aria-hidden />
                  注文を追加
                </Link>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
