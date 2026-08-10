import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { todayJst, yen, weekdayJa } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { WeekNav } from './week-nav';
import { ShiftGrid, type ShiftLite, type StaffRow, type OrgStaffOption } from './shift-grid';
import { RequirementsPanel, type ShiftRequirementRow } from './requirements-panel';

export const metadata: Metadata = { title: 'シフト' };

/** 予定人件費が予測売上のこの割合(%)を超えたら警告表示にする */
const LABOR_COST_RATIO_WARNING_THRESHOLD = 30;

const STORE_ROLE_CODES = ['store_manager', 'assistant_manager', 'staff', 'part_time'];

/**
 * 労基法上、休日は原則週1日（変形制の場合4週4日）以上必要とされる。
 * 6日連続勤務で「翌日が休みかどうか」を早めに確認できるよう注意喚起する。
 */
const CONSECUTIVE_DAYS_WARNING_THRESHOLD = 6;
/** 労基法32条: 法定労働時間は原則1週40時間。超過分は時間外労働として別途注意が必要。 */
const WEEKLY_MINUTES_WARNING_THRESHOLD = 40 * 60;

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// mondayOf/addDays と同じくUTC基準で解釈し、サーバーのローカルタイムゾーン設定に依存しない
// 曜日判定を行う（date-onlyの文字列同士の比較のみに用いる）
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFeature('attendance');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];
  const canManage = can(ctx.role, 'shifts.manage');
  const todayWeekStart = mondayOf(todayJst());
  const weekStart = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? mondayOf(sp.week) : todayWeekStart;
  const weekEnd = addDays(weekStart, 6);

  if (!store) {
    return (
      <div>
        <PageHeader title="シフト" />
        <EmptyState title="所属店舗がありません" />
      </div>
    );
  }

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    return { date, label: `${date.slice(5).replace('-', '/')}(${weekdayJa(date)})` };
  });
  const rangeLabel = `${weekStart.slice(5).replace('-', '/')} 〜 ${weekEnd.slice(5).replace('-', '/')}`;

  // 当店スタッフ名簿(msRows)と当週シフト(shiftRows)は相互に独立のため並列取得する。
  const [{ data: msRows }, { data: shiftRows }] = await Promise.all([
    supabase.from('membership_stores').select('membership_id').eq('store_id', store.id),
    // 当週の全シフト（他店舗スタッフによる店舗間ヘルプも含めて店舗単位で取得）
    supabase
      .from('shifts')
      .select('id, profile_id, shift_date, start_time, end_time, kind, status, note')
      .eq('store_id', store.id)
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEnd)
      .neq('status', 'cancelled')
      .order('shift_date')
      .order('start_time'),
  ]);
  const membershipIds = (msRows ?? []).map((r) => r.membership_id);
  const { data: memberRows } = membershipIds.length
    ? await supabase
        .from('memberships')
        .select('profile_id, profiles(id, display_name)')
        .in('id', membershipIds)
        .eq('organization_id', ctx.organizationId)
        .eq('status', 'active')
    : { data: [] };
  const staff: StaffRow[] = (memberRows ?? [])
    .map((m) => {
      const p = m.profiles as unknown as { id: string; display_name: string } | null;
      return p ? { id: p.id, name: p.display_name } : null;
    })
    .filter((s): s is StaffRow => !!s)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const staffIds = staff.map((s) => s.id);

  // 当店ロースター外のプロフィール = 店舗間ヘルプで入っているスタッフ
  const helperIds = [...new Set((shiftRows ?? []).map((r) => r.profile_id))].filter((id) => !staffIds.includes(id));
  let helperStaff: StaffRow[] = [];
  if (helperIds.length) {
    const { data: helperProfiles } = await supabase.from('profiles').select('id, display_name').in('id', helperIds);
    helperStaff = (helperProfiles ?? [])
      .map((p) => ({ id: p.id, name: p.display_name, isHelp: true }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }
  const allRows: StaffRow[] = [...staff, ...helperStaff];
  const allRowIds = allRows.map((r) => r.id);

  const shiftsByKey: Record<string, ShiftLite[]> = {};
  for (const row of shiftRows ?? []) {
    const key = `${row.profile_id}_${row.shift_date}`;
    (shiftsByKey[key] ??= []).push({
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
      kind: row.kind,
      status: row.status,
      note: row.note,
    });
  }

  // 他店舗スタッフを含めたシフト作成用の組織内スタッフ選択肢（店舗間ヘルプ）
  let orgStaffOptions: OrgStaffOption[] = [];
  if (canManage) {
    const { data: orgMemberRows } = await supabase
      .from('memberships')
      .select('profile_id, profiles(id, display_name), membership_stores(stores(name))')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .in('role', STORE_ROLE_CODES);
    orgStaffOptions = (orgMemberRows ?? [])
      .map((m) => {
        const p = m.profiles as unknown as { id: string; display_name: string } | null;
        if (!p) return null;
        const storeLinks = (m.membership_stores as unknown as { stores: { name: string } | null }[] | null) ?? [];
        const homeStores = storeLinks
          .map((l) => l.stores?.name)
          .filter((n): n is string => !!n)
          .join('・');
        return { id: p.id, name: p.display_name, homeStores };
      })
      .filter((s): s is OrgStaffOption => !!s)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  // 人件費予測（時給ルール）: 自店スタッフ + 店舗間ヘルプスタッフ
  const { data: rules } = allRowIds.length
    ? await supabase
        .from('payroll_rules')
        .select('profile_id, base_amount, effective_from, effective_to')
        .eq('organization_id', ctx.organizationId)
        .in('profile_id', allRowIds)
        .eq('pay_type', 'hourly')
        .eq('status', 'active')
        .lte('effective_from', weekEnd)
        .or(`effective_to.is.null,effective_to.gte.${weekStart}`)
    : { data: [] };
  const rateByProfile = new Map<string, number>();
  const rateEffectiveFrom = new Map<string, string>();
  for (const r of rules ?? []) {
    const current = rateEffectiveFrom.get(r.profile_id);
    if (current === undefined || r.effective_from > current) {
      rateByProfile.set(r.profile_id, r.base_amount);
      rateEffectiveFrom.set(r.profile_id, r.effective_from);
    }
  }

  const laborRows = allRows.map((s) => {
    const minutes = (shiftRows ?? [])
      .filter((row) => row.profile_id === s.id)
      .reduce((sum, row) => sum + Math.max(0, minutesOf(row.end_time) - minutesOf(row.start_time)), 0);
    const rate = rateByProfile.get(s.id);
    const cost = rate != null ? Math.round((rate * minutes) / 60) : null;
    return { name: s.name, isHelp: s.isHelp, minutes, cost };
  });
  const totalCost = laborRows.reduce((a, r) => a + (r.cost ?? 0), 0);

  // 日別の予定人件費（全シフト種別を対象。時給ルール未設定のスタッフは0円扱い＝既存の集計ロジックを踏襲）
  const dailyLaborCost: Record<string, number> = Object.fromEntries(weekDates.map((d) => [d.date, 0]));
  for (const row of shiftRows ?? []) {
    const rate = rateByProfile.get(row.profile_id);
    if (rate == null) continue;
    const minutes = Math.max(0, minutesOf(row.end_time) - minutesOf(row.start_time));
    dailyLaborCost[row.shift_date] = (dailyLaborCost[row.shift_date] ?? 0) + Math.round((rate * minutes) / 60);
  }

  // 日別の予測売上 = 過去4週間の同曜日の daily_closings.sales_total 平均
  const lookbackStart = addDays(weekStart, -28);
  const lookbackEnd = addDays(weekStart, -1);
  const weekMonthStarts = [...new Set(weekDates.map((d) => `${d.date.slice(0, 7)}-01`))];
  // 予測売上(closings)・予算(budgets)・必要人数(requirements)・営業時間(businessHours)は
  // いずれも相互に独立の末端クエリ（取得後はローカル集計のみ）のため一括で並列取得する。
  const [{ data: closingRows }, { data: budgetRows }, { data: requirementRows }, { data: businessHourRows }] =
    await Promise.all([
      supabase
        .from('daily_closings')
        .select('business_date, sales_total')
        .eq('store_id', store.id)
        .gte('business_date', lookbackStart)
        .lte('business_date', lookbackEnd)
        .in('status', ['closed', 'approved']),
      supabase
        .from('budgets')
        .select('store_id, month, sales_budget, labor_rate_target')
        .eq('organization_id', ctx.organizationId)
        .in('month', weekMonthStarts)
        .or(`store_id.eq.${store.id},store_id.is.null`),
      supabase
        .from('shift_requirements')
        .select('*')
        .eq('store_id', store.id)
        .order('day_of_week')
        .order('time_from'),
      supabase
        .from('business_hours')
        .select('day_of_week, open_time, close_time, is_closed')
        .eq('store_id', store.id),
    ]);
  const salesByWeekday = new Map<number, number[]>();
  for (const row of closingRows ?? []) {
    const wd = weekdayOf(row.business_date);
    const list = salesByWeekday.get(wd) ?? [];
    list.push(row.sales_total);
    salesByWeekday.set(wd, list);
  }

  // 人件費シミュレーター（予算比較）: 週内に月をまたぐ場合に備え、該当する月すべての予算を対象にする。
  // 店舗別予算(store_id=store.id)が優先。全社予算(store_id=null)しかない場合はそちらを使う。
  // budgetRows / weekMonthStarts は上の並列ブロックで取得・算出済み。
  const budgetByMonth = new Map<string, { salesBudget: number; laborRateTarget: number | null }>();
  for (const monthStart of weekMonthStarts) {
    const candidates = (budgetRows ?? []).filter((b) => b.month === monthStart);
    if (candidates.length === 0) continue;
    const pick = candidates.find((b) => b.store_id === store.id) ?? candidates.find((b) => b.store_id === null);
    if (pick) budgetByMonth.set(monthStart, { salesBudget: pick.sales_budget, laborRateTarget: pick.labor_rate_target });
  }

  const forecastRows = weekDates.map((d) => {
    const plannedLabor = dailyLaborCost[d.date] ?? 0;
    const monthStart = `${d.date.slice(0, 7)}-01`;
    const budget = budgetByMonth.get(monthStart);
    if (budget) {
      const [y, m] = d.date.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const salesBasis = daysInMonth > 0 ? Math.round(budget.salesBudget / daysInMonth) : null;
      const ratio = salesBasis && salesBasis > 0 ? (plannedLabor / salesBasis) * 100 : null;
      const targetRatio = budget.laborRateTarget ?? null;
      const diff = ratio != null && targetRatio != null ? ratio - targetRatio : null;
      return {
        date: d.date, label: d.label, source: 'budget' as const,
        salesBasis, plannedLabor, ratio, targetRatio, diff,
      };
    }
    // 予算未設定日は従来どおり過去4週間の同曜日平均で予測する
    const samples = salesByWeekday.get(weekdayOf(d.date)) ?? [];
    const predictedSales = samples.length > 0 ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null;
    const ratio = predictedSales && predictedSales > 0 ? (plannedLabor / predictedSales) * 100 : null;
    return {
      date: d.date, label: d.label, source: 'forecast' as const,
      salesBasis: predictedSales, plannedLabor, ratio, targetRatio: null, diff: null,
    };
  });

  // 時間帯別必要人数と、当週の不足チェック（requirementRows は上の並列ブロックで取得済み）
  const shortages: { date: string; label: string; timeFrom: string; timeTo: string; required: number; actual: number }[] = [];
  for (const req of requirementRows ?? []) {
    const matchDate = weekDates.find((d) => weekdayOf(d.date) === req.day_of_week);
    if (!matchDate) continue;
    const reqFrom = minutesOf(req.time_from);
    const reqTo = minutesOf(req.time_to);
    const actual = (shiftRows ?? []).filter(
      (r) =>
        r.shift_date === matchDate.date &&
        r.kind === 'confirmed' &&
        r.status === 'published' &&
        overlaps(minutesOf(r.start_time), minutesOf(r.end_time), reqFrom, reqTo)
    ).length;
    if (actual < req.required_count) {
      shortages.push({
        date: matchDate.date,
        label: matchDate.label,
        timeFrom: req.time_from.slice(0, 5),
        timeTo: req.time_to.slice(0, 5),
        required: req.required_count,
        actual,
      });
    }
  }

  // ---------------------------------------------------------------
  // シフト自動チェック（連勤・週労働時間・営業時間外）。表示のみで保存は妨げない。
  // 当店の確定・公開シフトのみを対象とする簡易実装（店舗間ヘルプ先での勤務は含まない）。
  // ---------------------------------------------------------------
  const nameByStaffId = new Map(allRows.map((s) => [s.id, s.name]));

  // 連勤チェック: 週開始のしきい値-1日前までさかのぼって取得し、当週へまたがる連続勤務も検出する
  const consecutiveLookbackStart = addDays(weekStart, -(CONSECUTIVE_DAYS_WARNING_THRESHOLD - 1));
  const { data: extendedShiftRows } = allRowIds.length
    ? await supabase
        .from('shifts')
        .select('profile_id, shift_date')
        .eq('store_id', store.id)
        .in('profile_id', allRowIds)
        .gte('shift_date', consecutiveLookbackStart)
        .lte('shift_date', weekEnd)
        .eq('kind', 'confirmed')
        .eq('status', 'published')
        .order('shift_date')
    : { data: [] };

  const workDatesByStaff = new Map<string, string[]>();
  for (const row of extendedShiftRows ?? []) {
    const list = workDatesByStaff.get(row.profile_id) ?? [];
    if (!list.includes(row.shift_date)) list.push(row.shift_date);
    workDatesByStaff.set(row.profile_id, list);
  }
  const consecutiveWarnings: { profileId: string; name: string; streak: number }[] = [];
  for (const [profileId, dates] of workDatesByStaff) {
    const sorted = [...dates].sort();
    let streak = 1;
    let maxStreak = 1;
    let streakEnd = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (addDays(sorted[i - 1], 1) === sorted[i]) {
        streak++;
      } else {
        streak = 1;
      }
      if (streak > maxStreak) {
        maxStreak = streak;
        streakEnd = sorted[i];
      }
    }
    // 当週に重なる連続勤務のみ警告対象（過去だけで完結する連勤は対象外）
    if (maxStreak >= CONSECUTIVE_DAYS_WARNING_THRESHOLD && streakEnd >= weekStart) {
      consecutiveWarnings.push({ profileId, name: nameByStaffId.get(profileId) ?? '不明', streak: maxStreak });
    }
  }

  // 週労働時間チェック（当週の確定・公開シフトの合計が週40時間を超えるスタッフ）
  const weeklyMinutesByStaff = new Map<string, number>();
  for (const row of shiftRows ?? []) {
    if (row.kind !== 'confirmed' || row.status !== 'published') continue;
    const minutes = Math.max(0, minutesOf(row.end_time) - minutesOf(row.start_time));
    weeklyMinutesByStaff.set(row.profile_id, (weeklyMinutesByStaff.get(row.profile_id) ?? 0) + minutes);
  }
  const weeklyHourWarnings = [...weeklyMinutesByStaff.entries()]
    .filter(([, minutes]) => minutes > WEEKLY_MINUTES_WARNING_THRESHOLD)
    .map(([profileId, minutes]) => ({ profileId, name: nameByStaffId.get(profileId) ?? '不明', minutes }));

  // 営業時間外シフトチェック（businessHourRows は上の並列ブロックで取得済み）
  const businessHoursByWeekday = new Map((businessHourRows ?? []).map((r) => [r.day_of_week, r]));
  const outOfHoursWarnings: { date: string; label: string; name: string; startTime: string; endTime: string; reason: string }[] = [];
  for (const row of shiftRows ?? []) {
    const bh = businessHoursByWeekday.get(weekdayOf(row.shift_date));
    if (!bh) continue; // 営業時間の設定がない曜日は対象外
    const matchDate = weekDates.find((d) => d.date === row.shift_date);
    const label = matchDate?.label ?? row.shift_date;
    const name = nameByStaffId.get(row.profile_id) ?? '不明';
    if (bh.is_closed) {
      outOfHoursWarnings.push({ date: row.shift_date, label, name, startTime: row.start_time.slice(0, 5), endTime: row.end_time.slice(0, 5), reason: '定休日' });
      continue;
    }
    if (!bh.open_time || !bh.close_time) continue;
    if (minutesOf(row.start_time) < minutesOf(bh.open_time) || minutesOf(row.end_time) > minutesOf(bh.close_time)) {
      outOfHoursWarnings.push({
        date: row.shift_date,
        label,
        name,
        startTime: row.start_time.slice(0, 5),
        endTime: row.end_time.slice(0, 5),
        reason: `営業時間 ${bh.open_time.slice(0, 5)}〜${bh.close_time.slice(0, 5)} 外`,
      });
    }
  }

  return (
    <div>
      <PageHeader title="シフト" description={`${store.name}の週間シフト表`} />

      <div className="mb-4">
        <WeekNav
          weekStart={weekStart}
          weekEnd={weekEnd}
          rangeLabel={rangeLabel}
          canManage={canManage}
          storeId={store.id}
          todayWeekStart={todayWeekStart}
        />
      </div>

      {shortages.length > 0 && (
        <Card className="mb-4 border-warning/30 bg-warning-soft">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">人員が不足している時間帯があります</p>
              <ul className="mt-1 space-y-0.5">
                {shortages.map((sh, i) => (
                  <li key={i}>
                    {sh.label} {sh.timeFrom}〜{sh.timeTo}：必要{sh.required}人に対し確定シフト{sh.actual}人
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {(consecutiveWarnings.length > 0 || weeklyHourWarnings.length > 0 || outOfHoursWarnings.length > 0) && (
        <Card className="mb-4 border-warning/30 bg-warning-soft">
          <CardContent className="space-y-3 p-4 text-sm text-warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-semibold">スタッフ配置の注意（保存を妨げるものではありません）</p>
            </div>
            {consecutiveWarnings.length > 0 && (
              <div>
                <p className="font-medium">
                  連勤（確定シフトが{CONSECUTIVE_DAYS_WARNING_THRESHOLD}日以上連続）
                </p>
                <ul className="mt-1 space-y-0.5">
                  {consecutiveWarnings.map((w) => (
                    <li key={w.profileId}>
                      {w.name}さん {w.streak}連勤
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {weeklyHourWarnings.length > 0 && (
              <div>
                <p className="font-medium">
                  週勤務時間超過（当週合計が{Math.floor(WEEKLY_MINUTES_WARNING_THRESHOLD / 60)}時間超）
                </p>
                <ul className="mt-1 space-y-0.5">
                  {weeklyHourWarnings.map((w) => (
                    <li key={w.profileId}>
                      {w.name}さん {Math.floor(w.minutes / 60)}時間{w.minutes % 60}分
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {outOfHoursWarnings.length > 0 && (
              <div>
                <p className="font-medium">営業時間外シフト</p>
                <ul className="mt-1 space-y-0.5">
                  {outOfHoursWarnings.map((w, i) => (
                    <li key={i}>
                      {w.name}さん {w.label} {w.startTime}〜{w.endTime}（{w.reason}）
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {allRows.length === 0 ? (
        <EmptyState title="この店舗にスタッフが割り当てられていません" description="スタッフ管理から店舗へ割当を行ってください" />
      ) : (
        <ShiftGrid
          storeId={store.id}
          weekDates={weekDates}
          staff={allRows}
          shiftsByKey={shiftsByKey}
          canManage={canManage}
          selfId={ctx.userId}
          orgStaffOptions={orgStaffOptions}
        />
      )}

      <Card className="mt-5">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>人件費シミュレーター（日別・予算比較）</CardTitle>
          <Link href="/app/budgets" className="text-xs font-medium text-primary hover:underline">
            予算は予算管理ページで設定できます
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>日付</Th>
                  <Th>基準</Th>
                  <Th className="text-right">売上基準</Th>
                  <Th className="text-right">予定人件費</Th>
                  <Th className="text-right">人件費率</Th>
                  <Th className="text-right">予算人件費率</Th>
                  <Th className="text-right">差</Th>
                </Tr>
              </THead>
              <TBody>
                {forecastRows.map((r) => (
                  <Tr key={r.date}>
                    <Td className="font-medium text-navy">{r.label}</Td>
                    <Td>
                      <Badge tone={r.source === 'budget' ? 'primary' : 'gray'}>
                        {r.source === 'budget' ? '予算日割り' : '過去4週平均'}
                      </Badge>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {r.salesBasis != null ? yen(r.salesBasis) : <span className="text-xs text-gray-400">予測不可</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{yen(r.plannedLabor)}</Td>
                    <Td
                      className={cn(
                        'text-right tabular-nums font-medium',
                        r.ratio != null && r.ratio > LABOR_COST_RATIO_WARNING_THRESHOLD ? 'text-danger' : 'text-navy'
                      )}
                    >
                      {r.ratio != null ? `${r.ratio.toFixed(1)}%` : '—'}
                    </Td>
                    <Td className="text-right tabular-nums text-gray-500">
                      {r.targetRatio != null ? `${r.targetRatio.toFixed(1)}%` : '—'}
                    </Td>
                    <Td
                      className={cn(
                        'text-right tabular-nums font-medium',
                        r.diff != null && r.diff > 0 ? 'text-danger' : 'text-navy'
                      )}
                    >
                      {r.diff != null ? `${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)}pt` : '—'}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
            当月の予算（店舗別 → 全社の順で優先）が設定されている日は予算売上の日割り（月の予算売上 ÷ 日数）を基準に、未設定の日は過去4週間の同曜日の売上実績（日次締め）の平均で人件費率を計算します。人件費率が
            {LABOR_COST_RATIO_WARNING_THRESHOLD}%を超える日、予算人件費率との差がプラスの日は警告色で表示します。
          </p>
        </CardContent>
      </Card>

      {allRows.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>人件費予測（当週・スタッフ別）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>スタッフ</Th>
                    <Th className="text-right">シフト時間</Th>
                    <Th className="text-right">予測人件費</Th>
                  </Tr>
                </THead>
                <TBody>
                  {laborRows.map((r) => (
                    <Tr key={r.name}>
                      <Td className="font-medium text-navy">
                        {r.name}
                        {r.isHelp && <span className="ml-1.5 text-xs text-primary">（ヘルプ）</span>}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {Math.floor(r.minutes / 60)}:{String(r.minutes % 60).padStart(2, '0')}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {r.cost != null ? yen(r.cost) : <span className="text-xs text-gray-400">時給未設定のため除外</span>}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <div className="border-t border-gray-100 px-5 py-3 text-right text-sm font-semibold text-navy">
              合計（判明分のみ）: {yen(totalCost)}
            </div>
          </CardContent>
        </Card>
      )}

      {canManage && <RequirementsPanel storeId={store.id} requirements={(requirementRows ?? []) as ShiftRequirementRow[]} />}
    </div>
  );
}
