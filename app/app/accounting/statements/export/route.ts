import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveExportStore } from '@/lib/export-scope';
import { toCsv, csvResponse } from '@/lib/csv';
import { aggregateTrialBalanceWithOpening, type AccountInfo, type PostedLine } from '@/lib/accounting';
import { ACCOUNT_CATEGORY_LABELS } from '@/components/accounting/labels';

const HEADERS = ['コード', '科目名', 'カテゴリ', '期首残高', '借方計', '貸方計', '期末残高'];

/** 'YYYY-MM-DD' の前日（UTCカレンダー演算・TZ非依存） */
function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 試算表CSV出力（期間指定・店舗絞込・期首残高対応） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') || '1900-01-01';
  const to = searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const storeScope = resolveExportStore(ctx, searchParams.get('store'));
  if (!storeScope.ok) return new Response('指定された店舗へのアクセス権限がありません', { status: 403 });
  const storeId = storeScope.storeId;

  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name, category')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order')
    .order('code');
  const accountInfos: AccountInfo[] = (accountsData ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    category: a.category as AccountInfo['category'],
  }));

  const fetchPostedLines = async (rangeFrom: string, rangeTo: string): Promise<PostedLine[]> => {
    let q = supabase
      .from('journal_entry_lines')
      .select('account_id, side, amount, journal_entries!inner(entry_date, status, store_id)')
      .eq('organization_id', ctx.organizationId)
      .eq('journal_entries.status', 'posted')
      .gte('journal_entries.entry_date', rangeFrom)
      .lte('journal_entries.entry_date', rangeTo);
    if (storeId) q = q.eq('journal_entries.store_id', storeId);
    const { data } = await q.limit(20000);
    return (data ?? []).map((l) => ({
      accountId: l.account_id as string,
      side: l.side as 'debit' | 'credit',
      amount: l.amount as number,
    }));
  };

  const [openingLines, periodLines] = await Promise.all([
    fetchPostedLines('1900-01-01', dayBefore(from)),
    fetchPostedLines(from, to),
  ]);

  const tb = aggregateTrialBalanceWithOpening(openingLines, periodLines, accountInfos);
  const rows = tb.map((r) => [
    r.account.code,
    r.account.name,
    ACCOUNT_CATEGORY_LABELS[r.account.category],
    r.openingBalance,
    r.debitTotal,
    r.creditTotal,
    r.closingBalance,
  ]);

  const csv = toCsv(HEADERS, rows);
  return csvResponse(`trial_balance_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
