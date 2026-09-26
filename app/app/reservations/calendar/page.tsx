import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ACTIVE_TIMELINE_STATUSES } from '@/components/reservations/constants';
import { loadLedgerChrome } from '@/components/reservations/ledger-data';
import { LedgerTop, MonthNav } from '@/components/reservations/ledger-header';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: '予約カレンダー' };

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
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
  const ctx = await requireFeature('reservations');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="月間" en="Month" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗への招待を依頼してください。" />
      </div>
    );
  }

  const chrome = await loadLedgerChrome(ctx, store);
  const today = chrome.today;
  const currentMonth = today.slice(0, 7);

  const { month: rawMonth } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(rawMonth ?? '') ? rawMonth! : currentMonth;
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
  let monthCount = 0;
  let monthGuests = 0;
  for (const r of reservations ?? []) {
    if (!ACTIVE_TIMELINE_STATUSES.includes(r.status)) continue;
    countByDate.set(r.reserved_date, (countByDate.get(r.reserved_date) ?? 0) + 1);
    guestsByDate.set(r.reserved_date, (guestsByDate.get(r.reserved_date) ?? 0) + r.party_size);
    if (r.reserved_date.startsWith(month)) {
      monthCount++;
      monthGuests += r.party_size;
    }
  }

  const { data: holidays } = await supabase
    .from('holidays')
    .select('holiday_date, name')
    .eq('store_id', store.id)
    .gte('holiday_date', gridStartStr)
    .lte('holiday_date', gridEndStr);
  const holidayByDate = new Map((holidays ?? []).map((h) => [h.holiday_date, h.name ?? '休業日']));

  const busiest = Math.max(0, ...[...guestsByDate.entries()].filter(([d]) => d.startsWith(month)).map(([, g]) => g));
  const linkDate = month === currentMonth ? today : `${month}-01`;

  return (
    <div>
      <h1 className="sr-only">月間（予約カレンダー）</h1>
      <LedgerTop title="月間カレンダー" date={linkDate} chrome={chrome} nav={<MonthNav month={month} current={currentMonth} />} />

      <div className="print-area">

        <Card className="overflow-hidden">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle en={`${MONTH_EN[monthNum - 1]} ${year}`}>
              {year}年{monthNum}月
            </CardTitle>
            <span className="text-xs text-ink-3 tabular-nums">
              {monthCount}組 {monthGuests}名 ・ 日をタップ＝その日のスケジュール
            </span>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  {WEEKDAYS.map((w, i) => (
                    <th
                      key={w}
                      className={cn(
                        'border-b border-line bg-lilac-soft px-2 py-2 text-center text-xs font-bold',
                        i === 0 ? 'text-danger' : i === 6 ? 'text-iris' : 'text-ink-2'
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
                      const isTodayCell = cell.date === today;
                      const heat = busiest > 0 && cell.inMonth ? guests / busiest : 0;
                      return (
                        <td key={cell.date} className="h-[5.5rem] border-b border-l border-line p-0 align-top first:border-l-0">
                          <Link
                            href={`/app/reservations?date=${cell.date}`}
                            className={cn(
                              'relative flex h-full flex-col gap-1 p-2 transition-colors hover:bg-iris-soft',
                              !cell.inMonth && 'bg-lilac-soft/60',
                              holidayName && cell.inMonth && 'bg-[#EEECF1]',
                              isTodayCell && 'ring-2 ring-iris ring-inset'
                            )}
                          >
                            <span className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  'font-[family-name:var(--font-num)] text-[15px] font-extrabold tabular-nums',
                                  !cell.inMonth
                                    ? 'text-wisteria'
                                    : cell.dow === 0
                                      ? 'text-danger'
                                      : cell.dow === 6
                                        ? 'text-iris'
                                        : 'text-ink'
                                )}
                              >
                                {cell.day}
                              </span>
                              {isTodayCell && (
                                <span className="rounded-full bg-iris-soft px-1.5 text-[10px] font-bold text-royal">今日</span>
                              )}
                            </span>
                            {holidayName && cell.inMonth && <span className="text-[11px] font-medium text-ink-3">{holidayName}</span>}
                            {count > 0 && (
                              <span
                                className="mt-auto self-start rounded-md px-1.5 py-0.5 text-[12px] font-bold text-royal tabular-nums"
                                style={{ backgroundColor: `rgba(123, 63, 228, ${(0.1 + heat * 0.25).toFixed(2)})` }}
                              >
                                {count}組<span className="ml-1 font-medium text-ink-2">({guests}名)</span>
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-lilac-soft px-4 py-2 text-[11.5px] font-medium text-ink-2">
            <span>数字＝組数（名数）</span>
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block h-[9px] w-[9px] rounded-full bg-[#d4cbd1]" />
              グレー＝休業日
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block h-[9px] w-[9px] rounded-sm ring-2 ring-iris" />
              本日＝紫枠
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
