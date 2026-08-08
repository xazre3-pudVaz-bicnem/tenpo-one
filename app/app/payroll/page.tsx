import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yen, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { PayrollDisclaimer } from '@/components/payroll/disclaimer';
import { PayrollRuleDialog, type PayrollRuleRow } from '@/components/payroll/rule-dialog';
import { CommissionRuleDialog, type CommissionRuleRow } from '@/components/payroll/commission-dialog';
import { RunDialog } from '@/components/payroll/run-dialog';

export const metadata: Metadata = { title: '給与・歩合' };

const RUN_STATUS_LABEL: Record<string, string> = { draft: '下書き', confirmed: '確定済み', approved: '承認済み' };
const RUN_STATUS_TONE: Record<string, 'gray' | 'warning' | 'success'> = {
  draft: 'gray',
  confirmed: 'warning',
  approved: 'success',
};
const RUN_TYPE_LABEL: Record<string, string> = { salary: '給与', bonus: '賞与' };
const RUN_TYPE_TONE: Record<string, 'primary' | 'navy'> = { salary: 'primary', bonus: 'navy' };

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFeature('payroll');
  const canManage = can(ctx.role, 'payroll.manage');
  const supabase = await createClient();

  if (!canManage) {
    return <MyPayslipsTab ctx={ctx} />;
  }

  const tab = sp.tab === 'runs' ? 'runs' : 'rules';

  const { data: memberRows } = await supabase
    .from('memberships')
    .select('profile_id, profiles(id, display_name)')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active');
  const staffOptions = (memberRows ?? [])
    .map((m) => {
      const p = m.profiles as unknown as { id: string; display_name: string } | null;
      return p ? { id: p.id, name: p.display_name } : null;
    })
    .filter((s): s is { id: string; name: string } => !!s)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const nameByProfile = new Map(staffOptions.map((s) => [s.id, s.name]));
  const storeOptions = ctx.stores.map((s) => ({ id: s.id, name: s.name }));
  const storeNameById = new Map(storeOptions.map((s) => [s.id, s.name]));

  return (
    <div>
      <PageHeader
        title="給与・歩合"
        description="給与ルール・歩合ルールの設定と、期間ごとの給与計算"
        actions={
          <>
            <Link href="/app/payroll/nencho" className="text-sm font-medium text-primary hover:underline">
              年末調整はこちら
            </Link>
            {tab === 'runs' && <RunDialog storeOptions={storeOptions} staffOptions={staffOptions} />}
          </>
        }
      />
      <PayrollDisclaimer className="mb-5" />

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {[
          { key: 'rules', label: '給与ルール' },
          { key: 'runs', label: '給与計算' },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/app/payroll?tab=${t.key}`}
            className={cn(
              'border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary text-primary-deep' : 'border-transparent text-gray-500 hover:text-navy'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'rules' && (
        <RulesTab
          organizationId={ctx.organizationId}
          staffOptions={staffOptions}
          storeOptions={storeOptions}
          nameByProfile={nameByProfile}
          storeNameById={storeNameById}
        />
      )}
      {tab === 'runs' && <RunsTab organizationId={ctx.organizationId} storeNameById={storeNameById} />}
    </div>
  );
}

async function RulesTab({
  organizationId,
  staffOptions,
  storeOptions,
  nameByProfile,
  storeNameById,
}: {
  organizationId: string;
  staffOptions: { id: string; name: string }[];
  storeOptions: { id: string; name: string }[];
  nameByProfile: Map<string, string>;
  storeNameById: Map<string, string>;
}) {
  const supabase = await createClient();
  const { data: rules } = await supabase
    .from('payroll_rules')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  const { data: commissionRules } = await supabase
    .from('commission_rules')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  const PAY_TYPE_LABEL: Record<string, string> = { monthly: '月給', hourly: '時給', daily: '日給' };
  const METHOD_LABEL: Record<string, string> = { fixed: '固定額', rate: '料率', tiered: '段階料率' };

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy">給与ルール</h2>
          <PayrollRuleDialog
            trigger={<Button size="sm">追加</Button>}
            staffOptions={staffOptions}
            storeOptions={storeOptions}
          />
        </div>
        {(rules ?? []).length === 0 ? (
          <EmptyState title="給与ルールが登録されていません" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <Tr>
                  <Th>スタッフ</Th>
                  <Th>適用店舗</Th>
                  <Th>給与形態</Th>
                  <Th className="text-right">基本額</Th>
                  <Th>適用開始日</Th>
                  <Th className="text-right">操作</Th>
                </Tr>
              </THead>
              <TBody>
                {(rules ?? []).map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium text-navy">{nameByProfile.get(r.profile_id) ?? '—'}</Td>
                    <Td>{r.store_id ? storeNameById.get(r.store_id) ?? '—' : '全店舗共通'}</Td>
                    <Td>{PAY_TYPE_LABEL[r.pay_type]}</Td>
                    <Td className="text-right tabular-nums">{yen(r.base_amount)}</Td>
                    <Td>{formatDate(r.effective_from)}</Td>
                    <Td className="text-right">
                      <PayrollRuleDialog
                        trigger={
                          <Button variant="secondary" size="sm">
                            編集
                          </Button>
                        }
                        staffOptions={staffOptions}
                        storeOptions={storeOptions}
                        existing={r as PayrollRuleRow}
                      />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy">歩合ルール</h2>
          <CommissionRuleDialog
            trigger={<Button size="sm">追加</Button>}
            staffOptions={staffOptions}
            storeOptions={storeOptions}
          />
        </div>
        {(commissionRules ?? []).length === 0 ? (
          <EmptyState title="歩合ルールが登録されていません" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <Tr>
                  <Th>ルール名</Th>
                  <Th>対象スタッフ</Th>
                  <Th>対象店舗</Th>
                  <Th>計算方法</Th>
                  <Th>売上基準</Th>
                  <Th>適用開始日</Th>
                  <Th className="text-right">操作</Th>
                </Tr>
              </THead>
              <TBody>
                {(commissionRules ?? []).map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium text-navy">{r.name}</Td>
                    <Td>{r.profile_id ? nameByProfile.get(r.profile_id) ?? '—' : '全スタッフ'}</Td>
                    <Td>{r.store_id ? storeNameById.get(r.store_id) ?? '—' : '全店舗'}</Td>
                    <Td>{METHOD_LABEL[r.method]}</Td>
                    <Td>{r.basis === 'tax_excluded' ? '税抜' : '税込'}</Td>
                    <Td>{formatDate(r.effective_from)}</Td>
                    <Td className="text-right">
                      <CommissionRuleDialog
                        trigger={
                          <Button variant="secondary" size="sm">
                            編集
                          </Button>
                        }
                        staffOptions={staffOptions}
                        storeOptions={storeOptions}
                        existing={r as CommissionRuleRow}
                      />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </div>
    </div>
  );
}

async function RunsTab({
  organizationId,
  storeNameById,
}: {
  organizationId: string;
  storeNameById: Map<string, string>;
}) {
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('period_start', { ascending: false });

  if ((runs ?? []).length === 0) {
    return <EmptyState title="給与計算はまだ作成されていません" description="「新規作成」から期間を指定して作成してください" />;
  }

  return (
    <TableWrap>
      <Table>
        <THead>
          <Tr>
            <Th>種別</Th>
            <Th>タイトル</Th>
            <Th>期間 / 支給日</Th>
            <Th>対象</Th>
            <Th>状態</Th>
            <Th>作成日</Th>
            <Th className="text-right">操作</Th>
          </Tr>
        </THead>
        <TBody>
          {(runs ?? []).map((r) => {
            const runType = (r.run_type ?? 'salary') as string;
            return (
              <Tr key={r.id}>
                <Td>
                  <Badge tone={RUN_TYPE_TONE[runType] ?? 'primary'}>{RUN_TYPE_LABEL[runType] ?? runType}</Badge>
                </Td>
                <Td className="font-medium text-navy">{r.title}</Td>
                <Td>
                  {runType === 'bonus'
                    ? `支給日: ${formatDate(r.payment_date)}`
                    : `${formatDate(r.period_start)} 〜 ${formatDate(r.period_end)}`}
                </Td>
                <Td>{r.store_id ? storeNameById.get(r.store_id) ?? '—' : '全社'}</Td>
                <Td>
                  <Badge tone={RUN_STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
                </Td>
                <Td>{formatDate(r.created_at)}</Td>
                <Td className="text-right">
                  <Link href={`/app/payroll/${r.id}`} className="text-sm font-medium text-primary hover:underline">
                    詳細を見る
                  </Link>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </TableWrap>
  );
}

/**
 * 本人ビュー: 給与明細一覧（サマリーカード）。
 * payroll_runs は payroll.view_all ロールのみ閲覧可能な RLS のため、本人が payroll_items を
 * 保有していること（RLS: profile_id = auth.uid()）を先に確認したうえで、
 * admin client により表示用の非機密フィールドのみを取得する（実データの露出は自分の分のみ）。
 */
async function MyPayslipsTab({ ctx }: { ctx: { userId: string; organizationId: string } }) {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from('payroll_items')
    .select('id, payroll_run_id, gross_total, breakdown')
    .eq('organization_id', ctx.organizationId)
    .eq('profile_id', ctx.userId)
    .order('created_at', { ascending: false });

  const myItems = items ?? [];
  const runIds = [...new Set(myItems.map((i) => i.payroll_run_id as string))];

  let runs: { id: string; title: string; run_type: string; period_start: string; period_end: string; payment_date: string | null; status: string }[] = [];
  if (runIds.length > 0) {
    const admin = createAdminClient();
    const { data } = await admin
      .from('payroll_runs')
      .select('id, title, run_type, period_start, period_end, payment_date, status')
      .eq('organization_id', ctx.organizationId)
      .in('id', runIds)
      .in('status', ['confirmed', 'approved'])
      .order('period_start', { ascending: false });
    runs = data ?? [];
  }

  const itemByRunId = new Map(myItems.map((i) => [i.payroll_run_id as string, i]));

  return (
    <div>
      <PageHeader
        title="給与明細"
        description="ご自身の給与・賞与の明細です"
        actions={
          <Link href="/app/payroll/nencho" className="text-sm font-medium text-primary hover:underline">
            年末調整はこちら
          </Link>
        }
      />
      <PayrollDisclaimer className="mb-5" />
      {runs.length === 0 ? (
        <EmptyState title="表示できる給与明細はまだありません" description="給与計算が確定すると表示されます" />
      ) : (
        <div className="space-y-3">
          {runs.map((run) => {
            const item = itemByRunId.get(run.id);
            const runType = run.run_type ?? 'salary';
            return (
              <Card key={run.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={RUN_TYPE_TONE[runType] ?? 'primary'}>{RUN_TYPE_LABEL[runType] ?? runType}</Badge>
                      <p className="font-medium text-navy">{run.title}</p>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {runType === 'bonus'
                        ? `支給日: ${formatDate(run.payment_date)}`
                        : `${formatDate(run.period_start)} 〜 ${formatDate(run.period_end)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-lg font-bold tabular-nums text-navy">{yen(item?.gross_total)}</p>
                    <Link href={`/app/payroll/${run.id}`} className="text-sm font-medium text-primary hover:underline">
                      明細を見る
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
