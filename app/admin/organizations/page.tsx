import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { CreateOrganizationDialog } from '@/components/admin/create-organization-dialog';
import { OrganizationRowActions } from '@/components/admin/organization-row-actions';
import { listAllAuthUsers } from '../_utils';

export const metadata: Metadata = { title: '契約企業' };

const STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  trial: { label: 'トライアル', tone: 'primary' },
  active: { label: '契約中', tone: 'success' },
  suspended: { label: '停止中', tone: 'warning' },
  cancelled: { label: '解約済み', tone: 'danger' },
};

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireCypressAdmin();
  const { q, status } = await searchParams;
  const admin = createAdminClient();

  const [{ data: organizations }, { data: plans }, { data: stores }, { data: memberships }, authUsers] =
    await Promise.all([
      admin
        .from('organizations')
        .select('id, name, name_kana, plan_code, status, is_demo, created_at')
        .order('created_at', { ascending: false }),
      admin.from('plans').select('code, name').eq('is_active', true).order('sort_order'),
      admin.from('stores').select('organization_id'),
      admin.from('memberships').select('organization_id, profile_id').eq('status', 'active'),
      listAllAuthUsers(admin),
    ]);

  const planNameByCode = new Map((plans ?? []).map((p) => [p.code, p.name]));
  const lastLoginByUser = new Map(authUsers.users.map((u) => [u.id, u.lastSignInAt]));

  const storeCountByOrg = new Map<string, number>();
  for (const s of stores ?? []) {
    storeCountByOrg.set(s.organization_id, (storeCountByOrg.get(s.organization_id) ?? 0) + 1);
  }
  const memberCountByOrg = new Map<string, number>();
  const lastLoginByOrg = new Map<string, string | null>();
  for (const m of memberships ?? []) {
    memberCountByOrg.set(m.organization_id, (memberCountByOrg.get(m.organization_id) ?? 0) + 1);
    const login = lastLoginByUser.get(m.profile_id) ?? null;
    if (login) {
      const current = lastLoginByOrg.get(m.organization_id);
      if (!current || login > current) lastLoginByOrg.set(m.organization_id, login);
    }
  }

  let rows = organizations ?? [];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (o) => o.name.toLowerCase().includes(needle) || (o.name_kana ?? '').toLowerCase().includes(needle)
    );
  }
  if (status) {
    rows = rows.filter((o) => o.status === status);
  }

  return (
    <div>
      <PageHeader
        title="契約企業"
        description="TENPO ONEを契約している企業の一覧です。"
        actions={<CreateOrganizationDialog plans={plans ?? []} />}
      />

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <Input name="q" defaultValue={q ?? ''} placeholder="企業名・カナで検索" className="w-full sm:w-56" />
        <Select name="status" defaultValue={status ?? ''} className="w-full sm:w-48">
          <option value="">すべての状態</option>
          {Object.entries(STATUS_LABEL).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">絞り込む</Button>
      </form>

      {authUsers.truncated && (
        <p className="mb-3 text-xs text-warning">
          ユーザー数が上限（2,000人）を超えたため、最終ログインの集計は一部のユーザーのみが対象です。
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title="該当する契約企業がありません" description="検索条件を変更するか「企業を作成」から登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>企業名</Th>
                <Th>プラン</Th>
                <Th>状態</Th>
                <Th className="text-right">店舗数</Th>
                <Th className="text-right">ユーザー数</Th>
                <Th>最終ログイン</Th>
                <Th>契約開始日</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((org) => {
                const statusMeta = STATUS_LABEL[org.status] ?? { label: org.status, tone: 'gray' as BadgeTone };
                return (
                  <Tr key={org.id}>
                    <Td>
                      <Link href={`/admin/organizations/${org.id}`} className="group flex items-center gap-2">
                        <div>
                          <p className="font-medium text-navy group-hover:underline">{org.name}</p>
                          {org.name_kana && <p className="text-xs text-gray-400">{org.name_kana}</p>}
                        </div>
                        {org.is_demo && <Badge tone="navy">デモ</Badge>}
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                      </Link>
                    </Td>
                    <Td>{planNameByCode.get(org.plan_code) ?? org.plan_code}</Td>
                    <Td>
                      <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{storeCountByOrg.get(org.id) ?? 0}</Td>
                    <Td className="text-right tabular-nums">{memberCountByOrg.get(org.id) ?? 0}</Td>
                    <Td className="text-xs text-gray-500">{formatDateTime(lastLoginByOrg.get(org.id) ?? null)}</Td>
                    <Td>{formatDate(org.created_at)}</Td>
                    <Td>
                      <OrganizationRowActions organizationId={org.id} status={org.status} />
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
