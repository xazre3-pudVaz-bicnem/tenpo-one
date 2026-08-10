import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can, ROLE_LABELS } from '@/lib/permissions';
import { resolveApprovalRule, type ApprovalRuleLike } from '@/lib/approvals';
import { yen, formatDate, todayJst, daysAgoJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { PeriodFilter } from '@/components/cash/period-filter';
import { ExpenseFormDialog } from '@/components/cash/expense-form-dialog';
import { ApprovalActions } from '@/components/cash/approval-actions';
import { JournalSourceLink } from '@/components/accounting/journal-source-link';
import { approveExpense, rejectExpense } from '@/app/app/expenses/actions';
import { APPROVAL_LABELS, APPROVAL_TONES, PAID_VIA_LABELS, type ApprovalStatus, type PaidVia } from '@/components/cash/labels';

export const metadata: Metadata = { title: '経費' };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; account?: string; status?: string }>;
}) {
  const ctx = await requireFeature('accounting');
  const supabase = await createClient();
  const sp = await searchParams;

  const store = ctx.currentStore ?? ctx.stores[0] ?? null;
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
  const from = sp.from ?? daysAgoJst(30);
  const to = sp.to ?? todayJst();
  const accountFilter = sp.account ?? '';
  const statusFilter = sp.status ?? '';

  const canApprove = can(ctx.role, 'cash.approve');
  const canWrite = can(ctx.role, 'cash.write');

  const monthStart = `${todayJst().slice(0, 7)}-01`;
  let query = supabase
    .from('expenses')
    .select(
      'id, business_date, amount, tax_amount, paid_via, vendor_name, memo, approval_status, expense_accounts(id, name), stores(name)'
    )
    .in('store_id', storeIds)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('business_date', { ascending: false });
  if (accountFilter) query = query.eq('expense_account_id', accountFilter);
  if (statusFilter) query = query.eq('approval_status', statusFilter);

  // 費目マスタ・承認ルール・経費一覧・当月合計は相互に独立のため並列取得する。
  const [{ data: accounts }, { data: approvalRulesData }, { data: rows }, { data: monthRows }] = await Promise.all([
    ctx.organizationId
      ? supabase
          .from('expense_accounts')
          .select('id, name')
          .eq('organization_id', ctx.organizationId)
          .eq('status', 'active')
          .order('sort_order')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase
      .from('approval_rules')
      .select('target, min_amount, max_amount, approver_role, allow_self_approve')
      .eq('organization_id', ctx.organizationId)
      .eq('target', 'expense'),
    query,
    supabase
      .from('expenses')
      .select('amount, expense_accounts(id, name)')
      .in('store_id', storeIds)
      .eq('status', 'active')
      .gte('business_date', monthStart)
      .lte('business_date', todayJst()),
  ]);

  const approvalRules: ApprovalRuleLike[] = (approvalRulesData ?? []).map((r) => ({
    target: r.target as ApprovalRuleLike['target'],
    minAmount: r.min_amount as number,
    maxAmount: r.max_amount as number | null,
    approverRole: r.approver_role as ApprovalRuleLike['approverRole'],
    allowSelfApprove: r.allow_self_approve as boolean,
  }));

  // 会計連動: 経費→仕訳（source_type='expense', source_id=expenses.id）の対応を一覧表示用にまとめて取得
  const expenseIds = (rows ?? []).map((r) => r.id);
  let journaledExpenseIds = new Set<string>();
  if (ctx.organizationId && expenseIds.length > 0) {
    const { data: journaled } = await supabase
      .from('journal_entries')
      .select('source_id')
      .eq('organization_id', ctx.organizationId)
      .eq('source_type', 'expense')
      .in('source_id', expenseIds);
    journaledExpenseIds = new Set((journaled ?? []).map((j) => j.source_id as string));
  }
  const monthTotals = new Map<string, number>();
  for (const r of monthRows ?? []) {
    const name = (r.expense_accounts as unknown as { id: string; name: string } | null)?.name ?? '未分類';
    monthTotals.set(name, (monthTotals.get(name) ?? 0) + r.amount);
  }

  return (
    <div>
      <PageHeader
        title="経費"
        description={store ? `${store.name}を中心に表示しています` : '所属店舗がありません'}
        actions={
          can(ctx.role, 'csv.export') ? (
            <Link
              href={`/app/expenses/export?from=${from}&to=${to}`}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-navy hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              経費CSV
            </Link>
          ) : undefined
        }
      />

      {!store ? (
        <EmptyState title="所属店舗がありません" description="経費登録には店舗への割当が必要です。管理者に確認してください。" />
      ) : (
        <div className="space-y-5">
          {monthTotals.size > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[...monthTotals.entries()].map(([name, total]) => (
                <StatCard key={name} label={`${name}（当月）`} value={yen(total)} />
              ))}
            </div>
          )}

          {canWrite && <ExpenseFormDialog storeId={store.id} accounts={accounts ?? []} canSeedAccounts={canApprove} />}

          <PeriodFilter action="/app/expenses" from={from} to={to}>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="account">
                勘定科目
              </label>
              <select
                id="account"
                name="account"
                defaultValue={accountFilter}
                className="h-10 w-44 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-primary focus:outline-2 focus:outline-primary/30"
              >
                <option value="">すべて</option>
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="status">
                承認状態
              </label>
              <select
                id="status"
                name="status"
                defaultValue={statusFilter}
                className="h-10 w-40 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-primary focus:outline-2 focus:outline-primary/30"
              >
                <option value="">すべて</option>
                <option value="pending">承認待ち</option>
                <option value="approved">承認済み</option>
                <option value="rejected">差戻し</option>
              </select>
            </div>
          </PeriodFilter>

          {(rows ?? []).length === 0 ? (
            <EmptyState title="経費の記録はありません" description="期間や絞込条件を変更するか、経費を登録してください。" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <Tr>
                    <Th>営業日</Th>
                    <Th>店舗</Th>
                    <Th>科目</Th>
                    <Th className="text-right">金額</Th>
                    <Th className="text-right">税額</Th>
                    <Th>支払元</Th>
                    <Th>支払先</Th>
                    <Th>承認状態</Th>
                    <Th>仕訳</Th>
                    <Th>操作</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(rows ?? []).map((r) => (
                    <Tr key={r.id}>
                      <Td>{formatDate(r.business_date)}</Td>
                      <Td>{(r.stores as unknown as { name: string } | null)?.name ?? '—'}</Td>
                      <Td>{(r.expense_accounts as unknown as { name: string } | null)?.name ?? '—'}</Td>
                      <Td className="text-right tabular-nums">{yen(r.amount)}</Td>
                      <Td className="text-right tabular-nums">{yen(r.tax_amount)}</Td>
                      <Td>{PAID_VIA_LABELS[r.paid_via as PaidVia]}</Td>
                      <Td>{r.vendor_name ?? '—'}</Td>
                      <Td>
                        <Badge tone={APPROVAL_TONES[r.approval_status as ApprovalStatus]}>
                          {APPROVAL_LABELS[r.approval_status as ApprovalStatus]}
                        </Badge>
                      </Td>
                      <Td>
                        {journaledExpenseIds.has(r.id) ? (
                          <JournalSourceLink sourceType="expense" sourceId={r.id} label="見る" />
                        ) : (
                          <span className="text-xs text-gray-300">未仕訳</span>
                        )}
                      </Td>
                      <Td>
                        {canApprove && r.approval_status === 'pending' && (
                          <div className="space-y-1">
                            <ApprovalActions
                              onApprove={approveExpense.bind(null, r.id)}
                              onReject={rejectExpense.bind(null, r.id)}
                              rejectTitle="経費の差戻し"
                            />
                            {(() => {
                              const rule = resolveApprovalRule(approvalRules, 'expense', r.amount);
                              return rule ? (
                                <p className="text-xs text-gray-500">要承認: {ROLE_LABELS[rule.approverRole]}</p>
                              ) : null;
                            })()}
                          </div>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </div>
      )}
    </div>
  );
}
