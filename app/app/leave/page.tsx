import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature, type SessionContext } from '@/lib/auth';
import { can, type Role } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { todayJst, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { LeaveGrantDialog } from '@/components/leave/grant-dialog';
import { LeavePolicyForm } from '@/components/leave/policy-form';

export const metadata: Metadata = { title: '有給休暇' };

type Ctx = SessionContext & { organizationId: string; role: Role };
type Tab = 'mine' | 'admin';

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mapMembers(rows: unknown[] | null): { id: string; name: string }[] {
  return ((rows ?? []) as { profile_id: string; profiles: unknown }[])
    .map((m) => {
      const p = m.profiles as unknown as { id: string; display_name: string } | null;
      return p ? { id: p.id, name: p.display_name } : null;
    })
    .filter((s): s is { id: string; name: string } => !!s);
}

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFeature('attendance');
  const isApprover = can(ctx.role, 'attendance.approve');
  const canSetPolicy = can(ctx.role, 'org.settings');
  const tab: Tab = sp.tab === 'admin' && isApprover ? 'admin' : 'mine';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'mine', label: '自分の有給' },
    ...(isApprover ? [{ key: 'admin' as Tab, label: '管理' }] : []),
  ];

  return (
    <div>
      <PageHeader title="有給休暇" description="有給休暇の残日数・付与履歴・取得履歴を管理します" />

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/app/leave?tab=${t.key}`}
            className={cn(
              'border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary text-primary-deep' : 'border-transparent text-gray-500 hover:text-navy'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'mine' && <MineTab ctx={ctx} />}
      {tab === 'admin' && isApprover && <AdminTab ctx={ctx} canSetPolicy={canSetPolicy} />}
    </div>
  );
}

async function MineTab({ ctx }: { ctx: Ctx }) {
  const supabase = await createClient();
  const today = todayJst();

  const { data: grants } = await supabase
    .from('leave_grants')
    .select('*')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', ctx.userId)
    .order('granted_on', { ascending: false });
  const { data: takenEntries } = await supabase
    .from('time_entries')
    .select('id, work_date, leave_fraction, note')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', ctx.userId)
    .eq('entry_type', 'paid_leave')
    .in('status', ['approved', 'closed'])
    .order('work_date', { ascending: false });

  const grantRows = (grants ?? []) as { id: string; granted_on: string; days: number; expires_on: string; reason: string }[];
  const takenRows = (takenEntries ?? []) as { id: string; work_date: string; leave_fraction: number | null; note: string | null }[];

  const activeGranted = grantRows.filter((g) => g.expires_on >= today).reduce((a, g) => a + Number(g.days), 0);
  const expiredTotal = grantRows.filter((g) => g.expires_on < today).reduce((a, g) => a + Number(g.days), 0);
  const taken = takenRows.reduce((a, e) => a + Number(e.leave_fraction ?? 1), 0);
  const remaining = activeGranted - taken;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="残日数" value={`${remaining}日`} tone={remaining < 0 ? 'danger' : 'primary'} />
        <StatCard label="付与合計（有効分）" value={`${activeGranted}日`} />
        <StatCard label="取得合計" value={`${taken}日`} />
        <StatCard label="失効分" value={`${expiredTotal}日`} tone={expiredTotal > 0 ? 'warning' : 'default'} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>付与履歴</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {grantRows.length === 0 ? (
            <div className="p-5">
              <EmptyState title="付与履歴はありません" className="border-0 py-8" />
            </div>
          ) : (
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>付与日</Th>
                    <Th className="text-right">日数</Th>
                    <Th>失効日</Th>
                    <Th>理由</Th>
                    <Th>状態</Th>
                  </Tr>
                </THead>
                <TBody>
                  {grantRows.map((g) => (
                    <Tr key={g.id}>
                      <Td>{formatDate(g.granted_on)}</Td>
                      <Td className="text-right tabular-nums">{g.days}日</Td>
                      <Td>{formatDate(g.expires_on)}</Td>
                      <Td>{g.reason === 'adjustment' ? '調整' : '年次付与'}</Td>
                      <Td>
                        {g.expires_on < today ? <Badge tone="gray">失効済み</Badge> : <Badge tone="success">有効</Badge>}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>取得履歴</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {takenRows.length === 0 ? (
            <div className="p-5">
              <EmptyState title="取得履歴はありません" className="border-0 py-8" />
            </div>
          ) : (
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>取得日</Th>
                    <Th>区分</Th>
                    <Th>備考</Th>
                  </Tr>
                </THead>
                <TBody>
                  {takenRows.map((e) => (
                    <Tr key={e.id}>
                      <Td>{formatDate(e.work_date)}</Td>
                      <Td>{(e.leave_fraction ?? 1) === 0.5 ? '半休' : '全休'}</Td>
                      <Td className="text-gray-500">{e.note || '—'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function AdminTab({ ctx, canSetPolicy }: { ctx: Ctx; canSetPolicy: boolean }) {
  const supabase = await createClient();
  const today = todayJst();
  const soonThreshold = addDays(today, 60);

  let staffOptions: { id: string; name: string }[];
  if (ctx.isHq) {
    const { data: memberRows } = await supabase
      .from('memberships')
      .select('profile_id, profiles(id, display_name)')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active');
    staffOptions = mapMembers(memberRows);
  } else {
    const storeIds = ctx.stores.map((s) => s.id);
    const { data: msRows } = storeIds.length
      ? await supabase.from('membership_stores').select('membership_id').in('store_id', storeIds)
      : { data: [] };
    const membershipIds = [...new Set((msRows ?? []).map((r) => r.membership_id as string))];
    const { data: memberRows } = membershipIds.length
      ? await supabase
          .from('memberships')
          .select('profile_id, profiles(id, display_name)')
          .in('id', membershipIds)
          .eq('organization_id', ctx.organizationId)
          .eq('status', 'active')
      : { data: [] };
    staffOptions = mapMembers(memberRows);
  }
  staffOptions.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const profileIds = staffOptions.map((s) => s.id);
  const { data: allGrants } = profileIds.length
    ? await supabase.from('leave_grants').select('*').eq('organization_id', ctx.organizationId).in('profile_id', profileIds)
    : { data: [] };
  const { data: allTaken } = profileIds.length
    ? await supabase
        .from('time_entries')
        .select('profile_id, leave_fraction')
        .eq('organization_id', ctx.organizationId)
        .eq('entry_type', 'paid_leave')
        .in('status', ['approved', 'closed'])
        .in('profile_id', profileIds)
    : { data: [] };
  const { data: orgRow } = canSetPolicy
    ? await supabase.from('organizations').select('leave_policy').eq('id', ctx.organizationId).maybeSingle()
    : { data: null };

  const grantRows = (allGrants ?? []) as { id: string; profile_id: string; days: number; expires_on: string }[];
  const takenRows = (allTaken ?? []) as { profile_id: string; leave_fraction: number | null }[];

  const grantsByProfile = new Map<string, { granted: number; expired: number }>();
  for (const g of grantRows) {
    const cur = grantsByProfile.get(g.profile_id) ?? { granted: 0, expired: 0 };
    if (g.expires_on >= today) cur.granted += Number(g.days);
    else cur.expired += Number(g.days);
    grantsByProfile.set(g.profile_id, cur);
  }
  const takenByProfile = new Map<string, number>();
  for (const e of takenRows) {
    takenByProfile.set(e.profile_id, (takenByProfile.get(e.profile_id) ?? 0) + Number(e.leave_fraction ?? 1));
  }

  const expiringSoon = grantRows
    .filter((g) => g.expires_on >= today && g.expires_on <= soonThreshold)
    .sort((a, b) => a.expires_on.localeCompare(b.expires_on));
  const nameByProfile = new Map(staffOptions.map((s) => [s.id, s.name]));

  const orgPolicy = (orgRow?.leave_policy ?? {}) as { expiry_years?: number; memo?: string };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <LeaveGrantDialog staffOptions={staffOptions} defaultExpiryYears={orgPolicy.expiry_years ?? 2} />
      </div>

      {expiringSoon.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>失効間近（60日以内）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>スタッフ</Th>
                    <Th className="text-right">日数</Th>
                    <Th>失効日</Th>
                  </Tr>
                </THead>
                <TBody>
                  {expiringSoon.map((g) => (
                    <Tr key={g.id}>
                      <Td className="font-medium text-navy">{nameByProfile.get(g.profile_id) ?? '—'}</Td>
                      <Td className="text-right tabular-nums">{g.days}日</Td>
                      <Td>
                        <Badge tone="warning">{formatDate(g.expires_on)}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>スタッフ別 残日数</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {staffOptions.length === 0 ? (
            <div className="p-5">
              <EmptyState title="対象スタッフがいません" className="border-0 py-8" />
            </div>
          ) : (
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>スタッフ</Th>
                    <Th className="text-right">付与（有効分）</Th>
                    <Th className="text-right">取得</Th>
                    <Th className="text-right">失効</Th>
                    <Th className="text-right">残日数</Th>
                  </Tr>
                </THead>
                <TBody>
                  {staffOptions.map((s) => {
                    const g = grantsByProfile.get(s.id) ?? { granted: 0, expired: 0 };
                    const taken = takenByProfile.get(s.id) ?? 0;
                    const remaining = g.granted - taken;
                    return (
                      <Tr key={s.id}>
                        <Td className="font-medium text-navy">{s.name}</Td>
                        <Td className="text-right tabular-nums">{g.granted}日</Td>
                        <Td className="text-right tabular-nums">{taken}日</Td>
                        <Td className="text-right tabular-nums">{g.expired}日</Td>
                        <Td className={cn('text-right font-semibold tabular-nums', remaining < 0 ? 'text-danger' : 'text-navy')}>
                          {remaining}日
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {canSetPolicy && <LeavePolicyForm initial={{ expiryYears: orgPolicy.expiry_years ?? 2, memo: orgPolicy.memo ?? '' }} />}
    </div>
  );
}
