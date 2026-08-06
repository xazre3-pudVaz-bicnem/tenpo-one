import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { CreateOrganizationDialog } from '@/components/admin/create-organization-dialog';
import { OrganizationRowActions } from '@/components/admin/organization-row-actions';

export const metadata: Metadata = { title: '契約企業' };

const STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  trial: { label: 'トライアル', tone: 'primary' },
  active: { label: '契約中', tone: 'success' },
  suspended: { label: '停止中', tone: 'warning' },
  cancelled: { label: '解約済み', tone: 'danger' },
};

export default async function OrganizationsPage() {
  await requireCypressAdmin();
  const admin = createAdminClient();

  const [{ data: organizations }, { data: plans }, { data: stores }, { data: memberships }] = await Promise.all([
    admin
      .from('organizations')
      .select('id, name, name_kana, plan_code, status, is_demo, created_at')
      .order('created_at', { ascending: false }),
    admin.from('plans').select('code, name').eq('is_active', true).order('sort_order'),
    admin.from('stores').select('organization_id'),
    admin.from('memberships').select('organization_id').eq('status', 'active'),
  ]);

  const planNameByCode = new Map((plans ?? []).map((p) => [p.code, p.name]));
  const storeCountByOrg = new Map<string, number>();
  for (const s of stores ?? []) {
    storeCountByOrg.set(s.organization_id, (storeCountByOrg.get(s.organization_id) ?? 0) + 1);
  }
  const memberCountByOrg = new Map<string, number>();
  for (const m of memberships ?? []) {
    memberCountByOrg.set(m.organization_id, (memberCountByOrg.get(m.organization_id) ?? 0) + 1);
  }

  const rows = organizations ?? [];

  return (
    <div>
      <PageHeader
        title="契約企業"
        description="TENPO ONEを契約している企業の一覧です。"
        actions={<CreateOrganizationDialog plans={plans ?? []} />}
      />

      {rows.length === 0 ? (
        <EmptyState title="契約企業がまだありません" description="「企業を作成」から最初の契約企業を登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>企業名</Th>
                <Th>プラン</Th>
                <Th>状態</Th>
                <Th className="text-right">店舗数</Th>
                <Th className="text-right">メンバー数</Th>
                <Th>作成日</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((org) => {
                const status = STATUS_LABEL[org.status] ?? { label: org.status, tone: 'gray' as BadgeTone };
                return (
                  <Tr key={org.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-medium text-navy">{org.name}</p>
                          {org.name_kana && <p className="text-xs text-gray-400">{org.name_kana}</p>}
                        </div>
                        {org.is_demo && <Badge tone="navy">デモ</Badge>}
                      </div>
                    </Td>
                    <Td>{planNameByCode.get(org.plan_code) ?? org.plan_code}</Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{storeCountByOrg.get(org.id) ?? 0}</Td>
                    <Td className="text-right tabular-nums">{memberCountByOrg.get(org.id) ?? 0}</Td>
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
