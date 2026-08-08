import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { CreateEmployeeDialog } from '@/components/employees/create-employee-dialog';
import { EmployeeFilters } from '@/components/employees/employee-filters';
import { EMPLOYMENT_TYPE_LABELS, EMPLOYEE_STATUS_LABEL, EMPLOYEE_STATUS_TONE } from './constants';

export const metadata: Metadata = { title: '従業員台帳' };

interface EmployeeRow {
  id: string;
  employee_no: string | null;
  legal_name: string | null;
  employment_type: string;
  position: string | null;
  hired_on: string | null;
  status: string;
  primary_store_id: string | null;
  profile_id: string;
  profiles: { display_name: string } | null;
  stores: { name: string } | null;
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const sp = await searchParams;
  // 一覧の閲覧は staff.manage（employees_select RLS: 給与閲覧ロール or 自店の店長系ロール）
  const ctx = await requirePermission('staff.manage');
  // 登録・編集は employees_write RLS（org_owner/hq_admin/hq_accounting）と揃えるため payroll.manage で判定する
  const canWrite = can(ctx.role, 'payroll.manage');
  const supabase = await createClient();

  const { data } = await supabase
    .from('employees')
    .select(
      'id, employee_no, legal_name, employment_type, position, hired_on, status, primary_store_id, profile_id, profiles(display_name), stores(name)'
    )
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });

  let rows = ((data ?? []) as unknown as EmployeeRow[]) ?? [];

  const q = (sp.q ?? '').trim();
  if (q) {
    rows = rows.filter(
      (r) =>
        (r.legal_name ?? '').includes(q) ||
        (r.profiles?.display_name ?? '').includes(q) ||
        (r.employee_no ?? '').includes(q)
    );
  }
  if (sp.type) rows = rows.filter((r) => r.employment_type === sp.type);

  let staffOptions: { id: string; name: string }[] = [];
  if (canWrite) {
    const [{ data: memberRows }, { data: existing }] = await Promise.all([
      supabase
        .from('memberships')
        .select('profile_id, profiles(id, display_name)')
        .eq('organization_id', ctx.organizationId)
        .eq('status', 'active'),
      supabase.from('employees').select('profile_id').eq('organization_id', ctx.organizationId),
    ]);
    const usedIds = new Set((existing ?? []).map((e) => e.profile_id as string));
    staffOptions = (memberRows ?? [])
      .map((m) => {
        const p = m.profiles as unknown as { id: string; display_name: string } | null;
        return p ? { id: p.id, name: p.display_name } : null;
      })
      .filter((s): s is { id: string; name: string } => !!s && !usedIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  return (
    <div>
      <PageHeader
        title="従業員台帳"
        description="従業員の基本情報・雇用区分・所属店舗を管理します"
        actions={canWrite ? <CreateEmployeeDialog staffOptions={staffOptions} stores={ctx.stores} /> : undefined}
      />

      <EmployeeFilters current={{ q: sp.q ?? '', type: sp.type ?? '' }} />

      {rows.length === 0 ? (
        <EmptyState
          title="登録されている従業員がいません"
          description={canWrite ? '「従業員情報を登録」からスタッフを選択して登録してください' : undefined}
          className="mt-4"
        />
      ) : (
        <TableWrap className="mt-4">
          <Table>
            <THead>
              <Tr>
                <Th>社員番号</Th>
                <Th>氏名</Th>
                <Th>雇用区分</Th>
                <Th>所属店舗</Th>
                <Th>役職</Th>
                <Th>入社日</Th>
                <Th>状態</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.employee_no || '—'}</Td>
                  <Td className="font-medium text-navy">{r.legal_name || r.profiles?.display_name || '—'}</Td>
                  <Td>{EMPLOYMENT_TYPE_LABELS[r.employment_type] ?? r.employment_type}</Td>
                  <Td>{r.stores?.name ?? '—'}</Td>
                  <Td>{r.position || '—'}</Td>
                  <Td>{formatDate(r.hired_on)}</Td>
                  <Td>
                    <Badge tone={EMPLOYEE_STATUS_TONE[r.status] ?? 'gray'}>{EMPLOYEE_STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </Td>
                  <Td className="text-right">
                    <Link href={`/app/employees/${r.id}`} className="text-sm font-medium text-primary hover:underline">
                      詳細を見る
                    </Link>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
