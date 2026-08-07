import Link from 'next/link';
import { SEGMENT_LABELS, type CustomerSegment } from '@/lib/crm';
import { cn } from '@/lib/utils';

const SEGMENT_ORDER: CustomerSegment[] = [
  'new',
  'repeater',
  'regular',
  'vip',
  'dormant',
  'high_spender',
  'cancel_risk',
  'no_show_risk',
];

/**
 * セグメント別人数のサマリーバー。クリックで一覧の segment 絞込を切り替える。
 * 件数は絞込条件（検索・タグ）に関わらず組織内全active顧客を対象にした概数。
 */
export function SegmentSummaryBar({
  counts,
  active,
  buildHref,
}: {
  counts: Partial<Record<CustomerSegment, number>>;
  active: string;
  buildHref: (segment: string) => string;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {SEGMENT_ORDER.map((seg) => {
        const isActive = active === seg;
        const info = SEGMENT_LABELS[seg];
        return (
          <Link
            key={seg}
            href={buildHref(isActive ? '' : seg)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary-soft text-primary-deep'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            )}
          >
            {info.label}
            <span className="tabular-nums text-gray-400">{(counts[seg] ?? 0).toLocaleString('ja-JP')}</span>
          </Link>
        );
      })}
    </div>
  );
}
