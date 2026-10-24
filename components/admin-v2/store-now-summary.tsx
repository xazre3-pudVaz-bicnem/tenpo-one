import type { LedgerSummary } from '@/lib/ledger-summary';

/**
 * 店舗ナウの上の帯：本日の ご予約／当日予約／来店済み／退店／来店待ち／キャンセル（2026-10-24 Ronnie「今日の来店・退店が見えるように」）。
 * 数え方は店舗台帳の上のタイルと同じ（lib/ledger-summary.ts）。左の色の線は予約の状態の色。
 */
export function StoreNowSummary({ s }: { s: LedgerSummary }) {
  const items: { label: string; color: string; groups: number; guests?: number }[] = [
    { label: 'ご予約', color: '#1a5ad6', groups: s.count, guests: s.guests },
    { label: '当日予約', color: '#353057', groups: s.sameDayCount, guests: s.sameDayGuests },
    { label: '来店済み', color: '#00c689', groups: s.inCount },
    { label: '退店', color: '#94a3b8', groups: s.outCount },
    { label: '来店待ち', color: '#ffc634', groups: s.waitingCount },
    { label: 'キャンセル', color: '#fe6564', groups: s.cancelled },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" aria-label="本日の予約・来店">
      {items.map((i) => (
        <div key={i.label} className="flex items-stretch gap-3 rounded-xl border border-line bg-white px-4 py-3">
          <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: i.color }} aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span className="text-[12.5px] font-bold text-ink-2">{i.label}</span>
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="text-[24px] leading-tight font-extrabold text-ink">
                {i.groups}
                <span className="ml-0.5 text-[12px] font-medium text-ink-3">組</span>
              </span>
              {i.guests != null && (
                <span className="text-[14px] font-bold text-ink-2">
                  {i.guests}
                  <span className="ml-0.5 text-[12px] font-medium text-ink-3">名</span>
                </span>
              )}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
