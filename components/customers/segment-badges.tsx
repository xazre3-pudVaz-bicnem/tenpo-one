import { SEGMENT_LABELS, type CustomerSegment, type RfmScore } from '@/lib/crm';
import { Badge, type BadgeTone } from '@/components/ui/badge';

/**
 * classifyCustomer の分類結果をバッジ表示する。
 * limit を指定すると先頭（優先度が高い順）を limit 件まで表示し、残数を "+N" で示す。
 * 省略時は全件表示する（顧客詳細ページ用）。
 */
export function SegmentBadges({ segments, limit }: { segments: CustomerSegment[]; limit?: number }) {
  if (segments.length === 0) return <span className="text-xs text-gray-400">—</span>;

  const shown = limit != null ? segments.slice(0, limit) : segments;
  const restCount = limit != null ? Math.max(0, segments.length - limit) : 0;

  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <Badge key={s} tone={SEGMENT_LABELS[s].tone}>
          {SEGMENT_LABELS[s].label}
        </Badge>
      ))}
      {restCount > 0 && <Badge tone="gray">+{restCount}</Badge>}
    </div>
  );
}

const RFM_RANK_TONES: Record<RfmScore['rank'], BadgeTone> = {
  S: 'navy',
  A: 'success',
  B: 'primary',
  C: 'warning',
  D: 'danger',
};

export function rfmRankTone(rank: RfmScore['rank']): BadgeTone {
  return RFM_RANK_TONES[rank];
}

/** RFMランクバッジ。showDetail で R/F/Mの内訳とランク名も表示する */
export function RfmBadge({ rfm, showDetail }: { rfm: RfmScore; showDetail?: boolean }) {
  return (
    <Badge tone={RFM_RANK_TONES[rfm.rank]} title={`R${rfm.recency} F${rfm.frequency} M${rfm.monetary}｜${rfm.rankLabel}`}>
      RFM {rfm.rank}
      {showDetail ? `（${rfm.rankLabel}）` : ''}
    </Badge>
  );
}
