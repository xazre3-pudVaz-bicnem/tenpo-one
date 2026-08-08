import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { aggregateTrialBalance, type AccountInfo, type PostedLine } from '@/lib/accounting';
import { ACCOUNT_CATEGORY_LABELS } from '@/components/accounting/labels';

const HEADERS = ['コード', '科目名', 'カテゴリ', '借方計', '貸方計', '残高'];

/** 試算表CSV出力（期間指定・店舗絞込） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const storeId = searchParams.get('store');

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

  let lineQuery = supabase
    .from('journal_entry_lines')
    .select('account_id, side, amount, journal_entries!inner(entry_date, status, store_id)')
    .eq('organization_id', ctx.organizationId)
    .eq('journal_entries.status', 'posted');
  if (from) lineQuery = lineQuery.gte('journal_entries.entry_date', from);
  if (to) lineQuery = lineQuery.lte('journal_entries.entry_date', to);
  if (storeId) lineQuery = lineQuery.eq('journal_entries.store_id', storeId);
  const { data: linesRaw } = await lineQuery.limit(20000);

  const postedLines: PostedLine[] = (linesRaw ?? []).map((l) => ({
    accountId: l.account_id as string,
    side: l.side as 'debit' | 'credit',
    amount: l.amount as number,
  }));

  const tb = aggregateTrialBalance(postedLines, accountInfos);
  const rows = tb.map((r) => [r.account.code, r.account.name, ACCOUNT_CATEGORY_LABELS[r.account.category], r.debitTotal, r.creditTotal, r.balance]);

  const csv = toCsv(HEADERS, rows);
  return csvResponse(`trial_balance_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
