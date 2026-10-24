import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { loadEmployeeList } from '@/lib/employees-server';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { CreateEmployeeDialog } from '@/components/employees/create-employee-dialog';
import { EmployeeFilters } from '@/components/employees/employee-filters';
import { EMPLOYMENT_TYPE_LABELS, EMPLOYEE_STATUS_LABEL, EMPLOYEE_STATUS_TONE } from './constants';

export const metadata: Metadata = { title: '従業員台帳' };

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const sp = await searchParams;
  // 一覧の閲覧は staff.manage（employees_select RLS: 給与閲覧ロール or 自店の店長系ロール）
  const ctx = await requirePermission('staff.manage');
  const supabase = await createClient();
  // 一覧・絞り込み・登録できるスタッフは lib/employees-server.ts（iPad のネイティブと同じ読み込み）
  const { rows, canWrite, staffOptions } = await loadEmployeeList(ctx, supabase, { q: sp.q, type: sp.type });

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
