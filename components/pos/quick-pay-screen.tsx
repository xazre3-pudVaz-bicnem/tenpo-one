'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, Minus, Plus, ShoppingBag, UtensilsCrossed, X, Wallet } from 'lucide-react';
import { TakeoutRow } from '@/components/layout/takeout-row';
import { QUICK_PAY_MAX_QUANTITY, type QuickPayLine } from '@/lib/quick-pay';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { Tenkey, appendTenkeyDigit, appendTenkeyDoubleZero, type TenkeyKey } from '@/components/pos/tenkey';
import { HandyOrderScreen } from '@/components/handy/handy-order-screen';
import type { HandyMenuData } from '@/lib/handy-menu-server';
import type { HandyOrderLineInput, HandySubmitResult } from '@/app/app/handy/actions';

export interface QuickPayOrderedLine {
  id: string;
  name: string;
  quantity: number;
  lineTotal: number;
  /** 電卓で入れた金額の明細（メニューに無い） */
  isAmount: boolean;
}

/**
 * 即会計（電卓のレジ）。金額を打って「追加」→ 伝票の行、「会計する」でいつもの会計画面へ。
 * 「×」で個数も入れられる（530 × 2 → ¥1,060。2026-09-30 Ronnie）。
 * 右上の「メニュー選択」はハンディと同じメニュー（ポップアップ）。選んだ商品は注文として厨房へ送る。
 * 2026-09-30 Ronnie「手書き伝票の合計だけで会計するお店のため。電卓レジのように金額で会計。ほかの会計は同じ」。
 */
export function QuickPayScreen({
  staffName,
  lineName,
  order,
  menu,
  startOrderAction,
  prepareCheckoutAction,
  submitMenuAction,
}: {
  staffName: string;
  lineName: string;
  /** 「メニュー選択」で作った伝票（まだ無ければ null） */
  order: { id: string; orderNo: number; guestCount: number; lines: QuickPayOrderedLine[] } | null;
  menu: HandyMenuData;
  startOrderAction: (guestCount: number) => Promise<{ orderId: string }>;
  prepareCheckoutAction: (input: {
    orderId: string | null;
    guestCount: number;
    lines: QuickPayLine[];
  }) => Promise<{ orderId?: string; error?: string }>;
  submitMenuAction: (orderId: string, lines: HandyOrderLineInput[]) => Promise<HandySubmitResult>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  /** いま打っている数（「×」の後は個数） */
  const [amount, setAmount] = useState(0);
  /** 「×」を押したときの単価（押していなければ null） */
  const [unit, setUnit] = useState<number | null>(null);
  const [lines, setLines] = useState<QuickPayLine[]>([]);
  const [guests, setGuests] = useState(order?.guestCount ?? 1);
  const [wantMenu, setWantMenu] = useState(false);

  const orderedTotal = (order?.lines ?? []).reduce((a, l) => a + l.lineTotal, 0);
  const linesTotal = lines.reduce((a, l) => a + l.amount * l.quantity, 0);
  /** 打っている途中の行（「追加」を押さずに会計しても入る） */
  const pendingLine: QuickPayLine | null =
    unit != null
      ? { amount: unit, quantity: Math.min(QUICK_PAY_MAX_QUANTITY, Math.max(1, amount)) }
      : amount > 0
        ? { amount, quantity: 1 }
        : null;
  const pendingTotal = pendingLine ? pendingLine.amount * pendingLine.quantity : 0;
  const total = orderedTotal + linesTotal + pendingTotal;

  const onKey = (k: TenkeyKey) => {
    if (k === 'C') {
      // 打っている数を消す。何も打っていなければ「×」も取り消す
      if (amount > 0) setAmount(0);
      else setUnit(null);
      return;
    }
    const next = k === '00' ? appendTenkeyDoubleZero(amount) : appendTenkeyDigit(amount, k);
    // 個数は 99 まで
    setAmount(unit != null ? Math.min(QUICK_PAY_MAX_QUANTITY, next) : next);
  };

  /** 「×」: 打った金額を単価にして、続けて個数を打つ */
  const times = () => {
    if (unit != null || amount <= 0) return;
    setUnit(amount);
    setAmount(0);
  };

  const addLine = () => {
    if (!pendingLine) return;
    setLines((prev) => [...prev, pendingLine]);
    setAmount(0);
    setUnit(null);
  };

  const openMenu = () => {
    if (order) {
      setWantMenu(true);
      return;
    }
    startTransition(async () => {
      try {
        const { orderId } = await startOrderAction(guests);
        setWantMenu(true);
        router.replace(`/app/quick-pay?order=${orderId}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : '伝票を作れませんでした', 'error');
      }
    });
  };

  const checkout = () => {
    const allLines = pendingLine ? [...lines, pendingLine] : lines;
    if (allLines.length === 0 && orderedTotal <= 0) {
      toast('金額を入れてください / Enter an amount', 'error');
      return;
    }
    startTransition(async () => {
      const res = await prepareCheckoutAction({ orderId: order?.id ?? null, guestCount: guests, lines: allLines });
      if (res.error || !res.orderId) {
        toast(res.error ?? '会計に進めませんでした', 'error');
        return;
      }
      setLines([]);
      setAmount(0);
      setUnit(null);
      // ここからはいつもの会計（支払方法・お預かり・お釣り・レシート・ドロア）
      router.push(`/app/pos?order=${res.orderId}&checkout=1`);
    });
  };

  const menuVisible = wantMenu && order != null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-navy">
          <Calculator className="h-6 w-6 text-iris" aria-hidden />
          即会計
          <span className="text-xs font-semibold text-ink-3">Quick pay</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
        {/* テイクアウト（持ち帰りの伝票を作って注文画面へ）。テーブル一覧の上から移した（2026-09-30 Ronnie「メニュー選択の左に」） */}
        <TakeoutRow className="tap3d inline-flex h-11 items-center gap-1.5 rounded-xl border-2 border-line bg-white px-4 text-[14px] font-bold text-royal disabled:opacity-60">
          <ShoppingBag className="h-4 w-4" aria-hidden />
          テイクアウト
          <span className="text-[10px] font-semibold text-ink-3">Take out</span>
        </TakeoutRow>
        {/* 右上：メニュー選択（ハンディと同じメニュー。選んだ商品は注文として厨房へ） */}
        <button
          type="button"
          onClick={openMenu}
          disabled={pending}
          className="tap3d inline-flex h-11 items-center gap-1.5 rounded-xl bg-plum px-4 text-[14px] font-bold text-white disabled:opacity-60"
        >
          <UtensilsCrossed className="h-4 w-4" aria-hidden />
          メニュー選択
          <span className="text-[10px] font-semibold opacity-70">Menu</span>
        </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        {/* 電卓 */}
        <section aria-label="電卓" className="rounded-2xl border border-line bg-white p-4 shadow-sm">
          <div className="mb-3 rounded-xl bg-plum px-4 py-3 text-right text-white">
            <p className="text-[11px] text-white/60">
              {unit != null ? '個数を入れてください / Quantity' : '金額（税込） / Amount'}
            </p>
            {unit != null ? (
              <p className="text-4xl font-extrabold tabular-nums">
                {yen(unit)}
                <span className="mx-2 text-white/60">×</span>
                {amount > 0 ? amount : <span className="text-white/40">_</span>}
                <span className="ml-3 text-2xl text-white/70">= {yen(pendingTotal)}</span>
              </p>
            ) : (
              <p className="text-4xl font-extrabold tabular-nums">{yen(amount)}</p>
            )}
          </div>
          <Tenkey onKey={onKey} disabled={pending} />
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            {/* ×：530 × 2 のように個数を入れる */}
            <button
              type="button"
              onClick={times}
              disabled={pending || unit != null || amount <= 0}
              aria-label="かける（個数）"
              className="tap3d flex h-14 items-center justify-center gap-1.5 rounded-xl border-2 border-line bg-white text-2xl font-bold text-navy disabled:opacity-40"
            >
              ×<span className="text-xs font-semibold text-ink-3">個数 Qty</span>
            </button>
            <button
              type="button"
              onClick={addLine}
              disabled={pending || !pendingLine}
              className="tap3d flex h-14 items-center justify-center gap-2 rounded-xl border-2 border-iris bg-iris-soft text-lg font-bold text-royal disabled:opacity-50"
            >
              <Plus className="h-5 w-5" aria-hidden />
              追加
              <span className="text-xs font-semibold text-ink-3">Add</span>
            </button>
          </div>
        </section>

        {/* 伝票 */}
        <section aria-label="伝票" className="flex flex-col rounded-2xl border border-line bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-navy">
              伝票
              {order && <span className="ml-1 text-xs font-normal text-ink-3">#{order.orderNo}</span>}
            </p>
            {/* 人数（客数・客単価の集計に使う） */}
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-xs text-ink-3">人数 Guests</span>
              <button
                type="button"
                aria-label="人数を減らす"
                onClick={() => setGuests((g) => Math.max(1, g - 1))}
                disabled={pending || guests <= 1}
                className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-ink disabled:opacity-40"
              >
                <Minus className="h-4 w-4" aria-hidden />
              </button>
              <span className="w-8 text-center text-lg font-bold tabular-nums">{guests}</span>
              <button
                type="button"
                aria-label="人数を増やす"
                onClick={() => setGuests((g) => Math.min(999, g + 1))}
                disabled={pending}
                className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-ink"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <ul className="min-h-[120px] flex-1 divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm">
            {(order?.lines ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">
                  {l.name}
                  {!l.isAmount && <span className="ml-1 text-xs text-ink-3">×{l.quantity}</span>}
                </span>
                <span className="font-semibold tabular-nums">{yen(l.lineTotal)}</span>
              </li>
            ))}
            {lines.map((l, i) => (
              <li key={`amount-${i}`} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-ink-2">
                  {lineName}
                  {l.quantity > 1 && (
                    <span className="ml-1 text-xs text-ink-3 tabular-nums">
                      {yen(l.amount)} × {l.quantity}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{yen(l.amount * l.quantity)}</span>
                  <button
                    type="button"
                    aria-label={`${yen(l.amount * l.quantity)} を消す`}
                    onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                    disabled={pending}
                    className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-danger-soft hover:text-danger"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </span>
              </li>
            ))}
            {pendingLine && (
              <li className="flex items-center justify-between gap-2 px-3 py-2 text-ink-3">
                <span>
                  入力中 / Typing
                  {pendingLine.quantity > 1 && (
                    <span className="ml-1 text-xs tabular-nums">
                      {yen(pendingLine.amount)} × {pendingLine.quantity}
                    </span>
                  )}
                </span>
                <span className="tabular-nums">{yen(pendingTotal)}</span>
              </li>
            )}
            {(order?.lines.length ?? 0) === 0 && lines.length === 0 && !pendingLine && (
              <li className="px-3 py-6 text-center text-xs text-ink-3">
                金額を打って「追加」、または右上の「メニュー選択」
                <span className="block">Enter an amount, or choose from the menu</span>
              </li>
            )}
          </ul>
          {(order?.lines ?? []).some((l) => !l.isAmount) && (
            <p className="mt-1 text-[11px] text-ink-3">メニューの商品の取消は、会計画面の伝票から行います</p>
          )}

          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-sm font-bold text-navy">
              合計 <span className="text-xs font-normal text-ink-3">Total（税込）</span>
            </span>
            <span className="text-3xl font-extrabold text-royal tabular-nums">{yen(total)}</span>
          </div>
          <button
            type="button"
            onClick={checkout}
            disabled={pending || total <= 0}
            className="tap3d on-brand mt-3 flex h-16 w-full items-center justify-center gap-2 rounded-xl text-xl font-bold text-white disabled:opacity-50"
          >
            <Wallet className="h-6 w-6" aria-hidden />
            {pending ? '準備中…' : '会計する'}
            <span className="text-xs font-semibold opacity-75">Checkout</span>
          </button>
        </section>
      </div>

      {/* メニュー選択（ハンディの注文画面をそのまま出す） */}
      {menuVisible && order && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="メニュー選択"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
        >
          <div className="theme-regi flex h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-[#f6f3fb] text-[#2a2138] shadow-2xl">
            <HandyOrderScreen
              tableId=""
              tableName={lineName}
              staffName={staffName}
              orderId={order.id}
              orderNo={order.orderNo}
              guestCount={guests}
              unpaidTotal={orderedTotal}
              tabs={menu.tabs}
              initialTabId={menu.initialTabId}
              optionGroupsByItem={menu.optionGroupsByItem}
              submitAction={submitMenuAction}
              onClose={() => setWantMenu(false)}
              onSubmitted={(sent) => {
                setWantMenu(false);
                toast(`${sent}点を注文しました（厨房へ送信） / Ordered`);
                router.refresh();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
