'use client';

import { useMemo } from 'react';
import { yen } from '@/lib/format';
import { cn } from '@/lib/utils';
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
  compact = false,
  columns = 1,
}: {
  counts: DenominationCounts;
  onChange: (next: DenominationCounts) => void;
  disabled?: boolean;
  /** 同じ画面に複数出るため、input の id を衝突させないための接頭辞 */
  idPrefix: string;
  /** 小さく（開局の箱。2026-09-28 Ronnie「箱を小さく」） */
  compact?: boolean;
  /** 2列に並べる（レジの iPad で 1画面に収める。2026-09-29 Ronnie「iPad の画面に全部入るように」） */
  columns?: 1 | 2;
}) {
  const total = useMemo(() => sumDenominations(counts), [counts]);
  /** 2列のときは左右の余白を詰める（iPad の半分の幅に入れる） */
  const padX = columns === 2 ? 'px-2' : 'px-3';
  /** 2列（レジの iPad）はさらに小さく（2026-09-29 Ronnie「現金実査をもっと小さく」） */
  const dense = columns === 2;

  const setCount = (denom: CashDenomination, raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    const next = { ...counts };
    if (digits === '') delete next[denom];
    else next[denom] = Number(digits);
    onChange(next);
  };

  return (
    <div>
      <div className={columns === 2 ? 'grid grid-cols-2 gap-2' : undefined}>
        {denominationGroups(columns).map((group, gi) => (
          <div key={gi} className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface text-ink-2">
                  <th className={cn(padX, dense ? 'py-1 text-left text-xs font-medium' : 'py-2 text-left font-medium')}>金種</th>
                  <th className={cn(padX, dense ? 'py-1 text-right text-xs font-medium' : 'py-2 text-right font-medium')}>枚数</th>
                  <th className={cn(padX, dense ? 'py-1 text-right text-xs font-medium' : 'py-2 text-right font-medium')}>金額</th>
                </tr>
              </thead>
              <tbody>
                {group.map((denom) => {
                  const count = counts[denom];
                  const subtotal = denominationSubtotal(denom, count);
                  return (
                    <tr key={denom} className="border-t border-line">
                      <td className={cn(padX, dense ? 'py-0.5 text-[13px]' : compact ? 'py-1' : 'py-2')}>
                        <label htmlFor={`${idPrefix}-denom-${denom}`} className="font-semibold text-ink">
                          {denominationLabel(denom)}
                        </label>
                      </td>
                      <td className={cn(padX, dense ? 'py-0.5 text-right' : compact ? 'py-1 text-right' : 'py-1.5 text-right')}>
                        <input
                          id={`${idPrefix}-denom-${denom}`}
                          inputMode="numeric"
                          value={count ?? ''}
                          onChange={(e) => setCount(denom, e.target.value)}
                          disabled={disabled}
                          placeholder="0"
                          aria-label={`${denominationLabel(denom)}の枚数`}
                          className={
                            dense
                            ? 'h-8 w-16 rounded-md border border-line bg-white px-1.5 text-right text-sm font-bold text-ink tabular-nums placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/25 disabled:bg-gray-100'
                            : compact
                              ? 'h-9 w-20 rounded-lg border border-line bg-white px-2 text-right text-base font-bold text-ink tabular-nums placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/25 disabled:bg-gray-100'
                              : 'h-12 w-24 rounded-lg border border-line bg-white px-3 text-right text-xl font-bold text-ink tabular-nums placeholder:text-ink-3 focus:border-iris focus:outline-2 focus:outline-iris/25 disabled:bg-gray-100'
                          }
                        />
                      </td>
                      <td className={cn(padX, dense ? 'py-0.5 text-right text-xs tabular-nums text-ink-2' : compact ? 'py-1 text-right text-sm tabular-nums text-ink-2' : 'py-2 text-right text-base tabular-nums text-ink-2')}>
                        {subtotal === 0 ? '—' : yen(subtotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className={dense ? 'mt-1.5 flex items-center justify-between rounded-lg bg-surface px-3 py-1.5' : compact ? 'mt-2 flex items-center justify-between rounded-xl bg-surface px-3 py-2' : 'mt-2 flex items-center justify-between rounded-xl bg-surface px-4 py-3'}>
        <span className={compact ? 'text-sm font-semibold text-ink' : 'text-base font-semibold text-ink'}>合計（実査額）</span>
        <b className={dense ? 'text-xl font-extrabold tabular-nums text-ink' : compact ? 'text-2xl font-extrabold tabular-nums text-ink' : 'text-3xl font-extrabold tabular-nums text-ink'}>{yen(total)}</b>
      </div>
    </div>
  );
}

/** 金種の並び。2列のときは 1〜100円 と 500円〜1万円 に分ける */
function denominationGroups(columns: 1 | 2): CashDenomination[][] {
  if (columns === 1) return [[...CASH_DENOMINATIONS]];
  const half = Math.ceil(CASH_DENOMINATIONS.length / 2);
  return [CASH_DENOMINATIONS.slice(0, half), CASH_DENOMINATIONS.slice(half)];
}
