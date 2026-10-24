import type { Metadata } from 'next';
import Link from 'next/link';
import { Landmark, ChevronRight } from 'lucide-react';
import { requireFeature, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { BankAccountForm } from '@/components/accounting/bank-account-form';
import { InstallAccountsBanner } from '@/components/accounting/auto-install-accounts';
import { BANK_ACCOUNT_TYPE_LABELS as ACCOUNT_TYPE_LABELS } from '@/lib/accounting-pages';
import { loadBankAccountsPage } from '@/lib/accounting-pages-server';

export const metadata: Metadata = { title: '銀行口座' };

export default async function BankAccountsPage() {
  await requireFeature('accounting');
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();

  // 読み込みは lib/accounting-pages-server.ts（iPad ネイティブの会計と同じ）
  const { accountsInstalled, accountOptions, bankAccounts } = await loadBankAccountsPage(supabase, ctx);

  return (
    <div className="space-y-5">
      <PageHeader
        title="銀行口座"
        description="銀行口座を登録し、CSV取込または手入力で取引を記帳します。銀行API連携は行いません（手入力・CSV取込で完結。将来のAPI接続はオプション）。"
        actions={<BankAccountForm mode="create" stores={ctx.isHq ? ctx.stores : []} accountOptions={accountOptions} />}
      />

      {!accountsInstalled && <InstallAccountsBanner />}

      {bankAccounts.length === 0 ? (
        <EmptyState
          title="銀行口座が登録されていません"
          description="「口座を追加」から銀行口座を登録すると、取引の記帳・仕訳作成ができるようになります。"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bankAccounts.map((b) => {
            const store = b.storeName != null ? { name: b.storeName } : null;
            const account = b.account;
            return (
              <Link key={b.id} href={`/app/accounting/banks/${b.id}`}>
                <Card className="flex h-full flex-col justify-between p-4 transition-shadow hover:shadow-md">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-primary-deep" />
                      <p className="font-semibold text-navy">{b.bankName}</p>
                    </div>
                    <p className="text-sm text-gray-600">
                      {b.branchName ? `${b.branchName} ・ ` : ''}
                      {ACCOUNT_TYPE_LABELS[b.accountType] ?? b.accountType}
                      {b.accountLast4 ? ` ・ 下4桁 ${b.accountLast4}` : ''}
                    </p>
                    {b.holderName && <p className="mt-0.5 text-xs text-gray-500">名義: {b.holderName}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {store && <Badge tone="gray">{store.name}</Badge>}
                      {account ? (
                        <Badge tone="primary">
                          {account.code} {account.name}
                        </Badge>
                      ) : (
                        <Badge tone="warning">対応科目未設定</Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-end text-xs text-primary-deep">
                    取引を見る <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
