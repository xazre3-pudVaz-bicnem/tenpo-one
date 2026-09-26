'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleCheckBig, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen, formatTime } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useNow } from '@/components/floor/use-now';
import {
  HandyBackButton,
  HandyFooterButton,
  HandyMain,
  HandyOperatorBar,
  HandyTopBar,
} from './handy-chrome';
import {
  canStartOrder,
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

/**
 * 卓の伝票画面（テーブル一覧 → 卓）。
 * 注文の追加・開始と、この卓への呼び出しへの対応をここから行う。
 */
export function HandyTableDetail({
  table,
  staffName,
  slips,
  calls,
  serverNow,
  sentQuantity,
  goToOrderAction,
  resolveServiceCallAction,
  printBillAction,
}: {
  table: { id: string; name: string; capacityMax: number; currentStatus: string | null };
  staffName: string;
  slips: HandySlip[];
  calls: HandyServiceCall[];
  serverNow: number;
  /** 直前の送信で厨房に送れた点数（注文確認画面から戻ってきた直後だけ入る） */
  sentQuantity: number | null;
  /** 着席中の卓に伝票を作る（フロア画面と同じ） */
  goToOrderAction: (tableId: string) => Promise<{ orderId: string }>;
  resolveServiceCallAction: (callId: string) => Promise<{ alreadyResolved: boolean }>;
  /** 会計伝票（中間伝票）をプリンターへ出す（レジの「伝票印刷」と同じ）。省略時はボタンを出さない */
  printBillAction?: (orderId: string) => Promise<{ ok: boolean; error?: string; queued?: number }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const now = useNow(serverNow);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const state = tableState(table.currentStatus, slips.length > 0);
  const totalAmount = slips.reduce((n, s) => n + s.total, 0);
  const guestCount = slips.reduce((n, s) => n + s.guestCount, 0);
  const openedAtMs = slips.length > 0 ? Math.min(...slips.map((s) => s.openedAtMs)) : null;

  /**
   * 伝票が無い卓で注文を開始する。
   * 空席なら「お客様情報」（人数・モード・時間制）を入力してから着席させる（承認済みレイアウトの setup）。
   * 着席中なら既存のフロア画面と同じサーバーアクションで伝票を開く（無ければ作る）。
   */
  const handleStart = () => {
    if (pending) return;
    if (state !== 'occupied') {
      router.push(`/handy/${table.id}/setup`);
      return;
    }
    setBusy('start');
    startTransition(async () => {
      try {
        const { orderId } = await goToOrderAction(table.id);
        router.push(`/handy/${table.id}/order?order=${orderId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : '注文を開始できませんでした', 'error');
        setBusy(null);
      }
    });
  };

  /**
   * 会計伝票を出す（2026-09-22 店舗要望: ハンディからも会計伝票を出したい）。
   * レジの「伝票印刷」と同じ中間伝票。卓のフロア担当のプリンター（無ければレジ機）から出る。
   * 会計・売上には影響しない。
   */
  const handlePrintBill = (slip: HandySlip) => {
    if (pending || !printBillAction) return;
    if (slip.items.length === 0) {
      toast('まだ注文がないため、会計伝票は出せません', 'warning');
      return;
    }
    setBusy(`bill:${slip.id}`);
    startTransition(async () => {
      try {
        const result = await printBillAction(slip.id);
        if (result.ok) toast(`会計伝票 #${slip.orderNo} を印刷しました`, 'success');
        else toast(result.error ?? '会計伝票を印刷できませんでした', 'error');
      } catch (e) {
        toast(e instanceof Error ? e.message : '会計伝票を印刷できませんでした', 'error');
      } finally {
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

  const note = [
    slips.length > 0 ? `${guestCount}名` : `${table.capacityMax}名席`,
    openedAtMs !== null ? `${formatTime(new Date(openedAtMs))}〜 ${elapsedLabel(openedAtMs, now)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <HandyTopBar
        left={<HandyBackButton href="/handy" label="テーブル一覧" />}
        title={table.name}
      />
      <HandyOperatorBar label={`${table.name} · ${note}`} note={staffName} showIcon={false} />

      <HandyMain>
        {sentQuantity !== null && (
          <p
            role="status"
            className="mx-3 mt-2 flex items-center gap-2 rounded-[10px] border border-[#9bd9bd] bg-[#dff3ea] px-3 py-2.5 text-[13px] font-bold text-[#1e6b4d]"
          >
            <CircleCheckBig className="h-[18px] w-[18px] shrink-0" aria-hidden />
            厨房に送信しました（{sentQuantity}点）
          </p>
        )}

        {calls.length > 0 && (
          <ul className="mx-3 mt-2.5 space-y-2">
            {sortServiceCalls(calls).map((call) => (
              <li
                key={call.id}
                className={cn(
                  'rounded-[10px] border-l-4 p-3',
                  call.kind === 'checkout'
                    ? 'border-l-[#bd660f] bg-[#fbefdf]'
                    : 'border-l-[#9f2c6c] bg-[#f3ecf1]'
                )}
              >
                <p className="flex items-baseline justify-between gap-2 text-sm">
                  <b className="font-bold text-[#4a3444]">{serviceCallLabel(call.kind)}</b>
                  <span className="text-[11px] text-[#7f6e7a]">
                    {formatTime(new Date(call.createdAtMs))}
                    {elapsedLabel(call.createdAtMs, now)}経過
                  </span>
                </p>
                <button
                  type="button"
                  className="mt-2 min-h-[40px] w-full rounded-[9px] bg-[#9f2c6c] text-sm font-bold text-white disabled:opacity-40"
                  disabled={pending}
                  onClick={() => handleResolve(call)}
                >
                  {pending && busy === call.id ? '処理中…' : '対応済みにする'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {slips.length === 0 ? (
          <div className="m-3 rounded-[10px] border border-[#e8dce4] bg-white p-3.5">
            <p className="text-center text-[13px] text-[#7f6e7a]">
              この卓に未会計の注文はありません。
            </p>
            {canStartOrder(state) ? (
              state !== 'occupied' && (
                <p className="mt-3 text-center text-[10px] leading-relaxed text-[#7f6e7a]">
                  「注文を開始」で人数・モード（飲み放題など）・時間制を入力し、
                  この卓を着席にして新しい伝票を作ります。
                </p>
              )
            ) : (
              <p className="mt-2 text-center text-[11px] text-[#7f6e7a]">
                {TABLE_STATE_LABEL[state]}の卓には注文を作れません。フロア画面で状態を変更してください。
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="mx-3 mt-2.5 flex items-baseline justify-between text-[13px] text-[#7f6e7a]">
              未会計合計
              <b className="text-[23px] font-bold text-[#4a3444] tabular-nums">{yen(totalAmount)}</b>
            </p>
            {slips.map((slip) => (
              <section
                key={slip.id}
                className="m-3 rounded-[10px] border border-[#e8dce4] bg-white p-3.5"
              >
                <h2 className="flex items-baseline justify-between text-sm font-bold text-[#4a3444]">
                  伝票 #{slip.orderNo}
                  <span className="text-[11px] font-normal text-[#7f6e7a]">
                    {slip.guestCount}名 · {formatTime(new Date(slip.openedAtMs))}〜
                  </span>
                </h2>
                {slip.items.length === 0 ? (
                  <p className="py-4 text-center text-[13px] text-[#7f6e7a]">まだ注文はありません。</p>
                ) : (
                  <ul>
                    {slip.items.map((item) => (
                      <li
                        key={item.id}
                        className="my-2.5 flex items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0">
                          <span className="block text-[#2a1f2e]">
                            {item.name}
                            <span className="ml-1.5 text-[#7f6e7a]">×{item.quantity}</span>
                          </span>
                          {item.optionLabel && (
                            <small className="block text-[9px] text-[#7f6e7a]">
                              {item.optionLabel}
                            </small>
                          )}
                        </span>
                        <b className="shrink-0 font-bold text-[#4a3444] tabular-nums">
                          {yen(item.lineTotal)}
                        </b>
                      </li>
                    ))}
                  </ul>
                )}
                <strong className="mt-2 block border-t border-[#e8dce4] pt-2 text-right text-lg font-bold text-[#4a3444] tabular-nums">
                  {yen(slip.total)}
                </strong>
                {printBillAction && slip.items.length > 0 && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handlePrintBill(slip)}
                    className="mt-2.5 flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-[9px] border border-[#bd660f] bg-[#fbefdf] text-sm font-bold text-[#8a4a0b] active:bg-[#f6e0c4] disabled:opacity-40"
                  >
                    <Printer className="h-4 w-4" aria-hidden />
                    {pending && busy === `bill:${slip.id}` ? '印刷中…' : '会計伝票を出す'}
                  </button>
                )}
                {slips.length > 1 && (
                  <Link
                    href={`/handy/${table.id}/order?order=${slip.id}`}
                    className="mt-2.5 flex min-h-[42px] items-center justify-center rounded-[9px] border border-[#9f2c6c] text-sm font-bold text-[#9f2c6c]"
                  >
                    この伝票に注文を追加
                  </Link>
                )}
              </section>
            ))}
          </>
        )}
      </HandyMain>

      {canStartOrder(state) && (
        <HandyFooterButton
          label={
            pending && busy === 'start'
              ? '開始中…'
              : slips.length > 0
                ? '注文を追加'
                : '注文を開始'
          }
          disabled={pending}
          onClick={handleStart}
        />
      )}
    </>
  );
}
