import { NextRequest } from 'next/server';
import { requireMember } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { summarizeEntry } from '@/lib/payroll';
import { toCsv, csvResponse } from '@/lib/csv';
import { formatMinutes, todayJst } from '@/lib/format';

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export async function GET(request: NextRequest) {
  const ctx = await requireMember();
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) return new Response('店舗が見つかりません', { status: 404 });

  const month = request.nextUrl.searchParams.get('month') ?? todayJst().slice(0, 7);
  const { start, end } = monthRange(month);
  const supabase = await createClient();
  const canViewAll = can(ctx.role, 'attendance.approve') || can(ctx.role, 'csv.export');

  let query = supabase
    .from('time_entries')
    .select('*, profiles(display_name)')
    .eq('store_id', store.id)
    .gte('work_date', start)
    .lte('work_date', end)
    .order('work_date');

  if (!canViewAll) {
    query = query.eq('profile_id', ctx.userId);
  }

  const { data: entries } = await query;

  const headers = ['日付', 'スタッフ', '出勤', '退勤', '休憩(分)', '実働', '残業', '深夜', '状態'];
  const rows = (entries ?? []).map((row) => {
    const profile = row.profiles as unknown as { display_name: string } | null;
    const summary =
      row.clock_in_at && row.clock_out_at
        ? summarizeEntry({
            clockInAt: new Date(row.clock_in_at),
            clockOutAt: new Date(row.clock_out_at),
            breakMinutes: row.break_minutes,
          })
        : null;
    const statusLabel = row.status === 'approved' ? '承認済' : row.status === 'closed' ? '打刻済' : '勤務中';
    return [
      row.work_date,
      profile?.display_name ?? '',
      row.clock_in_at ? new Date(row.clock_in_at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '',
      row.clock_out_at ? new Date(row.clock_out_at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '',
      row.break_minutes,
      summary ? formatMinutes(summary.workMinutes) : '',
      summary ? formatMinutes(summary.overtimeMinutes) : '',
      summary ? formatMinutes(summary.nightMinutes) : '',
      statusLabel,
    ];
  });

  const csv = toCsv(headers, rows);
  return csvResponse(`attendance_${store.slug}_${month}.csv`, csv);
}
