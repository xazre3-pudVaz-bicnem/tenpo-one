'use client';

import { Loader2, Minus, Plus, X } from 'lucide-react';
import { yen } from '@/lib/format';
import { useQrStrings } from './strings-context';
import { cartCount, cartTotal, MAX_LINE_QUANTITY } from './logic';
import { cartLineUnitPrice, type CartLine } from './types';
import { BillSummary, PageTitle, PrimaryButton, QrEmpty, QrError, QrNote } from './ui';

/** カートタブ：未送信の注文。数量変更・削除・送信を行う */
export function CartView({
  cart,
  submitting,
  error,
  onChangeQuantity,
  onRemove,
  onSubmit,
  onBackToMenu,
}: {
  cart: CartLine[];
  submitting: boolean;
  error: string | null;
  onChangeQuantity: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onSubmit: () => void;
  onBackToMenu: () => void;
}) {
  const qrStrings = useQrStrings();
  const count = cartCount(cart);
  const total = cartTotal(cart);

  return (
    <div className="pb-6">
      <PageTitle
        eyebrow={qrStrings.cart.eyebrow}
        title={qrStrings.cart.title}
        description={qrStrings.cart.description}
      />

      {cart.length === 0 ? (
        <>
          <QrEmpty>{qrStrings.cart.empty}</QrEmpty>
          <div className="px-5">
            <button
              type="button"
              onClick={onBackToMenu}
              className="min-h-11 w-full text-sm font-bold text-iris"
            >
              {qrStrings.cart.backToMenu}
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="px-5">
            {cart.map((line) => (
              <li key={line.key} className="border-b border-line py-4">
                <div className="flex items-start justify-between gap-2 text-[13px]">
                  <b className="min-w-0 font-bold text-ink [overflow-wrap:anywhere]">{line.name}</b>
                  <div className="flex shrink-0 items-start gap-1">
                    <b className="font-num font-bold tabular-nums text-ink">
                      {yen(cartLineUnitPrice(line) * line.quantity)}
                    </b>
                    <button
                      type="button"
                      aria-label={qrStrings.cart.removeAria(line.name)}
                      onClick={() => onRemove(line.key)}
                      disabled={submitting}
                      className="-mt-1 rounded p-1 text-ink-3 disabled:opacity-40"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {line.modifiers.length > 0 && (
                  <p className="mt-1 text-[10px] text-ink-3">{line.modifiers.map((m) => m.name).join('、')}</p>
                )}
                {line.memo && <p className="mt-1 text-[10px] text-ink-3">{line.memo}</p>}

                <div className="mt-2.5 flex items-center gap-4">
                  <small className="text-[10px] text-ink-3">{qrStrings.cart.quantityLabel}</small>
                  <div className="flex items-center gap-3.5">
                    <button
                      type="button"
                      aria-label={qrStrings.cart.decreaseAria(line.name)}
                      onClick={() => onChangeQuantity(line.key, -1)}
                      disabled={submitting}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-iris disabled:opacity-40"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-5 text-center font-num text-sm font-bold tabular-nums">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={qrStrings.cart.increaseAria(line.name)}
                      onClick={() => onChangeQuantity(line.key, 1)}
                      disabled={submitting || line.quantity >= MAX_LINE_QUANTITY}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-iris disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <BillSummary label={qrStrings.cart.summary(count)} amount={yen(total)} />

          {error && <QrError>{error}</QrError>}

          <div className="px-5">
            <PrimaryButton onClick={onSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? qrStrings.cart.submitting : qrStrings.cart.submit}
            </PrimaryButton>
          </div>
          <QrNote className="pt-3">{qrStrings.cart.note}</QrNote>
        </>
      )}
    </div>
  );
}
