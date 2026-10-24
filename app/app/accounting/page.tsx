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
import Link from 'next/link';
import { JOURNAL_STATUS_LABELS, JOURNAL_STATUS_OPTIONS, SOURCE_TYPE_LABELS, SOURCE_TYPE_OPTIONS } from '@/components/accounting/labels';
import { JournalPanel } from '@/components/accounting/journal-panel';
import { PeriodClosePanel } from '@/components/accounting/period-close-panel';
import { loadJournalPage, JOURNAL_PAGE_SIZE as PAGE_SIZE } from '@/lib/accounting-pages-server';

export const metadata: Metadata = { title: '仕訳 | 会計' };

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

  // 読み込みは lib/accounting-pages-server.ts（iPad ネイティブの会計と同じ）
  const { today, from, to, status, sourceType, sourceId, storeId, page, accounts, rows, linesByEntry, count, rangeFrom, totalPages } =
    await loadJournalPage(supabase, ctx, sp);
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
