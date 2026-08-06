import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { summarizeEntry } from '@/lib/payroll';
import { todayJst, formatTime, formatMinutes, weekdayJa } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { ClockSection } from '@/components/attendance/clock-section';
import { PeriodFilters } from '@/components/attendance/period-filters';
import { CorrectionDialog } from '@/components/attendance/correction-dialog';
import { RequestReview } from '@/components/attendance/request-review';

export const metadata: Metadata = { title: '勤怠' };

type Tab = 'punch' | 'list' | 'requests';

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function toJstHHmm(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('sv-SE', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; staffId?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireMember();
  const store = ctx.currentStore ?? ctx.stores[0];
  const isApprover = can(ctx.role, 'attendance.approve');
  const tab: Tab = sp.tab === 'list' ? 'list' : sp.tab === 'requests' && isApprover ? 'requests' : sp.tab === 'punch' || !sp.tab ? 'punch' : 'list';

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
      {tab === 'requests' && isApprover && <RequestsTab storeId={store.id} />}
    </div>
  );
}

async function PunchTab({ storeId, profileId, displayName }: { storeId: string; profileId: string; displayName: string }) {
  const supabase = await createClient();
  const today = todayJst();

  const { data: entry } = await supabase
    .from('time_entries')
    .select('id, clock_in_at, clock_out_at')
    .eq('profile_id', profileId)
    .eq('store_id', storeId)
    .eq('work_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let lastEventType: string | null = null;
  if (entry?.id) {
    const { data: lastEvent } = await supabase
      .from('time_entry_events')
      .select('event_type')
      .eq('time_entry_id', entry.id)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastEventType = lastEvent?.event_type ?? null;
  }

  const open = !!entry && !!entry.clock_in_at && !entry.clock_out_at;
  const onBreak = open && lastEventType === 'break_start';

  return (
    <ClockSection
      storeId={storeId}
      displayName={displayName}
      punchState={{
        canClockIn: !open,
        canClockOut: open && !onBreak,
        canBreakStart: open && !onBreak,
        canBreakEnd: open && onBreak,
      }}
    />
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
  const supabase = await createClient();
  const { start, end } = monthRange(month);

  let staffOptions: { id: string; name: string }[] = [];
  let targetProfileIds: string[] = [selfId];

  if (isApprover) {
    const { data: msRows } = await supabase.from('membership_stores').select('membership_id').eq('store_id', storeId);
    const membershipIds = (msRows ?? []).map((r) => r.membership_id);
    const { data: memberRows } = membershipIds.length
      ? await supabase
          .from('memberships')
          .select('profile_id, profiles(id, display_name)')
          .in('id', membershipIds)
          .eq('organization_id', organizationId)
          .eq('status', 'active')
      : { data: [] };
    staffOptions = (memberRows ?? [])
      .map((m) => {
        const p = m.profiles as unknown as { id: string; display_name: string } | null;
        return p ? { id: p.id, name: p.display_name } : null;
      })
      .filter((s): s is { id: string; name: string } => !!s)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    targetProfileIds = staffId ? [staffId] : staffOptions.map((s) => s.id);
    if (targetProfileIds.length === 0) targetProfileIds = [selfId];
  }

  const nameById = new Map(staffOptions.map((s) => [s.id, s.name]));

  const { data: entries } = await supabase
    .from('time_entries')
    .select('*')
    .eq('store_id', storeId)
    .in('profile_id', targetProfileIds)
    .gte('work_date', start)
    .lte('work_date', end)
    .order('work_date', { ascending: false });

  const rows = entries ?? [];

  return (
    <div className="space-y-4">
      <PeriodFilters month={month} staffId={staffId} staffOptions={isApprover ? staffOptions : []} />

      {rows.length === 0 ? (
        <EmptyState title="この期間の勤怠記録はありません" description="打刻タブから出勤を記録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>日付</Th>
                {isApprover && targetProfileIds.length > 1 && <Th>スタッフ</Th>}
                <Th>出勤</Th>
                <Th>退勤</Th>
                <Th className="text-right">休憩</Th>
                <Th className="text-right">実働</Th>
                <Th>状態</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                const missing = !row.clock_out_at && row.work_date < today;
                const worked =
                  row.clock_in_at && row.clock_out_at
                    ? summarizeEntry({
                        clockInAt: new Date(row.clock_in_at),
                        clockOutAt: new Date(row.clock_out_at),
                        breakMinutes: row.break_minutes,
                      })
                    : null;
                return (
                  <Tr key={row.id}>
                    <Td className="font-medium text-navy">
                      {row.work_date.slice(5).replace('-', '/')}（{weekdayJa(row.work_date)}）
                    </Td>
                    {isApprover && targetProfileIds.length > 1 && (
                      <Td>{nameById.get(row.profile_id) ?? '—'}</Td>
                    )}
                    <Td>{formatTime(row.clock_in_at)}</Td>
                    <Td>{row.clock_out_at ? formatTime(row.clock_out_at) : missing ? '未打刻' : '—'}</Td>
                    <Td className="text-right tabular-nums">{row.break_minutes}分</Td>
                    <Td className="text-right tabular-nums">{worked ? formatMinutes(worked.workMinutes) : '—'}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {missing && (
                          <Badge tone="danger" className="inline-flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            打刻漏れ
                          </Badge>
                        )}
                        <Badge tone={row.status === 'approved' ? 'success' : row.status === 'closed' ? 'primary' : 'gray'}>
                          {row.status === 'approved' ? '承認済' : row.status === 'closed' ? '打刻済' : '勤務中'}
                        </Badge>
                      </div>
                    </Td>
                    <Td className="text-right">
                      <CorrectionDialog
                        storeId={storeId}
                        profileId={row.profile_id}
                        workDate={row.work_date}
                        timeEntryId={row.id}
                        defaultClockIn={toJstHHmm(row.clock_in_at)}
                        defaultClockOut={toJstHHmm(row.clock_out_at)}
                        defaultBreakMinutes={row.break_minutes}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

async function RequestsTab({ storeId }: { storeId: string }) {
  const supabase = await createClient();
  const { data: requests } = await supabase
    .from('attendance_requests')
    .select('*, profiles(display_name), time_entries(clock_in_at, clock_out_at, break_minutes)')
    .eq('store_id', storeId)
    .eq('status', 'pending')
    .order('created_at');

  const rows = requests ?? [];

  if (rows.length === 0) {
    return <EmptyState title="承認待ちの申請はありません" />;
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const changes = r.requested_changes as {
          work_date: string;
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
                {profile?.display_name ?? '不明'} さん — {changes.work_date}
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
              <div className="mt-4">
                <RequestReview requestId={r.id} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
