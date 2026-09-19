'use client';

import { useMemo } from 'react';
import { yen } from '@/lib/format';
import {
  CASH_DENOMINATIONS,
  denominationLabel,
  denominationSubtotal,
  sumDenominations,
  type CashDenomination,
  type DenominationCounts,
} from '@/lib/cash-count';

/**
 * 現金実査の金種別カウンター。
 * 1円から1万円までレジのトレイと同じ順に並べ、枚数を入れると金額が出て、いちばん下に合計が出る。
 * 合計がそのまま実査額になるので、電卓も紙も要らない。
 */
export function CashDenominationCounter({
  counts,
  onChange,
  disabled,
  idPrefix,
}: {
  counts: DenominationCounts;
  onChange: (next: DenominationCounts) => void;
  disabled?: boolean;
  /** 同じ画面に複数出るため、input の id を衝突させないための接頭辞 */
  idPrefix: string;
}) {
  const total = useMemo(() => sumDenominations(counts), [counts]);

  const setCount = (denom: CashDenomination, raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    const next = { ...counts };
    if (digits === '') delete next[denom];
    else next[denom] = Number(digits);
    onChange(next);
  };

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface text-ink-2">
              <th className="px-3 py-2 text-left font-medium">金種</th>
              <th className="px-3 py-2 text-right font-medium">枚数</th>
              <th className="px-3 py-2 text-right font-medium">金額</th>
            </tr>
          </thead>
          <tbody>
            {CASH_DENOMINATIONS.map((denom) => {
              const count = counts[denom];
              const subtotal = denominationSubtotal(denom, count);
              return (
                <tr key={denom} className="border-t border-line">
                  <td className="px-3 py-2">
                    <label htmlFor={`${idPrefix}-denom-${denom}`} className="font-semibold text-ink">
                      {denominationLabel(denom)}
                    </label>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      id={`${idPrefix}-denom-${denom}`}
                      inputMode="numeric"
                      value={count ?? ''}
                      onChange={(e) => setCount(denom, e.target.value)}
                      disabled={disabled}
                      placeholder="0"
                      aria-label={`${denominationLabel(denom)}の枚数`}
                      className="h-12 w-24 rounded-lg border border-line bg-white px-3 text-right text-xl font-bold text-ink tabular-nums placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/25 disabled:bg-gray-100"
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-base tabular-nums text-ink-2">
                    {subtotal === 0 ? '—' : yen(subtotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-xl bg-surface px-4 py-3">
        <span className="text-base font-semibold text-ink">合計（実査額）</span>
        <b className="text-3xl font-extrabold tabular-nums text-ink">{yen(total)}</b>
      </div>
    </div>
  );
}
