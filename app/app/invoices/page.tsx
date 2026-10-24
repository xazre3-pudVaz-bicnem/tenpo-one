import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { yen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { InvoiceForm } from '@/components/invoices/invoice-form';
import { InvoiceTable } from '@/components/invoices/invoice-table';
import { UploadZone } from '@/components/invoices/upload-zone';
import { InboxList } from '@/components/invoices/inbox-list';
import { DocumentList } from '@/components/invoices/document-list';
import { DOC_TYPE_LABELS, INVOICE_STATUS_LABELS, INVOICE_STATUS_OPTIONS, TRIAGE_DOC_TYPE_OPTIONS } from '@/components/invoices/labels';
import { loadInvoicesPageData } from '@/lib/invoices-server';

export const metadata: Metadata = { title: '請求書・書類' };

type Tab = 'invoices' | 'inbox' | 'documents';

const TABS: { key: Tab; label: string }[] = [
  { key: 'invoices', label: '請求書' },
  { key: 'inbox', label: '保存ボックス' },
  { key: 'documents', label: '書類' },
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    status?: string;
    vendor?: string;
    ym?: string;
    docType?: string;
    store?: string;
    expense?: string;
    overdue?: string;
  }>;
}) {
  const ctx = await requireFeature('accounting');
  const supabase = await createClient();
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'inbox' || sp.tab === 'documents' ? sp.tab : 'invoices';
  const canWrite = can(ctx.role, 'documents.write');
  const canApprove = can(ctx.role, 'invoices.approve');
  // 中身の読み込みは lib/invoices-server.ts（iPad ネイティブと同じ。2026-10-24）
  const {
    vendors,
    accounts,
    invoiceRows,
    inboxDocs,
    documentRows,
    unpaidTotal,
    scheduledThisMonthTotal,
    overdueCount,
    overdueTotal,
  } = await loadInvoicesPageData(supabase, ctx, tab, sp);

  const storeOptions = ctx.isHq ? ctx.stores : [];

  return (
    <div>
      <PageHeader
        title="請求書・書類"
        description="請求書の承認・支払管理と、書類（領収書・納品書等）の保存を行います"
        actions={
          tab === 'invoices' ? (
            <>
              {can(ctx.role, 'csv.export') && (
                <Link
                  href={`/app/invoices/export${sp.status ? `?status=${encodeURIComponent(sp.status)}` : ''}`}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-navy hover:bg-gray-50"
                >
                  <Download className="h-4 w-4" />
                  請求書CSV
                </Link>
              )}
              {canWrite && (
                <InvoiceForm
                  organizationId={ctx.organizationId}
                  currentStoreId={ctx.currentStore?.id ?? null}
                  stores={storeOptions}
                  vendors={vendors}
                  accounts={accounts}
                />
              )}
            </>
          ) : undefined
        }
      />

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/app/invoices?tab=${t.key}`}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary text-primary-deep' : 'border-transparent text-gray-500 hover:text-navy'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'invoices' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="未払合計" value={yen(unpaidTotal)} tone="primary" />
            <StatCard label="今月支払予定合計" value={yen(scheduledThisMonthTotal)} />
            <StatCard
              label="期限超過合計"
              value={yen(overdueTotal)}
              sub={`${overdueCount}件`}
              tone={overdueCount > 0 ? 'danger' : 'default'}
            />
          </div>

          {overdueCount > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
              <p className="font-medium text-danger">
                支払期限を過ぎた請求書が {overdueCount}件・合計 {yen(overdueTotal)} あります。至急確認してください。
              </p>
              <Link href="/app/invoices?tab=invoices&overdue=1" className="whitespace-nowrap font-medium text-danger underline">
                期限超過のみ表示
              </Link>
            </div>
          )}

          <form method="GET" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="invoices" />
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">状態</label>
              <Select name="status" defaultValue={sp.status ?? ''} className="w-40">
                <option value="">すべて</option>
                {INVOICE_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {INVOICE_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">取引先</label>
              <Select name="vendor" defaultValue={sp.vendor ?? ''} className="w-48">
                <option value="">すべて</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">費目</label>
              <Select name="expense" defaultValue={sp.expense ?? ''} className="w-40">
                <option value="">すべて</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">年月（発行日）</label>
              <input
                type="month"
                name="ym"
                defaultValue={sp.ym ?? ''}
                className="h-10 rounded-lg border border-gray-300 px-3 text-sm"
              />
            </div>
            <label className="mb-0.5 flex h-10 items-center gap-1.5 text-sm text-gray-700">
              <input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === '1'} />
              期限超過のみ
            </label>
            <Button type="submit" variant="secondary" size="md">
              絞り込む
            </Button>
          </form>

          <InvoiceTable rows={invoiceRows} accounts={accounts} canWrite={canWrite} canApprove={canApprove} />
        </div>
      )}

      {tab === 'inbox' && (
        <div className="space-y-4">
          <UploadZone organizationId={ctx.organizationId} storeId={ctx.currentStore?.id ?? null} />
          <p className="text-xs text-gray-500">
            ScanSnap等で取り込んだ未仕分けの書類はこちらへアップロードしてください。各書類の「仕分け」から種別・取引先・金額等を入力すると書類一覧へ移動します。
          </p>
          <InboxList docs={inboxDocs} stores={ctx.stores} vendors={vendors} currentStoreId={ctx.currentStore?.id ?? null} />
        </div>
      )}

      {tab === 'documents' && (
        <div className="space-y-4">
          <form method="GET" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="documents" />
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">種別</label>
              <Select name="docType" defaultValue={sp.docType ?? ''} className="w-40">
                <option value="">すべて</option>
                {TRIAGE_DOC_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            {storeOptions.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">店舗</label>
                <Select name="store" defaultValue={sp.store ?? ctx.currentStore?.id ?? ''} className="w-40">
                  <option value="">すべて</option>
                  {storeOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">年月</label>
              <input
                type="month"
                name="ym"
                defaultValue={sp.ym ?? ''}
                className="h-10 rounded-lg border border-gray-300 px-3 text-sm"
              />
            </div>
            <Button type="submit" variant="secondary" size="md">
              絞り込む
            </Button>
          </form>

          <DocumentList rows={documentRows} />
        </div>
      )}
    </div>
  );
}
