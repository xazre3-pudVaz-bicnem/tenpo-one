import Link from 'next/link';
import { yen } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface PlStep {
  label: string;
  /** 表示金額（正の値で渡す） */
  amount: number;
  /** 控除行（原価・人件費・経費）なら true。表示に "−" を付け危険色にする */
  isDeduction?: boolean;
  href?: string;
  /** 小計・合計行（売上・粗利益・店舗利益）を強調表示する */
  emphasis?: boolean;
  note?: string;
}

/** P/Lカスケード（段階棒）。売上→原価→粗利益→人件費→経費→店舗利益 の流れを視覚化する */
export function PlCascade({ steps }: { steps: PlStep[] }) {
  const maxAbs = Math.max(1, ...steps.map((s) => Math.abs(s.amount)));

  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => {
        const widthPct = Math.min(100, (Math.abs(s.amount) / maxAbs) * 100);
        const barTone = s.isDeduction ? 'bg-danger/50' : s.emphasis ? 'bg-primary' : 'bg-primary/70';
        const body = (
          <div
            className={cn(
              'rounded-xl border px-4 py-3 transition-colors',
              s.emphasis ? 'border-navy/15 bg-navy/[0.025]' : 'border-gray-200 bg-white',
              s.href && 'hover:border-primary/40 hover:bg-primary-soft/30'
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className={cn(s.emphasis ? 'text-sm font-bold text-navy' : 'text-sm font-medium text-gray-600')}>
                {s.isDeduction ? '− ' : ''}
                {s.label}
              </span>
              <span
                className={cn(
                  'tabular-nums',
                  s.emphasis ? 'text-lg font-bold' : 'text-sm font-semibold',
                  s.isDeduction ? 'text-danger' : s.emphasis && s.amount < 0 ? 'text-danger' : s.emphasis ? 'text-primary-deep' : 'text-navy'
                )}
              >
                {yen(Math.abs(s.amount))}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className={cn('h-full rounded-full transition-all', barTone)} style={{ width: `${widthPct}%` }} />
            </div>
            {s.note && <p className="mt-1.5 text-xs text-gray-400">{s.note}</p>}
          </div>
        );
        return s.href ? (
          <Link key={i} href={s.href} className="block">
            {body}
          </Link>
        ) : (
          <div key={i}>{body}</div>
        );
      })}
    </div>
  );
}
