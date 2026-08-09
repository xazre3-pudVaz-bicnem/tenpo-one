import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveExportStore } from '@/lib/export-scope';
import { toCsv, csvResponse } from '@/lib/csv';
import { TAX_TREATMENT_LABELS, type AccountCategory, type TaxTreatment } from '@/lib/accounting';
import { SOURCE_TYPE_LABELS, type SourceType } from '@/components/accounting/labels';
import { computeOpeningBalance, buildLedgerRows, resolveCounterLabel, type LedgerEntryLine } from '@/components/accounting/ledger';

const JOURNAL_HEADERS = ['仕訳番号', '日付', '摘要', '店舗', '勘定科目コード', '勘定科目名', '借方', '貸方', '税区分', 'メモ'];
const LEDGER_HEADERS = ['日付', '摘要', '相手科目', '借方', '貸方', '残高', '店舗', '区分'];

const LEDGER_TYPES = ['journal', 'general', 'cash', 'bank', 'receivable', 'payable'] as const;
type LedgerType = (typeof LEDGER_TYPES)[number];

/** 帳簿CSV出力。type=journal は仕訳帳（posted・明細展開）、それ以外は科目別の元帳・出納帳（繰越残高付き） */
export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get('type');
  const type: LedgerType = (LEDGER_TYPES as readonly string[]).includes(typeParam ?? '') ? (typeParam as LedgerType) : 'journal';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const storeScope = resolveExportStore(ctx, searchParams.get('store'));
  if (!storeScope.ok) return new Response('指定された店舗へのアクセス権限がありません', { status: 403 });
  const storeId = storeScope.storeId;
  const today = new Date().toISOString().slice(0, 10);

  if (type === 'journal') {
    let query = supabase
      .from('journal_entries')
      .select('id, entry_no, entry_date, description, stores(name)')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'posted');
    if (from) query = query.gte('entry_date', from);
    if (to) query = query.lte('entry_date', to);
    if (storeId) query = query.eq('store_id', storeId);
    const { data: entries } = await query.order('entry_date', { ascending: false }).order('entry_no', { ascending: false }).limit(5000);
    const list = entries ?? [];

    const rows: (string | number)[][] = [];
    if (list.length > 0) {
      const entryIds = list.map((e) => e.id as string);
      const { data: linesRaw } = await supabase
        .from('journal_entry_lines')
        .select('entry_id, account_id, side, amount, tax_treatment, memo')
        .in('entry_id', entryIds)
        .order('line_no');
      const accountIds = [...new Set((linesRaw ?? []).map((l) => l.account_id as string))];
      let accountMap = new Map<string, { code: string; name: string }>();
      if (accountIds.length > 0) {
        const { data: accountsData } = await supabase.from('accounts').select('id, code, name').in('id', accountIds);
        accountMap = new Map((accountsData ?? []).map((a) => [a.id as string, { code: a.code as string, name: a.name as string }]));
      }
      interface JournalLineRaw {
        entry_id: string;
        account_id: string;
        side: 'debit' | 'credit';
        amount: number;
        tax_treatment: TaxTreatment;
        memo: string | null;
      }
      const linesByEntry = new Map<string, JournalLineRaw[]>();
      for (const l of (linesRaw ?? []) as unknown as JournalLineRaw[]) {
        const arr = linesByEntry.get(l.entry_id) ?? [];
        arr.push(l);
        linesByEntry.set(l.entry_id, arr);
      }
      for (const e of list) {
        const storeName = (e.stores as unknown as { name: string } | null)?.name ?? '全社';
        for (const l of linesByEntry.get(e.id as string) ?? []) {
          const account = accountMap.get(l.account_id as string);
          rows.push([
            e.entry_no as number,
            e.entry_date as string,
            e.description as string,
            storeName,
            account?.code ?? '',
            account?.name ?? '',
            l.side === 'debit' ? (l.amount as number) : '',
            l.side === 'credit' ? (l.amount as number) : '',
            TAX_TREATMENT_LABELS[l.tax_treatment as TaxTreatment] ?? (l.tax_treatment as string),
            (l.memo as string | null) ?? '',
          ]);
        }
      }
    }
    return csvResponse(`ledger_journal_${today}.csv`, toCsv(JOURNAL_HEADERS, rows));
  }

  const accountId = searchParams.get('account');
  if (!accountId) return csvResponse(`ledger_${type}_${today}.csv`, toCsv(LEDGER_HEADERS, []));

  const { data: accountRow } = await supabase.from('accounts').select('id, category').eq('id', accountId).eq('organization_id', ctx.organizationId).single();
  if (!accountRow) return csvResponse(`ledger_${type}_${today}.csv`, toCsv(LEDGER_HEADERS, []));
  const category = accountRow.category as AccountCategory;

  const buildLineQuery = () => {
    let q = supabase
      .from('journal_entry_lines')
      .select(
        'id, entry_id, line_no, side, amount, memo, journal_entries!inner(entry_date, description, status, store_id, source_type, source_id, stores(name))'
      )
      .eq('account_id', accountId)
      .eq('organization_id', ctx.organizationId)
      .eq('journal_entries.status', 'posted');
    if (storeId) q = q.eq('journal_entries.store_id', storeId);
    return q;
  };

  const [{ data: beforeLines }, { data: periodLinesRaw }] = await Promise.all([
    buildLineQuery().lt('journal_entries.entry_date', from || '1900-01-01'),
    buildLineQuery()
      .gte('journal_entries.entry_date', from || '1900-01-01')
      .lte('journal_entries.entry_date', to || today)
      .order('entry_date', { foreignTable: 'journal_entries', ascending: true })
      .order('line_no', { ascending: true }),
  ]);

  const opening = computeOpeningBalance((beforeLines ?? []).map((l) => ({ side: l.side as 'debit' | 'credit', amount: l.amount as number })), category);

  const periodEntryIds = [...new Set((periodLinesRaw ?? []).map((l) => l.entry_id as string))];
  let counterNamesByEntry = new Map<string, string[]>();
  if (periodEntryIds.length > 0) {
    const { data: allLines } = await supabase.from('journal_entry_lines').select('entry_id, account_id').in('entry_id', periodEntryIds);
    const otherAccountIds = [...new Set((allLines ?? []).map((l) => l.account_id as string).filter((id) => id !== accountId))];
    let nameMap = new Map<string, string>();
    if (otherAccountIds.length > 0) {
      const { data: accountsData } = await supabase.from('accounts').select('id, name').in('id', otherAccountIds);
      nameMap = new Map((accountsData ?? []).map((a) => [a.id as string, a.name as string]));
    }
    const byEntry = new Map<string, string[]>();
    for (const l of allLines ?? []) {
      if ((l.account_id as string) === accountId) continue;
      const name = nameMap.get(l.account_id as string);
      const arr = byEntry.get(l.entry_id as string) ?? [];
      if (name) arr.push(name);
      byEntry.set(l.entry_id as string, arr);
    }
    counterNamesByEntry = byEntry;
  }

  const periodLines: LedgerEntryLine[] = (periodLinesRaw ?? []).map((l) => {
    const je = l.journal_entries as unknown as {
      entry_date: string;
      description: string;
      source_type: SourceType;
      source_id: string | null;
      stores: { name: string } | null;
    };
    return {
      entryId: l.entry_id as string,
      entryDate: je.entry_date,
      description: je.description,
      side: l.side as 'debit' | 'credit',
      amount: l.amount as number,
      memo: l.memo as string | null,
      storeName: je.stores?.name ?? null,
      sourceType: je.source_type,
      sourceId: je.source_id,
    };
  });
  const ledgerRows = buildLedgerRows(periodLines, category, opening, (entryId) =>
    resolveCounterLabel(counterNamesByEntry.get(entryId) ?? [])
  );

  const rows: (string | number)[][] = [['', '繰越残高', '', '', '', opening, '', '']];
  for (const r of ledgerRows) {
    rows.push([
      r.date,
      r.description,
      r.counter,
      r.debit || '',
      r.credit || '',
      r.balance,
      r.storeName ?? '全社',
      r.sourceType ? SOURCE_TYPE_LABELS[r.sourceType] : '',
    ]);
  }

  return csvResponse(`ledger_${type}_${today}.csv`, toCsv(LEDGER_HEADERS, rows));
}
