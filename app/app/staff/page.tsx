import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ROLES, ROLE_LABELS, HQ_ROLES, type Role } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { InviteDialogTrigger } from '@/components/staff/invite-dialog';
import { StaffFilters } from '@/components/staff/staff-filters';
import { StaffRowMenu } from '@/components/staff/row-menu';

export const metadata: Metadata = { title: 'スタッフ管理' };

interface MembershipRow {
  id: string;
  role: Role;
  status: 'active' | 'invited' | 'suspended';
  profile_id: string;
  profiles: { id: string; display_name: string; display_name_kana: string | null; pin_code: string | null } | null;
  membership_stores: { store_id: string; stores: { id: string; name: string } | null }[];
}

const STATUS_TONE: Record<string, 'success' | 'primary' | 'gray'> = {
  active: 'success',
  invited: 'primary',
  suspended: 'gray',
};
const STATUS_LABEL: Record<string, string> = { active: '有効', invited: '招待中', suspended: '停止中' };

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; store?: string; status?: string }>;
}) {
  const ctx = await requirePermission('staff.manage');
  const { role: roleFilter, store: storeFilter, status: statusFilter } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('memberships')
    .select(
      `id, role, status, profile_id,
       profiles ( id, display_name, display_name_kana, pin_code ),
       membership_stores ( store_id, stores ( id, name ) )`
    )
    .eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: false });

  if (roleFilter && (ROLES as readonly string[]).includes(roleFilter)) {
    query = query.eq('role', roleFilter);
  }
  if (statusFilter && ['active', 'invited', 'suspended'].includes(statusFilter)) {
    query = query.eq('status', statusFilter);
  }

  const { data } = await query;
  let rows = (data ?? []) as unknown as MembershipRow[];

  if (storeFilter) {
    rows = rows.filter((r) => r.membership_stores.some((ms) => ms.store_id === storeFilter));
  }

  return (
    <div>
      <PageHeader
        title="スタッフ管理"
        description={`${ctx.organizationName ?? ''}の登録スタッフ`}
        actions={<InviteDialogTrigger stores={ctx.stores} />}
      />

      <StaffFilters
        roles={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        stores={ctx.stores}
        current={{ role: roleFilter ?? '', store: storeFilter ?? '', status: statusFilter ?? '' }}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="該当するスタッフがいません"
          description="「スタッフを招待」から最初のメンバーを追加してください"
          className="mt-4"
        />
      ) : (
        <TableWrap className="mt-4">
          <Table>
            <THead>
              <Tr>
                <Th>氏名</Th>
                <Th>ロール</Th>
                <Th>所属店舗</Th>
                <Th>状態</Th>
                <Th>PIN</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => {
                const storeNames = r.membership_stores.map((ms) => ms.stores?.name).filter((n): n is string => !!n);
                const isSelf = r.profile_id === ctx.userId;
                const displayName = r.profiles?.display_name ?? '—';
                return (
                  <Tr key={r.id}>
                    <Td>
                      <p className="font-medium text-navy">{displayName}</p>
                      {r.profiles?.display_name_kana && (
                        <p className="text-xs text-gray-500">{r.profiles.display_name_kana}</p>
                      )}
                    </Td>
                    <Td>{ROLE_LABELS[r.role]}</Td>
                    <Td>
                      {HQ_ROLES.includes(r.role) ? (
                        <span className="text-gray-500">全店舗</span>
                      ) : storeNames.length > 0 ? (
                        storeNames.join('、')
                      ) : (
                        <span className="text-gray-400">未設定</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </Td>
                    <Td>
                      {r.profiles?.pin_code ? <Badge tone="success">設定済</Badge> : <Badge tone="gray">未設定</Badge>}
                    </Td>
                    <Td className="text-right">
                      <StaffRowMenu
                        row={{
                          membershipId: r.id,
                          profileId: r.profile_id,
                          displayName,
                          role: r.role,
                          status: r.status,
                          storeIds: r.membership_stores.map((ms) => ms.store_id),
                        }}
                        stores={ctx.stores}
                        isSelf={isSelf}
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
