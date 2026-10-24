import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Landmark } from 'lucide-react';
import { requireFeature, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { BankAccountForm } from '@/components/accounting/bank-account-form';
import { BankAccountDelete } from '@/components/accounting/bank-account-delete';
import { BankManualTxForm } from '@/components/accounting/bank-manual-tx-form';
import { BankCsvImport } from '@/components/accounting/bank-csv-import';
import { BankTxTable } from '@/components/accounting/bank-tx-table';
import { yen } from '@/lib/format';
import { BANK_ACCOUNT_TYPE_LABELS as ACCOUNT_TYPE_LABELS } from '@/lib/accounting-pages';
import { loadBankAccountDetail } from '@/lib/accounting-pages-server';

export const metadata: Metadata = { title: '銀行口座 明細' };

export default async function BankAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireFeature('accounting');
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();

  // 読み込みは lib/accounting-pages-server.ts（iPad ネイティブの会計と同じ）
  const detail = await loadBankAccountDetail(supabase, ctx, id);
  if (!detail) notFound();
  const { bankAccount, rows, displayRows, balance, accountOptions, editAccountOptions, receivableTotal, payableTotal } = detail;
  const store = bankAccount.storeName != null ? { name: bankAccount.storeName } : null;
  const linkedAccount = bankAccount.linkedAccount;

  return (
    <div className="space-y-5">
      <Link href="/app/accounting/banks" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> 銀行口座一覧へ戻る
      </Link>

      <PageHeader
        title={bankAccount.bankName}
        description={`${bankAccount.branchName ? bankAccount.branchName + ' ・ ' : ''}${ACCOUNT_TYPE_LABELS[bankAccount.accountType] ?? bankAccount.accountType}${bankAccount.accountLast4 ? ' ・ 下4桁 ' + bankAccount.accountLast4 : ''}${bankAccount.holderName ? ' ・ ' + bankAccount.holderName : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <BankAccountForm
              mode="edit"
              bankAccountId={bankAccount.id}
              initial={{
                storeId: bankAccount.storeId,
                bankName: bankAccount.bankName,
                branchName: bankAccount.branchName,
                accountType: bankAccount.accountType,
                accountLast4: bankAccount.accountLast4,
                holderName: bankAccount.holderName,
                accountId: bankAccount.accountId,
              }}
              stores={ctx.isHq ? ctx.stores : []}
              accountOptions={editAccountOptions}
            />
            <BankAccountDelete bankAccountId={bankAccount.id} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {store && <Badge tone="gray">{store.name}</Badge>}
        {linkedAccount ? (
          <Badge tone="primary">
            <Landmark className="mr-1 h-3 w-3" />
            {linkedAccount.code} {linkedAccount.name}
          </Badge>
        ) : (
          <Badge tone="warning">対応する勘定科目が未設定です（編集から設定してください）</Badge>
        )}
        <Badge tone="success">現在残高（記帳ベース） {rows.length > 0 ? `¥${balance.toLocaleString('ja-JP')}` : '¥0'}</Badge>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        銀行API連携は行いません（手入力・CSV取込で完結。将来のAPI接続はオプション）。
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">売掛金残高（参考・全社合計）</p>
          <p className="mt-1 text-lg font-semibold text-navy">{yen(receivableTotal)}</p>
          <p className="mt-1 text-[11px] text-gray-400">入金取引を「売掛金の回収」として消込むと減少します</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">買掛金残高（参考・全社合計）</p>
          <p className="mt-1 text-lg font-semibold text-navy">{yen(payableTotal)}</p>
          <p className="mt-1 text-[11px] text-gray-400">出金取引を「買掛金の支払」として消込むと減少します</p>
        </div>
      </div>

      <BankCsvImport bankAccountId={bankAccount.id} />

      <div className="flex justify-end">
        <BankManualTxForm bankAccountId={bankAccount.id} />
      </div>

      <BankTxTable bankAccountId={bankAccount.id} rows={displayRows} accountOptions={accountOptions} />
    </div>
  );
}
