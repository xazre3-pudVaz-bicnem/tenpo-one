'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleCheckBig, Clock, Minus, Printer, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen, formatTime } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useNow } from '@/components/floor/use-now';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GuestCountDialog } from '@/components/pos/guest-count-dialog';
import { canHandyCancel, HANDY_EXTEND_OPTIONS, handyCancelSecondsLeft } from '@/lib/handy-cancel';
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
  groupOrderRounds,
  ordinalLabel,
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
  /** 厨房へ送った時刻（注文の回 1st・2nd… に使う。未送信は null） */
  sentAtMs: number | null;
  /** 伝票に入れた時刻（送信済みなら送った時刻）。5分以内なら − で取り消せる */
  orderedAtMs: number;
}

export interface HandySlip {
  id: string;
  orderNo: number;
  guestCount: number;
  openedAtMs: number;
  subtotal: number;
  discountTotal: number;
  total: number;
  /** 席の終了予定（時間制の卓。無ければ null） */
  endsAtMs: number | null;
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
  setGuestCountAction,
  extendStayAction,
  cancelItemAction,
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
  /** 人数変更（2026-10-18 Ronnie「ハンディでも人数変更・時間延長」） */
  setGuestCountAction?: (orderId: string, guestCount: number) => Promise<void>;
  extendStayAction?: (orderId: string, minutes: number) => Promise<{ endsAt: string }>;
  /** 送ってから5分以内の品を1つ取り消す（伝票ごとの取消はハンディではできない） */
  cancelItemAction?: (orderId: string, orderItemId: string) => Promise<{ quantity: number }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const now = useNow(serverNow);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [guestSlip, setGuestSlip] = useState<HandySlip | null>(null);
  const [extendSlip, setExtendSlip] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ slipId: string; item: HandySlipItem } | null>(null);

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

  /** 時間延長（+30分など）。延長料金はメニューの「延長」（金額を打つ）で入れる */
  const handleExtend = (slip: HandySlip, minutes: number) => {
    if (pending || !extendStayAction) return;
    setBusy(`extend:${slip.id}`);
    startTransition(async () => {
      try {
        const { endsAt } = await extendStayAction(slip.id, minutes);
        toast(`${minutes}分延長しました（〜${formatTime(new Date(endsAt))}）`, 'success');
        setExtendSlip(null);
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '延長できませんでした', 'error');
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
                    ? 'border-l-[#b7791f] bg-[#fbf1d9]'
                    : 'border-l-[#bc5940] bg-[#f3efe8]'
                )}
              >
                <p className="flex items-baseline justify-between gap-2 text-sm">
                  <b className="font-bold text-[#45403b]">{serviceCallLabel(call.kind)}</b>
                  <span className="text-[11px] text-[#766b62]">
                    {formatTime(new Date(call.createdAtMs))}
                    {elapsedLabel(call.createdAtMs, now)}経過
                  </span>
                </p>
                {/* お客様QRの「サービス」で頼まれたもの（お水×2・お箸×2） */}
                {call.note && <p className="mt-1 text-[16px] leading-snug font-extrabold text-[#bc5940]">{call.note}</p>}
                <button
                  type="button"
                  className="mt-2 min-h-[40px] w-full rounded-[9px] bg-[#bc5940] text-sm font-bold text-white disabled:opacity-40"
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
          <div className="m-3 rounded-[10px] border border-[#e5dfd5] bg-white p-3.5">
            <p className="text-center text-[13px] text-[#766b62]">
              この卓に未会計の注文はありません。
            </p>
            {canStartOrder(state) ? (
              state !== 'occupied' && (
                <p className="mt-3 text-center text-[10px] leading-relaxed text-[#766b62]">
                  「注文を開始」で人数・モード（飲み放題など）・時間制を入力し、
                  この卓を着席にして新しい伝票を作ります。
                </p>
              )
            ) : (
              <p className="mt-2 text-center text-[11px] text-[#766b62]">
                {TABLE_STATE_LABEL[state]}の卓には注文を作れません。フロア画面で状態を変更してください。
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="mx-3 mt-2.5 flex items-baseline justify-between text-[13px] text-[#766b62]">
              未会計合計
              <b className="text-[23px] font-bold text-[#45403b] tabular-nums">{yen(totalAmount)}</b>
            </p>
            {slips.map((slip) => (
              <section
                key={slip.id}
                className="m-3 rounded-[10px] border border-[#e5dfd5] bg-white p-3.5"
              >
                <h2 className="flex items-baseline justify-between text-sm font-bold text-[#45403b]">
                  伝票 #{slip.orderNo}
                  <span className="text-[11px] font-normal text-[#766b62]">
                    {slip.guestCount}名 · {formatTime(new Date(slip.openedAtMs))}〜
                    {slip.endsAtMs != null && `${formatTime(new Date(slip.endsAtMs))}`}
                  </span>
                </h2>
                {/* 人数変更・時間延長（英語も並べる。2026-10-18 Ronnie） */}
                {(setGuestCountAction || extendStayAction) && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {setGuestCountAction && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setGuestSlip(slip)}
                        className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-[9px] border border-[#d4b3a3] bg-[#fbf9f5] text-[12px] font-bold text-[#8a3f2c] active:bg-[#f6e4da] disabled:opacity-40"
                      >
                        <Users className="h-4 w-4" aria-hidden />
                        人数変更 / GUESTS
                      </button>
                    )}
                    {extendStayAction && (
                      <button
                        type="button"
                        disabled={pending}
                        aria-expanded={extendSlip === slip.id}
                        onClick={() => setExtendSlip((cur) => (cur === slip.id ? null : slip.id))}
                        className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-[9px] border border-[#d4b3a3] bg-[#fbf9f5] text-[12px] font-bold text-[#8a3f2c] active:bg-[#f6e4da] disabled:opacity-40"
                      >
                        <Clock className="h-4 w-4" aria-hidden />
                        時間延長 / EXTEND
                      </button>
                    )}
                  </div>
                )}
                {extendSlip === slip.id && extendStayAction && (
                  <div className="mt-2 rounded-[9px] bg-[#f3efe8] p-2">
                    <p className="mb-1.5 text-[11px] text-[#766b62]">
                      延長する時間 / Extend by（延長料金はメニューの「延長」で入れてください）
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {HANDY_EXTEND_OPTIONS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          disabled={pending}
                          onClick={() => handleExtend(slip, m)}
                          className="min-h-[40px] rounded-[8px] bg-[#bc5940] text-[13px] font-bold text-white active:bg-[#9f4630] disabled:opacity-40"
                        >
                          {pending && busy === `extend:${slip.id}` ? '…' : `+${m}分`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {slip.items.length === 0 ? (
                  <p className="py-4 text-center text-[13px] text-[#766b62]">まだ注文はありません。</p>
                ) : (
                  // 注文の回ごと（左に 1st・2nd・3rd…。2026-09-30 Ronnie）
                  <div className="mt-1 divide-y divide-dashed divide-[#e5dfd5]">
                    {groupOrderRounds(slip.items).map((round) => (
                      <div key={round.index ?? 'unsent'} className="flex gap-2.5 py-2">
                        <div className="w-11 shrink-0 pt-0.5 text-center">
                          <span
                            className={cn(
                              'block rounded-md py-1 text-[12px] leading-none font-extrabold',
                              round.index == null ? 'bg-[#fbf1d9] text-[#8a4a0b]' : 'bg-[#f3efe8] text-[#bc5940]'
                            )}
                          >
                            {round.index == null ? '未送信' : ordinalLabel(round.index)}
                          </span>
                          {round.sentAtMs != null && (
                            <small className="mt-0.5 block text-[9px] text-[#766b62] tabular-nums">
                              {formatTime(new Date(round.sentAtMs))}
                            </small>
                          )}
                        </div>
                        <ul className="min-w-0 flex-1">
                          {round.items.map((item) => (
                            <li
                              key={item.id}
                              className="my-1 flex items-baseline justify-between gap-2 text-xs"
                            >
                              <span className="min-w-0">
                                <span className="block text-[#292725]">
                                  {item.name}
                                  <span className="ml-1.5 text-[#766b62]">×{item.quantity}</span>
                                </span>
                                {item.optionLabel && (
                                  <small className="block text-[9px] text-[#766b62]">
                                    {item.optionLabel}
                                  </small>
                                )}
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                <b className="font-bold text-[#45403b] tabular-nums">{yen(item.lineTotal)}</b>
                                {/* 送ってから5分以内は − で1つ取り消せる（2026-10-18 Ronnie。伝票ごとの取消はレジで） */}
                                {cancelItemAction && canHandyCancel(item.orderedAtMs, now) && (
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => setCancelTarget({ slipId: slip.id, item })}
                                    aria-label={`${item.name}を1つ取り消す（あと${handyCancelSecondsLeft(item.orderedAtMs, now)}秒）`}
                                    className="flex h-8 min-w-8 flex-col items-center justify-center rounded-[6px] border border-[#c62828] px-1 text-[#c62828] active:bg-[#fdecec] disabled:opacity-40"
                                  >
                                    <Minus className="h-4 w-4" aria-hidden />
                                    {/* 時計は30秒ごとに進むので分で出す */}
                                    <span className="text-[8px] leading-none tabular-nums">
                                      {Math.max(1, Math.ceil(handyCancelSecondsLeft(item.orderedAtMs, now) / 60))}分
                                    </span>
                                  </button>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                <strong className="mt-2 block border-t border-[#e5dfd5] pt-2 text-right text-lg font-bold text-[#45403b] tabular-nums">
                  {yen(slip.total)}
                </strong>
                {printBillAction && slip.items.length > 0 && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handlePrintBill(slip)}
                    className="mt-2.5 flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-[9px] border border-[#b7791f] bg-[#fbf1d9] text-sm font-bold text-[#8a4a0b] active:bg-[#f6e0c4] disabled:opacity-40"
                  >
                    <Printer className="h-4 w-4" aria-hidden />
                    {pending && busy === `bill:${slip.id}` ? '印刷中… / Printing…' : '会計伝票を出す / PRINT BILL'}
                  </button>
                )}
                {slips.length > 1 && (
                  <Link
                    href={`/handy/${table.id}/order?order=${slip.id}`}
                    className="mt-2.5 flex min-h-[42px] items-center justify-center rounded-[9px] border border-[#bc5940] text-sm font-bold text-[#bc5940]"
                  >
                    この伝票に注文を追加 / ADD ORDER
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
              ? '開始中… / Starting…'
              : // 英語も並べる（日本語を読まないスタッフ向け。2026-10-18 Ronnie）
                slips.length > 0
                ? '注文を追加 / ADD ORDER'
                : '注文を開始 / START ORDER'
          }
          disabled={pending}
          onClick={handleStart}
        />
      )}

      {guestSlip && setGuestCountAction && (
        <GuestCountDialog
          open
          onClose={() => {
            setGuestSlip(null);
            router.refresh();
          }}
          orderId={guestSlip.id}
          currentGuestCount={guestSlip.guestCount}
          setGuestCountAction={setGuestCountAction}
        />
      )}

      {cancelTarget && cancelItemAction && (
        <ConfirmDialog
          open
          onClose={() => setCancelTarget(null)}
          title="1つ取り消す / Cancel one"
          message={`「${cancelTarget.item.name}」を1つ取り消します（いま ${cancelTarget.item.quantity}点）。厨房に取消が出ます。`}
          confirmLabel="取り消す / Cancel"
          onConfirm={async () => {
            try {
              const r = await cancelItemAction(cancelTarget.slipId, cancelTarget.item.id);
              toast(
                r.quantity > 0
                  ? `「${cancelTarget.item.name}」を1つ取り消しました（残り${r.quantity}点）`
                  : `「${cancelTarget.item.name}」を取り消しました`,
                'success'
              );
              router.refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : '取り消せませんでした', 'error');
            }
            setCancelTarget(null);
          }}
        />
      )}
    </>
  );
}
