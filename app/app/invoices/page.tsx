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
import { yen, todayJst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { InvoiceForm } from '@/components/invoices/invoice-form';
import { InvoiceTable, type InvoiceRow } from '@/components/invoices/invoice-table';
import { UploadZone } from '@/components/invoices/upload-zone';
import { InboxList, type InboxDoc } from '@/components/invoices/inbox-list';
import { DocumentList, type DocumentRow } from '@/components/invoices/document-list';
import {
  DOC_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_OPTIONS,
  TRIAGE_DOC_TYPE_OPTIONS,
  UNPAID_INVOICE_STATUSES,
  type DocType,
  type InvoiceStatus,
} from '@/components/invoices/labels';

export const metadata: Metadata = { title: '請求書・書類' };

type Tab = 'invoices' | 'inbox' | 'documents';

const TABS: { key: Tab; label: string }[] = [
  { key: 'invoices', label: '請求書' },
  { key: 'inbox', label: '保存ボックス' },
  { key: 'documents', label: '書類' },
];

function ymRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const endDate = new Date(y, m, 1);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`;
  return { start, end };
}

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
  const today = todayJst();

  const { data: vendorsData } = await supabase
    .from('vendors')
    .select('id, name')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('name');
  const vendors = vendorsData ?? [];

  const { data: accountsData } = await supabase
    .from('expense_accounts')
    .select('id, name')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order');
  const accounts = accountsData ?? [];

  let invoiceRows: InvoiceRow[] = [];
  let inboxDocs: InboxDoc[] = [];
  let documentRows: DocumentRow[] = [];
  let unpaidTotal = 0;
  let scheduledThisMonthTotal = 0;
  let overdueCount = 0;
  let overdueTotal = 0;

  if (tab === 'invoices') {
    let q = supabase
      .from('invoices')
      .select('id, status, vendor_name, due_date, amount, store_id, stores(name), expense_accounts(name)')
      .eq('organization_id', ctx.organizationId);
    if (ctx.currentStore) q = q.eq('store_id', ctx.currentStore.id);
    if (sp.status) q = q.eq('status', sp.status);
    if (sp.vendor) q = q.eq('vendor_id', sp.vendor);
    if (sp.expense) q = q.eq('expense_account_id', sp.expense);
    if (sp.ym) {
      const { start, end } = ymRange(sp.ym);
      q = q.gte('issue_date', start).lt('issue_date', end);
    }
    if (sp.overdue === '1') {
      q = q.lt('due_date', today).in('status', UNPAID_INVOICE_STATUSES);
    }
    const { data } = await q.order('due_date', { ascending: true, nullsFirst: false }).limit(300);
    invoiceRows = (data ?? []).map((r) => ({
      id: r.id as string,
      status: r.status as InvoiceStatus,
      vendorName: r.vendor_name as string,
      dueDate: r.due_date as string | null,
      amount: r.amount as number,
      storeName: (r.stores as unknown as { name: string } | null)?.name ?? null,
      expenseAccountName: (r.expense_accounts as unknown as { name: string } | null)?.name ?? null,
    }));

    // サマリー用集計（絞込条件に影響されない全体像）
    let summaryQ = supabase
      .from('invoices')
      .select('status, due_date, amount')
      .eq('organization_id', ctx.organizationId);
    if (ctx.currentStore) summaryQ = summaryQ.eq('store_id', ctx.currentStore.id);
    const { data: summaryData } = await summaryQ.limit(2000);
    const monthStart = `${today.slice(0, 7)}-01`;
    const nextMonthDate = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1);
    const monthEnd = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;
    for (const r of summaryData ?? []) {
      const status = r.status as InvoiceStatus;
      const dueDate = r.due_date as string | null;
      const amount = r.amount as number;
      if (UNPAID_INVOICE_STATUSES.includes(status)) {
        unpaidTotal += amount;
        if (dueDate && dueDate < today) {
          overdueCount += 1;
          overdueTotal += amount;
        }
      }
      if (status === 'scheduled' && dueDate && dueDate >= monthStart && dueDate < monthEnd) {
        scheduledThisMonthTotal += amount;
      }
    }
  }

  if (tab === 'inbox') {
    const { data } = await supabase
      .from('documents')
      .select('id, file_name, mime_type, size_bytes, created_at')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'inbox')
      .order('created_at', { ascending: false })
      .limit(300);
    inboxDocs = (data ?? []).map((d) => ({
      id: d.id as string,
      fileName: d.file_name as string,
      mimeType: d.mime_type as string,
      sizeBytes: d.size_bytes as number,
      createdAt: d.created_at as string,
    }));
  }

  if (tab === 'documents') {
    let q = supabase
      .from('documents')
      .select('id, doc_type, file_name, doc_date, amount, store_id, vendors(name), stores(name)')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'filed');
    const storeFilter = sp.store ?? ctx.currentStore?.id ?? '';
    if (storeFilter) q = q.eq('store_id', storeFilter);
    if (sp.docType) q = q.eq('doc_type', sp.docType);
    if (sp.ym) q = q.eq('year_month', sp.ym);
    const { data } = await q.order('doc_date', { ascending: false, nullsFirst: false }).limit(300);
    documentRows = (data ?? []).map((d) => ({
      id: d.id as string,
      docType: d.doc_type as DocType,
      fileName: d.file_name as string,
      docDate: d.doc_date as string | null,
      amount: d.amount as number | null,
      vendorName: (d.vendors as unknown as { name: string } | null)?.name ?? null,
      storeName: (d.stores as unknown as { name: string } | null)?.name ?? null,
    }));
  }

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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
