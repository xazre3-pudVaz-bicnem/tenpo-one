import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { TAX_TREATMENT_LABELS, type TaxTreatment } from '@/lib/accounting';
import { JOURNAL_STATUS_LABELS, SOURCE_TYPE_LABELS, type JournalStatus, type SourceType } from '@/components/accounting/labels';

const HEADERS = ['仕訳番号', '日付', '摘要', '店舗', '状態', '区分', '勘定科目コード', '勘定科目名', '借方', '貸方', '税区分', 'メモ'];

/** 仕訳帳CSV出力（期間指定・明細レベル） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const status = searchParams.get('status');
  const sourceType = searchParams.get('source_type');
  const sourceId = searchParams.get('source_id');
  const storeId = searchParams.get('store');

  let query = supabase
    .from('journal_entries')
    .select('id, entry_no, entry_date, description, status, source_type, stores(name)')
    .eq('organization_id', ctx.organizationId);
  if (from) query = query.gte('entry_date', from);
  if (to) query = query.lte('entry_date', to);
  if (status) query = query.eq('status', status);
  if (sourceType) query = query.eq('source_type', sourceType);
  if (sourceId) query = query.eq('source_id', sourceId);
  if (storeId) query = query.eq('store_id', storeId);
  const { data: entries } = await query.order('entry_date', { ascending: false }).order('entry_no', { ascending: false }).limit(5000);
  const list = entries ?? [];

  if (list.length === 0) {
    return csvResponse(`journal_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(HEADERS, []));
  }

  const entryIds = list.map((e) => e.id as string);
  const { data: linesRaw } = await supabase
    .from('journal_entry_lines')
    .select('entry_id, account_id, side, amount, tax_treatment, memo')
    .in('entry_id', entryIds)
    .order('line_no');

  interface LineRow {
    entry_id: string;
    account_id: string;
    side: 'debit' | 'credit';
    amount: number;
    tax_treatment: TaxTreatment;
    memo: string | null;
  }
  const linesData = (linesRaw ?? []) as unknown as LineRow[];

  const accountIds = [...new Set(linesData.map((l) => l.account_id))];
  let accountMap = new Map<string, { code: string; name: string }>();
  if (accountIds.length > 0) {
    const { data: accountsData } = await supabase.from('accounts').select('id, code, name').in('id', accountIds);
    accountMap = new Map((accountsData ?? []).map((a) => [a.id as string, { code: a.code as string, name: a.name as string }]));
  }

  const linesByEntry = new Map<string, LineRow[]>();
  for (const l of linesData) {
    const arr = linesByEntry.get(l.entry_id) ?? [];
    arr.push(l);
    linesByEntry.set(l.entry_id, arr);
  }

  const rows: (string | number)[][] = [];
  for (const e of list) {
    const storeName = (e.stores as unknown as { name: string } | null)?.name ?? '全社';
    const statusLabel = JOURNAL_STATUS_LABELS[e.status as JournalStatus] ?? e.status;
    const sourceLabel = SOURCE_TYPE_LABELS[e.source_type as SourceType] ?? e.source_type;
    const lines = linesByEntry.get(e.id as string) ?? [];
    for (const l of lines) {
      const account = accountMap.get(l.account_id);
      rows.push([
        e.entry_no as number,
        e.entry_date as string,
        e.description as string,
        storeName,
        statusLabel,
        sourceLabel,
        account?.code ?? '',
        account?.name ?? '',
        l.side === 'debit' ? l.amount : '',
        l.side === 'credit' ? l.amount : '',
        TAX_TREATMENT_LABELS[l.tax_treatment] ?? l.tax_treatment,
        l.memo ?? '',
      ]);
    }
  }

  const csv = toCsv(HEADERS, rows);
  return csvResponse(`journal_${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
