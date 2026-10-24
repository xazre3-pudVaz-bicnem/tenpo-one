import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { summarizeEntry } from '@/lib/payroll';
import { todayJst, formatTime, formatMinutes, weekdayJa } from '@/lib/format';
import { loadAttendanceList, loadCorrectionRequests, loadPunchState } from '@/lib/attendance-server';
import { attendanceTab, toJstHHmm } from '@/lib/native-attendance';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th } from '@/components/ui/table';
import { ClockSection } from '@/components/attendance/clock-section';
import { PeriodFilters } from '@/components/attendance/period-filters';
import { RequestReview } from '@/components/attendance/request-review';
import { ManualEntryDialog } from '@/components/attendance/manual-entry-dialog';
import { AttendanceRow } from '@/components/attendance/attendance-row';
import { canReviewRequests } from './shared';
import type { EntryType } from './actions';

export const metadata: Metadata = { title: '勤怠' };

type Tab = 'punch' | 'list' | 'requests';

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; staffId?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFeature('attendance');
  const store = ctx.currentStore ?? ctx.stores[0];
  const isApprover = can(ctx.role, 'attendance.approve');
  const tab: Tab = attendanceTab(sp.tab, isApprover);

  if (!store) {
    return (
      <div>
        <PageHeader title="勤怠" />
        <EmptyState title="所属店舗がありません" description="スタッフ管理から店舗への割当を行ってください" />
      </div>
    );
  }

  const today = todayJst();

  const tabs: { key: Tab; label: string }[] = [
    { key: 'punch', label: '打刻' },
    { key: 'list', label: '勤怠一覧' },
    ...(isApprover ? [{ key: 'requests' as Tab, label: '承認' }] : []),
  ];

  return (
    <div>
      <PageHeader title="勤怠" description={`${store.name}の打刻・勤怠管理`} />

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/app/attendance?tab=${t.key}`}
            className={cn(
              'border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary text-primary-deep' : 'border-transparent text-gray-500 hover:text-navy'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'punch' && <PunchTab storeId={store.id} profileId={ctx.userId} displayName={ctx.displayName} />}
      {tab === 'list' && (
        <ListTab
          storeId={store.id}
          organizationId={ctx.organizationId}
          selfId={ctx.userId}
          isApprover={isApprover}
          month={sp.month ?? today.slice(0, 7)}
          staffId={sp.staffId ?? ''}
          today={today}
        />
      )}
      {tab === 'requests' && isApprover && <RequestsTab storeId={store.id} canReview={canReviewRequests(ctx.role)} />}
    </div>
  );
}

async function PunchTab({ storeId, profileId, displayName }: { storeId: string; profileId: string; displayName: string }) {
  // 読み込みは lib/attendance-server.ts（iPad ネイティブと同じ）
  const supabase = await createClient();
  const { todayShift, elsewhere, open, onBreak } = await loadPunchState(supabase, { storeId, profileId });

  return (
    <div>
      {todayShift && (
        <div className="mx-auto mb-4 max-w-md rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-center text-sm font-medium text-primary-deep">
          本日のシフト: {todayShift.start_time.slice(0, 5)}〜{todayShift.end_time.slice(0, 5)}
        </div>
      )}
      {!open && elsewhere && (
        <div className="mx-auto mb-4 max-w-md rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-center text-sm font-medium text-danger">
          {elsewhere.storeName ?? '他店舗'}で出勤打刻が残っています。先にそちらで退勤してください。
        </div>
      )}
      <ClockSection
        storeId={storeId}
        displayName={displayName}
        onBreak={onBreak}
        punchState={{
          canClockIn: !open,
          canClockOut: open && !onBreak,
          canBreakStart: open && !onBreak,
          canBreakEnd: open && onBreak,
        }}
      />
    </div>
  );
}

async function ListTab({
  storeId,
  organizationId,
  selfId,
  isApprover,
  month,
  staffId,
  today,
}: {
  storeId: string;
  organizationId: string;
  selfId: string;
  isApprover: boolean;
  month: string;
  staffId: string;
  today: string;
}) {
  // 読み込みは lib/attendance-server.ts（iPad ネイティブと同じ）
  const supabase = await createClient();
  const { staffOptions, targetProfileIds, rows, eventsByEntry, lockedRanges } = await loadAttendanceList(supabase, {
    storeId,
    organizationId,
    selfId,
    isApprover,
    month,
    staffId,
  });

  const nameById = new Map(staffOptions.map((s) => [s.id, s.name]));

  // 締め後ロック（給与run確定済み）: 各行の work_date がロック対象かを判定しバッジ表示・操作ボタン非表示に反映する
  // （実際の書込拒否は各サーバーアクション側の isPayrollLocked で行う）
  const isLocked = (workDate: string) =>
    lockedRanges.some((r) => r.period_start <= workDate && r.period_end >= workDate);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodFilters month={month} staffId={staffId} staffOptions={isApprover ? staffOptions : []} />
        {isApprover && (
          <ManualEntryDialog storeId={storeId} staffOptions={staffOptions} defaultDate={today} />
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="この期間の勤怠記録はありません" description="打刻タブから出勤を記録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th className="w-8"></Th>
                <Th>日付</Th>
                {isApprover && targetProfileIds.length > 1 && <Th>スタッフ</Th>}
                <Th>出勤</Th>
                <Th>退勤</Th>
                <Th className="text-right">休憩</Th>
                <Th className="text-right">実働</Th>
                <Th>区分</Th>
                <Th>状態</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                const missing = !row.clock_out_at && row.work_date < today;
                const entryType = (row.entry_type ?? 'normal') as EntryType;
                const worked =
                  row.clock_in_at && row.clock_out_at
                    ? summarizeEntry({
                        clockInAt: new Date(row.clock_in_at),
                        clockOutAt: new Date(row.clock_out_at),
                        breakMinutes: row.break_minutes,
                        isHolidayWork: entryType === 'holiday_work',
                      })
                    : null;
                return (
                  <AttendanceRow
                    key={row.id}
                    id={row.id}
                    workDateLabel={`${row.work_date.slice(5).replace('-', '/')}（${weekdayJa(row.work_date)}）`}
                    staffName={nameById.get(row.profile_id) ?? null}
                    showStaffColumn={isApprover && targetProfileIds.length > 1}
                    clockInLabel={formatTime(row.clock_in_at)}
                    clockOutLabel={row.clock_out_at ? formatTime(row.clock_out_at) : missing ? '未打刻' : '—'}
                    breakMinutes={row.break_minutes}
                    workedLabel={worked ? formatMinutes(worked.workMinutes) : '—'}
                    entryType={entryType}
                    missing={missing}
                    status={row.status}
                    locked={isLocked(row.work_date)}
                    isApprover={isApprover}
                    storeId={storeId}
                    profileId={row.profile_id}
                    workDate={row.work_date}
                    timeEntryId={row.id}
                    defaultClockIn={toJstHHmm(row.clock_in_at)}
                    defaultClockOut={toJstHHmm(row.clock_out_at)}
                    events={eventsByEntry.get(row.id) ?? []}
                  />
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

async function RequestsTab({ storeId, canReview }: { storeId: string; canReview: boolean }) {
  // 読み込みは lib/attendance-server.ts（iPad ネイティブと同じ）
  const rows = await loadCorrectionRequests(await createClient(), storeId);

  if (rows.length === 0) {
    return <EmptyState title="承認待ちの申請はありません" />;
  }

  return (
    <div className="space-y-3">
      {!canReview && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          この申請の承認・却下は店長以上のロールのみ行えます。閲覧のみ可能です。
        </p>
      )}
      {rows.map((r) => {
        const changes = r.requested_changes as {
          clock_in_at: string;
          clock_out_at: string;
          break_minutes: number;
        };
        const current = r.time_entries as unknown as
          | { clock_in_at: string | null; clock_out_at: string | null; break_minutes: number }
          | null;
        const profile = r.profiles as unknown as { display_name: string } | null;
        return (
          <Card key={r.id}>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>
                {profile?.display_name ?? '不明'} さん — {r.work_date}
              </CardTitle>
              <Badge tone="warning">承認待ち</Badge>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">現在値</p>
                  <p className="text-sm text-navy">
                    {current?.clock_in_at ? formatTime(current.clock_in_at) : '未登録'} 〜{' '}
                    {current?.clock_out_at ? formatTime(current.clock_out_at) : '未登録'}（休憩{' '}
                    {current?.break_minutes ?? 0}分）
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-gray-500">希望値</p>
                  <p className="text-sm font-medium text-primary-deep">
                    {formatTime(changes.clock_in_at)} 〜 {formatTime(changes.clock_out_at)}（休憩{' '}
                    {changes.break_minutes}分）
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500">理由</p>
              <p className="text-sm text-gray-700">{r.reason}</p>
              {canReview && (
                <div className="mt-4">
                  <RequestReview requestId={r.id} />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
