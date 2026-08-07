'use client';

import { X, Loader2 } from 'lucide-react';
import { yen } from '@/lib/format';
import { qrStrings } from './strings';
import { cartLineUnitPrice, type CartLine } from './types';

/** 注文確定前の明細確認画面 */
export function ConfirmView({
  cart,
  total,
  submitting,
  error,
  onRemove,
  onBack,
  onSubmit,
}: {
  cart: CartLine[];
  total: number;
  submitting: boolean;
  error: string | null;
  onRemove: (key: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="pb-28">
      <div className="px-4 py-4">
        <h2 className="text-base font-bold text-navy">{qrStrings.confirm.title}</h2>
        <p className="mt-1 text-xs text-gray-500">{qrStrings.confirm.description}</p>
      </div>

      {error && (
        <div className="mx-4 mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</div>
      )}

      <ul className="divide-y divide-gray-100 bg-white">
        {cart.map((line) => (
          <li key={line.key} className="flex items-start justify-between gap-3 px-4 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-navy">
                {line.name} × {line.quantity}
              </p>
              {line.modifiers.length > 0 && (
                <p className="mt-0.5 text-xs text-gray-500">
                  {line.modifiers.map((m) => m.name).join('、')}
                </p>
              )}
              {line.memo && <p className="mt-0.5 text-xs text-gray-500">{line.memo}</p>}
              <p className="mt-1 text-sm font-semibold tabular-nums text-primary-deep">
                {yen(cartLineUnitPrice(line) * line.quantity)}
              </p>
            </div>
            <button
              type="button"
              aria-label={qrStrings.confirm.removeAria(line.name)}
              onClick={() => onRemove(line.key)}
              disabled={submitting}
              className="rounded p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mx-4 mt-4 flex justify-between rounded-xl bg-gray-50 px-4 py-3 text-base font-bold text-navy">
        <span>{qrStrings.confirm.total}</span>
        <span className="tabular-nums">{yen(total)}</span>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={submitting}
            className="h-12 flex-1 rounded-lg border border-gray-300 text-sm font-semibold text-navy disabled:opacity-40"
          >
            {qrStrings.confirm.back}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || cart.length === 0}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {qrStrings.confirm.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
