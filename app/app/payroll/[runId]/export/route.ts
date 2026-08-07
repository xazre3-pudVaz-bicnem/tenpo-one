import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const ctx = await requirePermission('payroll.manage');
  const supabase = await createClient();

  const { data: run } = await supabase
    .from('payroll_runs')
    .select('id, title, period_start, period_end, organization_id')
    .eq('id', runId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (!run) return new Response('給与計算が見つかりません', { status: 404 });

  const { data: items } = await supabase
    .from('payroll_items')
    .select('*, profiles(display_name), stores(name)')
    .eq('payroll_run_id', runId)
    .order('created_at');

  const headers = [
    'スタッフ', '店舗', '勤務日数', '実働(分)', '残業(分)', '深夜(分)', '休日(分)',
    '基本給', '残業代', '深夜手当', '休日手当', '交通費', '手当', '歩合', '控除', '総支給',
  ];
  const rows = (items ?? []).map((row) => {
    const profile = row.profiles as unknown as { display_name: string } | null;
    const store = row.stores as unknown as { name: string } | null;
    return [
      profile?.display_name ?? '',
      store?.name ?? '全社',
      row.work_days,
      row.work_minutes,
      row.overtime_minutes,
      row.night_minutes,
      row.holiday_minutes,
      row.base_pay,
      row.overtime_pay,
      row.night_pay,
      row.holiday_pay,
      row.commute_pay,
      row.allowance_total,
      row.commission_total,
      row.deduction_total,
      row.gross_total,
    ];
  });

  const csv = toCsv(headers, rows);
  return csvResponse(`payroll_${run.period_start}_${run.title}.csv`, csv);
}
