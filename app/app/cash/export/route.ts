import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { todayJst, daysAgoJst } from '@/lib/format';
import { KIND_LABELS, APPROVAL_LABELS, type CashKind, type ApprovalStatus } from '@/components/cash/labels';

/** 現金台帳CSV（cash_transactions 全kind・期間指定） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || daysAgoJst(30);
  const to = searchParams.get('to') || todayJst();
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  const { data, error } = await supabase
    .from('cash_transactions')
    .select(
      'business_date, occurred_at, kind, amount, purpose, approval_status, status, expense_accounts(name), stores(name)'
    )
    .in('store_id', storeIds)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('business_date', { ascending: false })
    .order('occurred_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((r) => [
    r.business_date,
    (r.stores as unknown as { name: string } | null)?.name ?? '',
    KIND_LABELS[r.kind as CashKind],
    r.amount,
    r.purpose ?? '',
    (r.expense_accounts as unknown as { name: string } | null)?.name ?? '',
    APPROVAL_LABELS[r.approval_status as ApprovalStatus],
    r.status === 'voided' ? '取消' : '有効',
  ]);

  const csv = toCsv(['営業日', '店舗', '種別', '金額', '用途', '勘定科目', '承認状態', '状態'], rows);
  return csvResponse(`cash_transactions_${from}_${to}.csv`, csv);
}
