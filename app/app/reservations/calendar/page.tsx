import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { ACTIVE_TIMELINE_STATUSES } from '@/components/reservations/status';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: '予約カレンダー' };

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function currentMonthJst(): string {
  const jst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  return jst.slice(0, 7);
}

interface DayCell {
  date: string;
  day: number;
  dow: number;
  inMonth: boolean;
}

export default async function ReservationsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const ctx = await requireMember();
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="予約カレンダー" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗への招待を依頼してください。" />
      </div>
    );
  }

  const { month: rawMonth } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(rawMonth ?? '') ? rawMonth! : currentMonthJst();
  const [year, monthNum] = month.split('-').map(Number);

  const firstOfMonth = new Date(Date.UTC(year, monthNum - 1, 1));
  const lastOfMonth = new Date(Date.UTC(year, monthNum, 0));
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  const days: DayCell[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push({
      date: toDateStr(d),
      day: d.getUTCDate(),
      dow: d.getUTCDay(),
      inMonth: d.getUTCMonth() + 1 === monthNum,
    });
  }
  const weeks: DayCell[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const gridStartStr = toDateStr(gridStart);
  const gridEndStr = toDateStr(gridEnd);

  const supabase = await createClient();
  const { data: reservations } = await supabase
    .from('reservations')
    .select('reserved_date, party_size, status')
    .eq('store_id', store.id)
    .gte('reserved_date', gridStartStr)
    .lte('reserved_date', gridEndStr);

  const countByDate = new Map<string, number>();
  const guestsByDate = new Map<string, number>();
  for (const r of reservations ?? []) {
    if (!ACTIVE_TIMELINE_STATUSES.includes(r.status)) continue;
    countByDate.set(r.reserved_date, (countByDate.get(r.reserved_date) ?? 0) + 1);
    guestsByDate.set(r.reserved_date, (guestsByDate.get(r.reserved_date) ?? 0) + r.party_size);
  }

  const { data: holidays } = await supabase
    .from('holidays')
    .select('holiday_date, name')
    .eq('store_id', store.id)
    .gte('holiday_date', gridStartStr)
    .lte('holiday_date', gridEndStr);
  const holidayByDate = new Map((holidays ?? []).map((h) => [h.holiday_date, h.name ?? '休業日']));

  const prevMonthDate = new Date(Date.UTC(year, monthNum - 2, 1));
  const nextMonthDate = new Date(Date.UTC(year, monthNum, 1));
  const prevMonth = `${prevMonthDate.getUTCFullYear()}-${pad(prevMonthDate.getUTCMonth() + 1)}`;
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${pad(nextMonthDate.getUTCMonth() + 1)}`;

  return (
    <div>
      <PageHeader
        title="予約カレンダー"
        description={store.name}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/app/reservations/calendar?month=${prevMonth}`}
              aria-label="前月"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-navy hover:bg-gray-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="min-w-[6rem] text-center text-sm font-semibold text-navy">
              {year}年{monthNum}月
            </span>
            <Link
              href={`/app/reservations/calendar?month=${nextMonth}`}
              aria-label="翌月"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-navy hover:bg-gray-50"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link href={`/app/reservations/calendar?month=${currentMonthJst()}`} className="text-xs font-medium text-primary hover:underline">
              今月
            </Link>
          </div>
        }
      />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <thead>
            <tr>
              {WEEKDAYS.map((w, i) => (
                <th
                  key={w}
                  className={cn(
                    'border-b border-gray-200 bg-gray-50 px-2 py-2 text-center text-xs font-medium',
                    i === 0 && 'text-danger',
                    i === 6 && 'text-primary'
                  )}
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0].date}>
                {week.map((cell) => {
                  const holidayName = holidayByDate.get(cell.date);
                  const count = countByDate.get(cell.date) ?? 0;
                  const guests = guestsByDate.get(cell.date) ?? 0;
                  return (
                    <td key={cell.date} className="h-24 border-b border-l border-gray-100 p-0 align-top first:border-l-0">
                      <Link
                        href={`/app/reservations?date=${cell.date}`}
                        className={cn(
                          'flex h-full flex-col gap-1 p-2 hover:bg-primary-soft/40',
                          !cell.inMonth && 'bg-gray-50 text-gray-300',
                          holidayName && cell.inMonth && 'bg-gray-100'
                        )}
                      >
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            cell.inMonth ? (cell.dow === 0 ? 'text-danger' : cell.dow === 6 ? 'text-primary' : 'text-navy') : 'text-gray-300'
                          )}
                        >
                          {cell.day}
                        </span>
                        {holidayName && cell.inMonth && <span className="text-[10px] text-gray-500">{holidayName}</span>}
                        {count > 0 && (
                          <span className="mt-auto text-[11px] font-medium text-primary-deep">
                            {count}件 / {guests}名
                          </span>
                        )}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
