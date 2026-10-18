import { cn } from '@/lib/utils';
import { NEEDS_CONTACT_TAG } from '@/lib/reservation-entry';

/** 予約のキーワード（小さなラベル）。「要連絡」は赤（2026-10-19 Ronnie「キーワードも出るように」） */
export function TagChips({ tags, className }: { tags?: string[] | null; className?: string }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {tags.map((t) => (
        <span
          key={t}
          className={cn(
            'rounded-full px-1.5 py-px text-[10px] leading-[1.5] font-bold whitespace-nowrap',
            t === NEEDS_CONTACT_TAG ? 'bg-[#d9573f] text-white' : 'bg-[#f3e6dd] text-[#9f4630]'
          )}
        >
          {t}
        </span>
      ))}
    </span>
  );
}
