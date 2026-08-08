import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Landmark } from 'lucide-react';
import { requireFeature, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { BankAccountForm, type BankAccountOption } from '@/components/accounting/bank-account-form';
import { BankAccountDelete } from '@/components/accounting/bank-account-delete';
import { BankManualTxForm } from '@/components/accounting/bank-manual-tx-form';
import { BankCsvImport } from '@/components/accounting/bank-csv-import';
import { BankTxTable, type BankTxRow, type AccountOption } from '@/components/accounting/bank-tx-table';

export const metadata: Metadata = { title: '銀行口座 明細' };

const ACCOUNT_TYPE_LABELS: Record<string, string> = { ordinary: '普通', checking: '当座', savings: '貯蓄' };

export default async function BankAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireFeature('accounting');
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();

  const { data: bankAccount } = await supabase
    .from('bank_accounts')
    .select('id, bank_name, branch_name, account_type, account_last4, holder_name, store_id, account_id, stores(name), accounts(code, name)')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .maybeSingle();
  if (!bankAccount) notFound();

  const store = bankAccount.stores as unknown as { name: string } | null;
  const linkedAccount = bankAccount.accounts as unknown as { code: string; name: string } | null;

  const { data: txData } = await supabase
    .from('bank_transactions')
    .select('id, transacted_on, description, deposit, withdrawal, journal_entry_id')
    .eq('bank_account_id', id)
    .order('transacted_on', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(2000);

  const rows: BankTxRow[] = (txData ?? []).reduce<BankTxRow[]>((acc, t) => {
    const prevBalance = acc.length > 0 ? acc[acc.length - 1].runningBalance : 0;
    acc.push({
      id: t.id as string,
      date: t.transacted_on as string,
      description: t.description as string,
      deposit: t.deposit as number,
      withdrawal: t.withdrawal as number,
      runningBalance: prevBalance + (t.deposit as number) - (t.withdrawal as number),
      journalEntryId: t.journal_entry_id as string | null,
    });
    return acc;
  }, []);
  const balance = rows.length > 0 ? rows[rows.length - 1].runningBalance : 0;
  const displayRows = [...rows].reverse(); // 新しい取引が上に来るように表示（残高は登録順で計算済み）

  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('code');
  const accountOptions: AccountOption[] = (accountsData ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
  }));
  const bankAccountOptions: BankAccountOption[] = accountOptions.filter((a) => a.code === '110');

  const { data: subTypeBankAccounts } = await supabase
    .from('accounts')
    .select('id, code, name')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .eq('sub_type', 'bank')
    .order('code');
  const editAccountOptions: BankAccountOption[] =
    (subTypeBankAccounts ?? []).length > 0
      ? (subTypeBankAccounts ?? []).map((a) => ({ id: a.id as string, code: a.code as string, name: a.name as string }))
      : bankAccountOptions;

  return (
    <div className="space-y-5">
      <Link href="/app/accounting/banks" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> 銀行口座一覧へ戻る
      </Link>

      <PageHeader
        title={bankAccount.bank_name as string}
        description={`${bankAccount.branch_name ? bankAccount.branch_name + ' ・ ' : ''}${ACCOUNT_TYPE_LABELS[bankAccount.account_type as string] ?? bankAccount.account_type}${bankAccount.account_last4 ? ' ・ 下4桁 ' + bankAccount.account_last4 : ''}${bankAccount.holder_name ? ' ・ ' + bankAccount.holder_name : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <BankAccountForm
              mode="edit"
              bankAccountId={bankAccount.id as string}
              initial={{
                storeId: bankAccount.store_id as string | null,
                bankName: bankAccount.bank_name as string,
                branchName: bankAccount.branch_name as string | null,
                accountType: bankAccount.account_type as 'ordinary' | 'checking' | 'savings',
                accountLast4: bankAccount.account_last4 as string | null,
                holderName: bankAccount.holder_name as string | null,
                accountId: bankAccount.account_id as string | null,
              }}
              stores={ctx.isHq ? ctx.stores : []}
              accountOptions={editAccountOptions}
            />
            <BankAccountDelete bankAccountId={bankAccount.id as string} />
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

      <BankCsvImport bankAccountId={bankAccount.id as string} />

      <div className="flex justify-end">
        <BankManualTxForm bankAccountId={bankAccount.id as string} />
      </div>

      <BankTxTable bankAccountId={bankAccount.id as string} rows={displayRows} accountOptions={accountOptions} />
    </div>
  );
}
