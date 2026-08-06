'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { publishWeek } from './actions';

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function WeekNav({
  weekStart,
  weekEnd,
  rangeLabel,
  canManage,
  storeId,
  todayWeekStart,
}: {
  weekStart: string;
  weekEnd: string;
  rangeLabel: string;
  canManage: boolean;
  storeId: string;
  todayWeekStart: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const goto = (week: string) => router.push(`/app/shifts?week=${week}`);

  const publish = () => {
    startTransition(async () => {
      const result = await publishWeek(storeId, weekStart, weekEnd);
      toast(result.message, result.ok ? 'success' : 'error');
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="icon" onClick={() => goto(addDays(weekStart, -7))} aria-label="前の週">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-40 text-center text-sm font-semibold text-navy">{rangeLabel}</span>
        <Button variant="secondary" size="icon" onClick={() => goto(addDays(weekStart, 7))} aria-label="次の週">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => goto(todayWeekStart)} disabled={weekStart === todayWeekStart}>
          今週
        </Button>
      </div>
      {canManage && (
        <Button size="sm" onClick={publish} disabled={pending}>
          <Send className="h-3.5 w-3.5" />
          今週分を公開
        </Button>
      )}
    </div>
  );
}
