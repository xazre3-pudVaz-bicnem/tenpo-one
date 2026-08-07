import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { todayJst, yen, weekdayJa } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  const ctx = await requireMember();
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

  // 当店スタッフ
  const { data: msRows } = await supabase.from('membership_stores').select('membership_id').eq('store_id', store.id);
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

  // 当週の全シフト（他店舗スタッフによる店舗間ヘルプも含めて店舗単位で取得）
  const { data: shiftRows } = await supabase
    .from('shifts')
    .select('id, profile_id, shift_date, start_time, end_time, kind, status, note')
    .eq('store_id', store.id)
    .gte('shift_date', weekStart)
    .lte('shift_date', weekEnd)
    .neq('status', 'cancelled')
    .order('shift_date')
    .order('start_time');

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
  const { data: closingRows } = await supabase
    .from('daily_closings')
    .select('business_date, sales_total')
    .eq('store_id', store.id)
    .gte('business_date', lookbackStart)
    .lte('business_date', lookbackEnd)
    .in('status', ['closed', 'approved']);
  const salesByWeekday = new Map<number, number[]>();
  for (const row of closingRows ?? []) {
    const wd = weekdayOf(row.business_date);
    const list = salesByWeekday.get(wd) ?? [];
    list.push(row.sales_total);
    salesByWeekday.set(wd, list);
  }

  const forecastRows = weekDates.map((d) => {
    const samples = salesByWeekday.get(weekdayOf(d.date)) ?? [];
    const predictedSales = samples.length > 0 ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null;
    const plannedLabor = dailyLaborCost[d.date] ?? 0;
    const ratio = predictedSales && predictedSales > 0 ? (plannedLabor / predictedSales) * 100 : null;
    return { date: d.date, label: d.label, predictedSales, plannedLabor, ratio };
  });

  // 時間帯別必要人数と、当週の不足チェック
  const { data: requirementRows } = await supabase
    .from('shift_requirements')
    .select('*')
    .eq('store_id', store.id)
    .order('day_of_week')
    .order('time_from');

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
        <CardHeader>
          <CardTitle>売上予測に対する予定人件費（日別）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>日付</Th>
                  <Th className="text-right">予測売上</Th>
                  <Th className="text-right">予定人件費</Th>
                  <Th className="text-right">人件費率</Th>
                </Tr>
              </THead>
              <TBody>
                {forecastRows.map((r) => (
                  <Tr key={r.date}>
                    <Td className="font-medium text-navy">{r.label}</Td>
                    <Td className="text-right tabular-nums">
                      {r.predictedSales != null ? yen(r.predictedSales) : <span className="text-xs text-gray-400">予測不可</span>}
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
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
            予測売上は過去4週間の同曜日の売上実績（日次締め）の平均です。人件費率が{LABOR_COST_RATIO_WARNING_THRESHOLD}%を超える日は警告色で表示します。
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
