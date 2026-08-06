import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ROLE_LABELS, ROLES } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';

export const metadata: Metadata = { title: '全ユーザー' };

interface MembershipRow {
  id: string;
  profile_id: string;
  organization_id: string;
  role: string;
  status: string;
  profiles: { display_name: string; is_cypress_admin: boolean } | { display_name: string; is_cypress_admin: boolean }[] | null;
  organizations: { name: string } | { name: string }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  await requireCypressAdmin();
  const { q, role } = await searchParams;
  const admin = createAdminClient();

  const [{ data: memberships }, { data: userList }] = await Promise.all([
    admin
      .from('memberships')
      .select('id, profile_id, organization_id, role, status, profiles(display_name, is_cypress_admin), organizations(name)')
      .order('created_at', { ascending: false }),
    admin.auth.admin.listUsers({ perPage: 200 }),
  ]);

  const emailById = new Map((userList?.users ?? []).map((u) => [u.id, u.email ?? '—']));

  let rows = (memberships ?? []) as unknown as MembershipRow[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => (one(r.profiles)?.display_name ?? '').toLowerCase().includes(needle));
  }
  if (role) {
    rows = rows.filter((r) => r.role === role);
  }

  return (
    <div>
      <PageHeader title="全ユーザー" description="全契約企業に所属するユーザーを横断検索できます。" />

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Input name="q" defaultValue={q ?? ''} placeholder="氏名で検索" className="w-full sm:w-56" />
        <Select name="role" defaultValue={role ?? ''} className="w-full sm:w-56">
          <option value="">すべてのロール</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">絞り込む</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="該当するユーザーがいません" description="検索条件を変更してお試しください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>氏名</Th>
                <Th>メールアドレス</Th>
                <Th>企業名</Th>
                <Th>ロール</Th>
                <Th>状態</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((m) => {
                const profile = one(m.profiles);
                const org = one(m.organizations);
                return (
                  <Tr key={m.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-navy">{profile?.display_name ?? '—'}</span>
                        {profile?.is_cypress_admin && <Badge tone="navy">運営管理者</Badge>}
                      </div>
                    </Td>
                    <Td className="font-mono text-xs">{emailById.get(m.profile_id) ?? '—'}</Td>
                    <Td>{org?.name ?? '—'}</Td>
                    <Td>{ROLE_LABELS[m.role as keyof typeof ROLE_LABELS] ?? m.role}</Td>
                    <Td>
                      <Badge tone={m.status === 'active' ? 'success' : m.status === 'invited' ? 'primary' : 'warning'}>
                        {m.status === 'active' ? '有効' : m.status === 'invited' ? '招待中' : '停止中'}
                      </Badge>
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
