import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { todayJst, daysAgoJst } from '@/lib/format';
import { APPROVAL_LABELS, PAID_VIA_LABELS, type ApprovalStatus, type PaidVia } from '@/components/cash/labels';

/** 経費CSV（期間指定） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || daysAgoJst(30);
  const to = searchParams.get('to') || todayJst();
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  const { data, error } = await supabase
    .from('expenses')
    .select(
      'business_date, amount, tax_amount, paid_via, vendor_name, memo, approval_status, status, expense_accounts(name), stores(name)'
    )
    .in('store_id', storeIds)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('business_date', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((r) => [
    r.business_date,
    (r.stores as unknown as { name: string } | null)?.name ?? '',
    (r.expense_accounts as unknown as { name: string } | null)?.name ?? '',
    r.amount,
    r.tax_amount,
    PAID_VIA_LABELS[r.paid_via as PaidVia],
    r.vendor_name ?? '',
    r.memo ?? '',
    APPROVAL_LABELS[r.approval_status as ApprovalStatus],
    r.status === 'voided' ? '取消' : '有効',
  ]);

  const csv = toCsv(
    ['営業日', '店舗', '科目', '金額', '税額', '支払元', '支払先', 'メモ', '承認状態', '状態'],
    rows
  );
  return csvResponse(`expenses_${from}_${to}.csv`, csv);
}
