import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { todayJst, yen, weekdayJa } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { WeekNav } from './week-nav';
import { ShiftGrid, type ShiftLite, type StaffRow } from './shift-grid';

export const metadata: Metadata = { title: 'シフト' };

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

  const { data: shiftRows } = staffIds.length
    ? await supabase
        .from('shifts')
        .select('id, profile_id, shift_date, start_time, end_time, kind, status')
        .eq('store_id', store.id)
        .in('profile_id', staffIds)
        .gte('shift_date', weekStart)
        .lte('shift_date', weekEnd)
        .neq('status', 'cancelled')
        .order('shift_date')
        .order('start_time')
    : { data: [] };

  const shiftsByKey: Record<string, ShiftLite[]> = {};
  for (const row of shiftRows ?? []) {
    const key = `${row.profile_id}_${row.shift_date}`;
    (shiftsByKey[key] ??= []).push({
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
      kind: row.kind,
      status: row.status,
    });
  }

  // 人件費予測
  const { data: rules } = staffIds.length
    ? await supabase
        .from('payroll_rules')
        .select('profile_id, base_amount, effective_from, effective_to')
        .eq('organization_id', ctx.organizationId)
        .in('profile_id', staffIds)
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

  const laborRows = staff.map((s) => {
    const minutes = (shiftRows ?? [])
      .filter((row) => row.profile_id === s.id)
      .reduce((sum, row) => sum + Math.max(0, minutesOf(row.end_time) - minutesOf(row.start_time)), 0);
    const rate = rateByProfile.get(s.id);
    const cost = rate != null ? Math.round((rate * minutes) / 60) : null;
    return { name: s.name, minutes, cost };
  });
  const totalCost = laborRows.reduce((a, r) => a + (r.cost ?? 0), 0);

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

      {staff.length === 0 ? (
        <EmptyState title="この店舗にスタッフが割り当てられていません" description="スタッフ管理から店舗へ割当を行ってください" />
      ) : (
        <ShiftGrid
          storeId={store.id}
          weekDates={weekDates}
          staff={staff}
          shiftsByKey={shiftsByKey}
          canManage={canManage}
          selfId={ctx.userId}
        />
      )}

      {staff.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>人件費予測（当週）</CardTitle>
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
                      <Td className="font-medium text-navy">{r.name}</Td>
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
    </div>
  );
}
