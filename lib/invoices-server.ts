import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import type { InvoiceRow } from '@/components/invoices/invoice-table';
import type { InboxDoc } from '@/components/invoices/inbox-list';
import type { DocumentRow } from '@/components/invoices/document-list';
import { UNPAID_INVOICE_STATUSES, type DocType, type InvoiceStatus } from '@/components/invoices/labels';
import { invoiceYmRange, type InvoicesSearch, type InvoicesTab } from '@/lib/native-invoices';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type { InvoicesSearch, InvoicesTab };

export interface InvoicesPageData {
  vendors: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  invoiceRows: InvoiceRow[];
  inboxDocs: InboxDoc[];
  documentRows: DocumentRow[];
  unpaidTotal: number;
  scheduledThisMonthTotal: number;
  overdueCount: number;
  overdueTotal: number;
}

/**
 * 請求書・書類（/app/invoices）の中身。Web のページと iPad ネイティブ（lib/native-modules/invoices.ts）で同じ読み込み
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）
 */
export async function loadInvoicesPageData(
  supabase: Supabase,
  ctx: { organizationId: string; currentStore: { id: string } | null },
  tab: InvoicesTab,
  sp: InvoicesSearch
): Promise<InvoicesPageData> {
  const today = todayJst();

  // 取引先と費目マスタは独立のため並列取得する。
  const [{ data: vendorsData }, { data: accountsData }] = await Promise.all([
    supabase.from('vendors').select('id, name').eq('organization_id', ctx.organizationId).eq('status', 'active').order('name'),
    supabase
      .from('expense_accounts')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .order('sort_order'),
  ]);
  const vendors = vendorsData ?? [];
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
      const { start, end } = invoiceYmRange(sp.ym);
      q = q.gte('issue_date', start).lt('issue_date', end);
    }
    if (sp.overdue === '1') {
      q = q.lt('due_date', today).in('status', UNPAID_INVOICE_STATUSES);
    }
    const { data } = await q.order('due_date', { ascending: true, nullsFirst: false }).limit(300);

    // 会計連動: 請求書→仕入仕訳（source_type='purchase', source_id=invoices.id）の対応をまとめて取得
    const invoiceIds = (data ?? []).map((r) => r.id as string);
    let journaledInvoiceIds = new Set<string>();
    if (invoiceIds.length > 0) {
      const { data: journaled } = await supabase
        .from('journal_entries')
        .select('source_id')
        .eq('organization_id', ctx.organizationId)
        .eq('source_type', 'purchase')
        .in('source_id', invoiceIds);
      journaledInvoiceIds = new Set((journaled ?? []).map((j) => j.source_id as string));
    }

    invoiceRows = (data ?? []).map((r) => ({
      id: r.id as string,
      status: r.status as InvoiceStatus,
      vendorName: r.vendor_name as string,
      dueDate: r.due_date as string | null,
      amount: r.amount as number,
      storeName: (r.stores as unknown as { name: string } | null)?.name ?? null,
      expenseAccountName: (r.expense_accounts as unknown as { name: string } | null)?.name ?? null,
      journaled: journaledInvoiceIds.has(r.id as string),
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
      .select('id, doc_type, file_name, doc_date, amount, store_id, ocr_status, vendors(name), stores(name)')
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
      ocrStatus: d.ocr_status as DocumentRow['ocrStatus'],
    }));
  }

  return {
    vendors,
    accounts,
    invoiceRows,
    inboxDocs,
    documentRows,
    unpaidTotal,
    scheduledThisMonthTotal,
    overdueCount,
    overdueTotal,
  };
}
