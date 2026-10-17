'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QR_GUEST_MAX, stepGuest } from '@/lib/qr-visit';
import type { QrStrings } from './strings';

/**
 * お客様QRの最初の画面：ご来店の人数（女性・男性）を選んでから注文へ進む
 * （2026-10-17 Ronnie「QR を読んだらすぐ注文ではなく、Air レジのように Girls / Boys を選んでから注文へ」）。
 * 卓にまだ伝票が無いときだけ出る（レジで着席済み・同じ卓の誰かが先に選んだ卓は出ない）。
 */
export function QrGuestStart({
  strings,
  tableName,
  onConfirm,
}: {
  strings: QrStrings['start'];
  tableName: string;
  onConfirm: (counts: { female: number; male: number }) => Promise<void> | void;
}) {
  const [female, setFemale] = useState(0);
  const [male, setMale] = useState(0);
  const [busy, setBusy] = useState(false);
  const total = female + male;

  const rows = [
    { key: 'female', label: strings.women, value: female, set: setFemale },
    { key: 'male', label: strings.men, value: male, set: setMale },
  ] as const;

  return (
    <div className="flex min-h-full flex-col px-5 pt-7 pb-4">
      <p className="text-center text-[22px] font-bold text-ink">{strings.welcome}</p>
      <p className="mt-1.5 text-center text-[16px] font-bold text-ink">{strings.title}</p>
      <p className="mt-1 text-center text-[12px] font-semibold text-ink-3">{tableName}</p>

      <div className="mt-6 space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3">
            <span className="min-w-0 flex-1 text-[18px] font-bold text-ink">{r.label}</span>
            <button
              type="button"
              aria-label={strings.decreaseAria(r.label)}
              disabled={busy || r.value === 0}
              onClick={() => r.set((n) => stepGuest(n, -1))}
              className="grid h-14 w-14 place-items-center rounded-xl border border-line bg-lilac-soft text-ink active:scale-95 disabled:opacity-35"
            >
              <Minus className="h-6 w-6" aria-hidden />
            </button>
            <span className="w-14 text-center font-num text-[30px] font-bold text-ink tabular-nums" aria-live="polite">
              {r.value}
              {strings.unit && <span className="ml-0.5 text-[13px] font-semibold text-ink-3">{strings.unit}</span>}
            </span>
            <button
              type="button"
              aria-label={strings.increaseAria(r.label)}
              disabled={busy || r.value >= QR_GUEST_MAX}
              onClick={() => r.set((n) => stepGuest(n, 1))}
              className="grid h-14 w-14 place-items-center rounded-xl bg-iris text-white active:scale-95 disabled:opacity-35"
            >
              <Plus className="h-6 w-6" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center text-[15px] font-bold text-ink tabular-nums">{strings.total(total)}</p>

      <div className="mt-auto pt-6">
        <button
          type="button"
          disabled={total < 1 || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm({ female, male });
            } finally {
              setBusy(false);
            }
          }}
          className={cn(
            'flex min-h-[56px] w-full items-center justify-center rounded-xl px-4 text-[16px] font-bold text-white active:scale-[0.99]',
            total < 1 ? 'bg-[#e8c9bc]' : 'bg-iris'
          )}
        >
          {busy ? strings.submitting : strings.submit}
        </button>
        <p className="mt-2 text-center text-[12px] text-ink-3">{strings.note}</p>
      </div>
    </div>
  );
}
