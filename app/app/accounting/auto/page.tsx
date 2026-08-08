import type { Metadata } from 'next';
import { requireFeature, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { AutoSourceCard } from '@/components/accounting/auto-source-card';
import { AutoMappingSection, type AccountOption, type ExpenseAccountMappingRow } from '@/components/accounting/auto-mapping-section';
import { InstallAccountsBanner } from '@/components/accounting/auto-install-accounts';
import { yen } from '@/lib/format';
import {
  aggregateDailySales,
  fetchPendingExpenses,
  fetchPendingInvoices,
  fetchPendingPayrollRuns,
  fetchPendingPettyCash,
  loadAccounts,
  loadExistingSourceIds,
} from './engine';

export const metadata: Metadata = { title: '自動仕訳' };

/** 期間未指定時の既定値（先月）。'YYYY-MM-DD' */
function defaultPeriod(): { from: string; to: string } {
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y = jst.getFullYear();
  const m = jst.getMonth() + 1; // 1-12（今月）
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const from = `${py}-${String(pm).padStart(2, '0')}-01`;
  const lastDay = new Date(py, pm, 0).getDate();
  const to = `${py}-${String(pm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

export default async function AutoJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireFeature('accounting');
  const ctx = await requirePermission('csv.export');
  const sp = await searchParams;
  const def = defaultPeriod();
  const from = sp.from || def.from;
  const to = sp.to || def.to;

  const supabase = await createClient();
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const accountsInstalled = accounts.byCode.size > 0;

  // ---- サマリー集計（各カードの対象件数・合計額） ----
  const [salesBuckets, invoices, expenses, pettyCash, payrollRuns] = await Promise.all([
    aggregateDailySales(supabase, ctx.organizationId, storeIds, from, to),
    fetchPendingInvoices(supabase, ctx.organizationId),
    fetchPendingExpenses(supabase, ctx.organizationId),
    fetchPendingPettyCash(supabase, ctx.organizationId),
    fetchPendingPayrollRuns(supabase, ctx.organizationId),
  ]);

  const salesSourceIds = salesBuckets.map((b) => `${b.storeId}:${b.date}`);
  const [existingSales, existingPurchase, existingExpense, existingPetty, existingPayroll] = await Promise.all([
    loadExistingSourceIds(supabase, ctx.organizationId, 'pos_sales', salesSourceIds),
    loadExistingSourceIds(supabase, ctx.organizationId, 'purchase', invoices.map((r) => r.id)),
    loadExistingSourceIds(supabase, ctx.organizationId, 'expense', expenses.map((r) => r.id)),
    loadExistingSourceIds(supabase, ctx.organizationId, 'petty_cash', pettyCash.map((r) => r.id)),
    loadExistingSourceIds(supabase, ctx.organizationId, 'payroll', payrollRuns.map((r) => r.id)),
  ]);

  const pendingSalesBuckets = salesBuckets.filter((b) => !existingSales.has(`${b.storeId}:${b.date}`));
  const salesTotal = pendingSalesBuckets.reduce((a, b) => a + b.cashStandard + b.cashReduced + b.cashlessStandard + b.cashlessReduced, 0);

  const pendingInvoices = invoices.filter((r) => !existingPurchase.has(r.id));
  const purchaseTotal = pendingInvoices.reduce((a, r) => a + r.amount, 0);

  const pendingExpenses = expenses.filter((r) => !existingExpense.has(r.id));
  const expenseTotal = pendingExpenses.reduce((a, r) => a + r.amount, 0);

  const pendingPetty = pettyCash.filter((r) => !existingPetty.has(r.id));
  const pettyTotal = pendingPetty.reduce((a, r) => a + r.amount, 0);

  const pendingPayroll = payrollRuns.filter((r) => !existingPayroll.has(r.id) && r.grossTotal > 0);
  const payrollTotal = pendingPayroll.reduce((a, r) => a + r.grossTotal, 0);

  // ---- 費目マッピング用データ ----
  const { data: expenseAccountsData } = await supabase
    .from('expense_accounts')
    .select('id, name, account_id')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order');
  const mappingRows: ExpenseAccountMappingRow[] = (expenseAccountsData ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    accountId: r.account_id as string | null,
  }));
  const accountOptions: AccountOption[] = [...accounts.byCode.values()]
    .filter((a) => a.code.startsWith('5')) // 費用科目（500番台）
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="space-y-5">
      <PageHeader
        title="自動仕訳"
        description="売上・仕入・経費・小口現金・給与から仕訳候補を自動生成し、確認してから確定します。再入力ゼロが目標です。"
      />

      {!accountsInstalled && <InstallAccountsBanner />}

      <form method="GET" className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="from">
            開始日
          </label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={from}
            className="h-10 rounded-lg border border-gray-300 px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="to">
            終了日
          </label>
          <input id="to" type="date" name="to" defaultValue={to} className="h-10 rounded-lg border border-gray-300 px-3 text-sm" />
        </div>
        <button
          type="submit"
          className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-navy hover:bg-gray-50"
        >
          期間を変更（売上のみ対象）
        </button>
        <p className="ml-2 text-xs text-gray-500">仕入・経費・小口現金・給与は状態（承認済み・未仕訳）のみで対象を判定します</p>
      </form>

      <div className="space-y-4">
        <AutoSourceCard
          sourceType="pos_sales"
          title="売上（POS）"
          hint={`${from} 〜 ${to} の営業日ごとに、現金/キャッシュレス×標準/軽減税率で1日1仕訳を作成します`}
          pendingCount={pendingSalesBuckets.length}
          pendingTotal={salesTotal}
          range={{ from, to }}
        />
        <AutoSourceCard
          sourceType="purchase"
          title="仕入（請求書）"
          hint="承認済み・支払予定・支払済みで未仕訳の請求書から仕入高/買掛金の仕訳を作成します"
          pendingCount={pendingInvoices.length}
          pendingTotal={purchaseTotal}
          range={{ from, to }}
        />
        <AutoSourceCard
          sourceType="expense"
          title="経費"
          hint="承認済みで未仕訳の経費から、費目に対応する勘定科目の仕訳を作成します"
          pendingCount={pendingExpenses.length}
          pendingTotal={expenseTotal}
          range={{ from, to }}
        />
        <AutoSourceCard
          sourceType="petty_cash"
          title="小口現金"
          hint="承認済みで未仕訳の小口現金の入出金から仕訳を作成します"
          pendingCount={pendingPetty.length}
          pendingTotal={pettyTotal}
          range={{ from, to }}
        />
        <AutoSourceCard
          sourceType="payroll"
          title="給与"
          hint="確定（承認済み）で未仕訳の給与から、給与手当/未払費用の仕訳を作成します"
          pendingCount={pendingPayroll.length}
          pendingTotal={payrollTotal}
          range={{ from, to }}
        />
      </div>

      <AutoMappingSection rows={mappingRows} accountOptions={accountOptions} />

      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        合計参考: 売上 {yen(salesTotal)} ・ 仕入 {yen(purchaseTotal)} ・ 経費 {yen(expenseTotal)} ・ 小口現金 {yen(pettyTotal)} ・ 給与{' '}
        {yen(payrollTotal)}
      </div>
    </div>
  );
}
