import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/components/invoices/labels';

/** 請求書CSV出力（期間・状態指定） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  let query = supabase
    .from('invoices')
    .select(
      'status, vendor_name, invoice_no, issue_date, due_date, amount, tax_amount, payment_method, paid_at, stores(name), expense_accounts(name)'
    )
    .eq('organization_id', ctx.organizationId);
  if (ctx.currentStore) query = query.eq('store_id', ctx.currentStore.id);
  if (status) query = query.eq('status', status);
  if (from) query = query.gte('issue_date', from);
  if (to) query = query.lte('issue_date', to);

  const { data } = await query.order('issue_date', { ascending: true });

  const rows = (data ?? []).map((r) => [
    INVOICE_STATUS_LABELS[r.status as keyof typeof INVOICE_STATUS_LABELS] ?? r.status,
    r.vendor_name,
    r.invoice_no,
    r.issue_date,
    r.due_date,
    r.amount,
    r.tax_amount,
    r.payment_method ? PAYMENT_METHOD_LABELS[r.payment_method as keyof typeof PAYMENT_METHOD_LABELS] : '',
    r.paid_at,
    (r.stores as unknown as { name: string } | null)?.name ?? '全店舗',
    (r.expense_accounts as unknown as { name: string } | null)?.name ?? '',
  ]);

  const csv = toCsv(
    ['状態', '取引先', '請求書番号', '発行日', '支払期限', '金額', '税額', '支払方法', '支払日', '店舗', '費目'],
    rows
  );
  return csvResponse(`invoices_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
