import type { Metadata } from 'next';
import { Download } from 'lucide-react';
import { requirePermission, requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { todayJst } from '@/lib/format';
import Link from 'next/link';
import {
  JOURNAL_STATUS_LABELS, JOURNAL_STATUS_OPTIONS, SOURCE_TYPE_LABELS, SOURCE_TYPE_OPTIONS,
  type JournalStatus, type SourceType,
} from '@/components/accounting/labels';
import { JournalPanel, type JournalEntryRow, type JournalLineRow } from '@/components/accounting/journal-panel';
import { PeriodClosePanel } from '@/components/accounting/period-close-panel';
import type { TaxTreatment } from '@/lib/accounting';

export const metadata: Metadata = { title: '仕訳 | 会計' };

const PAGE_SIZE = 50;

function firstDayOfMonth(dateJst: string): string {
  return `${dateJst.slice(0, 7)}-01`;
}

export default async function AccountingJournalPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    status?: string;
    source_type?: string;
    source_id?: string;
    store?: string;
    page?: string;
  }>;
}) {
  await requirePermission('csv.export');
  const ctx = await requireFeature('accounting');
  const sp = await searchParams;
  const supabase = await createClient();

  const today = todayJst();
  const from = sp.from || firstDayOfMonth(today);
  const to = sp.to || today;
  const status = JOURNAL_STATUS_OPTIONS.includes(sp.status as JournalStatus) ? (sp.status as JournalStatus) : '';
  const sourceType = SOURCE_TYPE_OPTIONS.includes(sp.source_type as SourceType) ? (sp.source_type as SourceType) : '';
  const sourceId = sp.source_id || '';
  const storeId = sp.store || (ctx.isHq ? '' : (ctx.currentStore?.id ?? ''));
  const page = Math.max(1, Number(sp.page) || 1);

  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name, default_tax_treatment')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order')
    .order('code');
  const accounts = (accountsData ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    defaultTaxTreatment: a.default_tax_treatment as TaxTreatment,
  }));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  let query = supabase
    .from('journal_entries')
    .select('id, entry_no, entry_date, description, status, source_type, source_id, void_reason, store_id, stores(name)', { count: 'exact' })
    .eq('organization_id', ctx.organizationId)
    .gte('entry_date', from)
    .lte('entry_date', to);
  if (status) query = query.eq('status', status);
  if (sourceType) query = query.eq('source_type', sourceType);
  if (sourceId) query = query.eq('source_id', sourceId);
  if (storeId) query = query.eq('store_id', storeId);
  query = query.order('entry_date', { ascending: false }).order('entry_no', { ascending: false });

  const rangeFrom = (page - 1) * PAGE_SIZE;
  const { data: entriesData, count } = await query.range(rangeFrom, rangeFrom + PAGE_SIZE - 1);
  const entries = entriesData ?? [];
  const entryIds = entries.map((e) => e.id as string);

  let linesByEntry: Record<string, JournalLineRow[]> = {};
  if (entryIds.length > 0) {
    const { data: linesData } = await supabase
      .from('journal_entry_lines')
      .select('entry_id, account_id, side, amount, tax_treatment, memo')
      .in('entry_id', entryIds)
      .order('line_no');
    linesByEntry = {};
    for (const l of linesData ?? []) {
      const acc = accountById.get(l.account_id as string);
      const list = linesByEntry[l.entry_id as string] ?? [];
      list.push({
        accountId: l.account_id as string,
        accountCode: acc?.code ?? '',
        accountName: acc?.name ?? '(削除済み科目)',
        side: l.side as 'debit' | 'credit',
        amount: l.amount as number,
        taxTreatment: l.tax_treatment as TaxTreatment,
        memo: l.memo as string | null,
      });
      linesByEntry[l.entry_id as string] = list;
    }
  }

  const rows: JournalEntryRow[] = entries.map((e) => {
    const lines = linesByEntry[e.id as string] ?? [];
    const debitTotal = lines.filter((l) => l.side === 'debit').reduce((sum, l) => sum + l.amount, 0);
    return {
      id: e.id as string,
      entryNo: e.entry_no as number,
      entryDate: e.entry_date as string,
      description: e.description as string,
      status: e.status as JournalStatus,
      sourceType: e.source_type as SourceType,
      sourceId: e.source_id as string | null,
      storeId: e.store_id as string | null,
      storeName: (e.stores as unknown as { name: string } | null)?.name ?? null,
      voidReason: e.void_reason as string | null,
      debitTotal,
    };
  });

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const buildHref = (p: number) => {
    const params = new URLSearchParams({ from, to, status, source_type: sourceType, source_id: sourceId, store: storeId, page: String(p) });
    return `/app/accounting?${params.toString()}`;
  };
  const exportQuery = new URLSearchParams({ from, to, status, source_type: sourceType, source_id: sourceId, store: storeId });
  const clearSourceFilterQuery = new URLSearchParams({ from, to, status, store: storeId });

  return (
    <div>
      <PageHeader
        title="仕訳"
        description="複式簿記の仕訳を作成・確定・取消します"
        actions={
          can(ctx.role, 'csv.export') ? (
            <a href={`/app/accounting/export?${exportQuery.toString()}`} className={cn(buttonVariants({ variant: 'secondary' }))}>
              <Download className="h-4 w-4" />
              CSV出力
            </a>
          ) : undefined
        }
      />

      <Card className="mb-4 p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <Label htmlFor="from">開始日</Label>
            <Input id="from" type="date" name="from" defaultValue={from} />
          </div>
          <div>
            <Label htmlFor="to">終了日</Label>
            <Input id="to" type="date" name="to" defaultValue={to} />
          </div>
          <div>
            <Label htmlFor="status">状態</Label>
            <Select id="status" name="status" defaultValue={status}>
              <option value="">すべて</option>
              {JOURNAL_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {JOURNAL_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="source_type">区分</Label>
            <Select id="source_type" name="source_type" defaultValue={sourceType}>
              <option value="">すべて</option>
              {SOURCE_TYPE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_TYPE_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <input type="hidden" name="source_id" value={sourceId} />
          {ctx.isHq && (
            <div>
              <Label htmlFor="store">店舗</Label>
              <Select id="store" name="store" defaultValue={storeId}>
                <option value="">全店舗</option>
                {ctx.stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              絞り込む
            </Button>
          </div>
        </form>
      </Card>

      {sourceId && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-primary/30 bg-primary-soft/40 px-4 py-2.5 text-sm">
          <span className="text-navy">
            元取引で絞り込み中（区分: {sourceType ? SOURCE_TYPE_LABELS[sourceType] : 'すべて'}）
          </span>
          <Link href={`/app/accounting?${clearSourceFilterQuery.toString()}`} className="font-medium text-primary-deep hover:underline">
            絞り込みを解除
          </Link>
        </div>
      )}

      <JournalPanel entries={rows} linesByEntry={linesByEntry} accounts={accounts} stores={ctx.stores} role={ctx.role} />

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>
            {count ?? 0}件中 {rangeFrom + 1}〜{Math.min(count ?? 0, rangeFrom + PAGE_SIZE)}件
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={buildHref(page - 1)} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
                前へ
              </Link>
            )}
            {page < totalPages && (
              <Link href={buildHref(page + 1)} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
                次へ
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="mt-6">
        <PeriodClosePanel initialMonth={today.slice(0, 7)} role={ctx.role} />
      </div>
    </div>
  );
}
