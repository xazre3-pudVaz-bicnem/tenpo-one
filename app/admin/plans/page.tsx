import type { Metadata } from 'next';
import { requireCypressAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { yen } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { PlanDialog } from '@/components/admin/plan-dialog';

export const metadata: Metadata = { title: 'プラン' };

export default async function PlansPage() {
  await requireCypressAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from('plans')
    .select('id, code, name, monthly_price, description, sort_order, is_active, features')
    .order('sort_order');

  const plans = data ?? [];

  return (
    <div>
      <PageHeader
        title="プラン"
        description="契約企業に提示する料金プランのマスタです。/pricing の表示にも反映されます。"
        actions={<PlanDialog />}
      />

      {plans.length === 0 ? (
        <EmptyState title="プランが登録されていません" description="「プランを追加」から最初のプランを登録してください" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>コード</Th>
                <Th>プラン名</Th>
                <Th className="text-right">月額</Th>
                <Th>説明</Th>
                <Th>上限（店舗/ユーザー）</Th>
                <Th className="text-right">表示順</Th>
                <Th>状態</Th>
                <Th className="text-right">操作</Th>
              </Tr>
            </THead>
            <TBody>
              {plans.map((p) => {
                const features = (p.features ?? {}) as { store_limit?: number | null; user_limit?: number | null };
                return (
                  <Tr key={p.id}>
                    <Td className="font-mono text-xs">{p.code}</Td>
                    <Td className="font-medium text-navy">{p.name}</Td>
                    <Td className="text-right tabular-nums">{p.monthly_price > 0 ? yen(p.monthly_price) : '個別見積'}</Td>
                    <Td className="max-w-xs truncate text-xs text-gray-500">{p.description ?? '—'}</Td>
                    <Td className="text-xs text-gray-500">
                      {features.store_limit ?? '無制限'} / {features.user_limit ?? '無制限'}
                    </Td>
                    <Td className="text-right tabular-nums">{p.sort_order}</Td>
                    <Td>
                      <Badge tone={p.is_active ? 'success' : 'gray'}>{p.is_active ? '有効' : '無効'}</Badge>
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <PlanDialog plan={p} />
                      </div>
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
