import type { Metadata } from 'next';
import { requireFeature, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { AutoSourceCard } from '@/components/accounting/auto-source-card';
import { AutoMappingSection } from '@/components/accounting/auto-mapping-section';
import { InstallAccountsBanner } from '@/components/accounting/auto-install-accounts';
import { yen } from '@/lib/format';
import { autoSourceDefs } from '@/lib/accounting-pages';
import { loadAutoJournalPage } from '@/lib/accounting-pages-server';

export const metadata: Metadata = { title: '自動仕訳' };

export default async function AutoJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireFeature('accounting');
  const ctx = await requirePermission('csv.export');
  const sp = await searchParams;
  const supabase = await createClient();

  // 読み込み・集計は lib/accounting-pages-server.ts（iPad ネイティブの会計と同じ）
  const { from, to, accountsInstalled, pending, mappingRows, accountOptions } = await loadAutoJournalPage(supabase, ctx, sp);
  const salesTotal = pending.pos_sales.total;
  const refundTotal = pending.pos_refund.total;
  const purchaseTotal = pending.purchase.total;
  const expenseTotal = pending.expense.total;
  const pettyTotal = pending.petty_cash.total;
  const payrollTotal = pending.payroll.total;

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
          期間を変更（売上・返金のみ対象）
        </button>
        <p className="ml-2 text-xs text-gray-500">仕入・経費・小口現金・給与は状態（承認済み・未仕訳）のみで対象を判定します</p>
      </form>

      <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
        返金の仕訳は「返金が発生した営業日」で計上します（元の売上の日ではありません）。そのため、元売上の月が月次締め済みでも、返金日が未締めの当月であれば当月の仕訳として作成され、締め済み月の帳簿を書き換えることはありません。
      </div>

      <div className="space-y-4">
        {autoSourceDefs(from, to).map((d) => (
          <AutoSourceCard
            key={d.sourceType}
            sourceType={d.sourceType}
            title={d.title}
            hint={d.hint}
            pendingCount={pending[d.sourceType].count}
            pendingTotal={pending[d.sourceType].total}
            range={{ from, to }}
          />
        ))}
      </div>

      <AutoMappingSection rows={mappingRows} accountOptions={accountOptions} />

      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        合計参考: 売上 {yen(salesTotal)} ・ 返金 {yen(refundTotal)} ・ 仕入 {yen(purchaseTotal)} ・ 経費 {yen(expenseTotal)} ・ 小口現金{' '}
        {yen(pettyTotal)} ・ 給与 {yen(payrollTotal)}
      </div>
    </div>
  );
}
