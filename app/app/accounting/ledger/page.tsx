import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { requirePermission, requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { cn } from '@/lib/utils';
import { yen, formatDate } from '@/lib/format';
import { TAX_TREATMENT_LABELS } from '@/lib/accounting';
import { SUB_TYPE_LABELS } from '@/components/accounting/labels';
import { ORIGIN_LINK_LABELS, resolveSourceOriginHref } from '@/components/accounting/journal-source-link';
import { LEDGER_TABS as TABS } from '@/lib/accounting-pages';
import { loadLedgerPage } from '@/lib/accounting-pages-server';

export const metadata: Metadata = { title: '帳簿 | 会計' };

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; store?: string; account?: string }>;
}) {
  await requirePermission('csv.export');
  const ctx = await requireFeature('accounting');
  const sp = await searchParams;
  const supabase = await createClient();

  // 読み込みは lib/accounting-pages-server.ts（iPad ネイティブの会計と同じ）
  const data = await loadLedgerPage(supabase, ctx, sp);
  const { tab, from, to, storeId, candidateAccounts, selectedAccountId } = data;

  let body: React.ReactNode = null;

  if (data.journalEntries) {
    const displayEntries = data.journalEntries;

    body =
      displayEntries.length === 0 ? (
        <EmptyState title="該当する仕訳がありません" description="期間や店舗の条件を変更してください" />
      ) : (
        <div className="space-y-2">
          {displayEntries.map((e) => {
            const debitTotal = e.lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0);
            return (
              <details key={e.id} className="rounded-xl border border-gray-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="font-mono text-xs text-gray-400">#{e.entryNo}</span>
                  <span className="whitespace-nowrap text-xs text-gray-500">{formatDate(e.entryDate)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-navy">{e.description}</span>
                  <span className="tabular-nums text-gray-600">{yen(debitTotal)}</span>
                </summary>
                <table className="w-full text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="px-4 py-1 text-left font-medium">勘定科目</th>
                      <th className="px-2 py-1 text-right font-medium">借方</th>
                      <th className="px-2 py-1 text-right font-medium">貸方</th>
                      <th className="px-2 py-1 text-left font-medium">税区分</th>
                      <th className="px-4 py-1 text-left font-medium">メモ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {e.lines.map((l, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-1">
                          {l.accountCode} {l.accountName}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{l.side === 'debit' ? yen(l.amount) : ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{l.side === 'credit' ? yen(l.amount) : ''}</td>
                        <td className="px-2 py-1">{TAX_TREATMENT_LABELS[l.taxTreatment]}</td>
                        <td className="px-4 py-1 text-gray-500">{l.memo ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            );
          })}
        </div>
      );
  } else {
    const subType = data.subType;

    if (!selectedAccountId) {
      body = (
        <EmptyState
          title={subType ? `${SUB_TYPE_LABELS[subType]}の科目が登録されていません` : '科目が登録されていません'}
          description="「設定」→「勘定科目」で補助区分を設定した科目を登録してください"
        />
      );
    } else {
      const { opening, rows } = data.ledger!;

      body = (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>日付</Th>
                <Th>摘要</Th>
                <Th>相手科目</Th>
                <Th className="text-right">入金・借方</Th>
                <Th className="text-right">出金・貸方</Th>
                <Th className="text-right">残高</Th>
                <Th>店舗</Th>
                <Th>元取引</Th>
              </Tr>
            </THead>
            <TBody>
              <Tr>
                <Td colSpan={5} className="font-medium text-gray-500">
                  繰越残高
                </Td>
                <Td className="text-right font-medium tabular-nums">{yen(opening)}</Td>
                <Td />
                <Td />
              </Tr>
              {rows.length === 0 ? (
                <Tr>
                  <Td colSpan={8} className="text-center text-gray-400">
                    期間内の明細はありません
                  </Td>
                </Tr>
              ) : (
                rows.map((r, idx) => {
                  const originHref = r.sourceType ? resolveSourceOriginHref(r.sourceType, r.sourceId ?? null) : null;
                  return (
                    <Tr key={idx}>
                      <Td className="whitespace-nowrap text-xs text-gray-500">{formatDate(r.date)}</Td>
                      <Td className="max-w-xs truncate">{r.description}</Td>
                      <Td className="max-w-[10rem] truncate text-gray-500">{r.counter}</Td>
                      <Td className="text-right tabular-nums">{r.debit > 0 ? yen(r.debit) : ''}</Td>
                      <Td className="text-right tabular-nums">{r.credit > 0 ? yen(r.credit) : ''}</Td>
                      <Td className="text-right font-medium tabular-nums">{yen(r.balance)}</Td>
                      <Td className="whitespace-nowrap text-xs text-gray-500">{r.storeName ?? '全社'}</Td>
                      <Td>
                        {originHref ? (
                          <Link href={originHref} className="text-xs font-medium text-primary-deep hover:underline">
                            {(r.sourceType && ORIGIN_LINK_LABELS[r.sourceType]) ?? '元取引を見る'}
                          </Link>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </TBody>
          </Table>
        </TableWrap>
      );
    }
  }

  return (
    <div>
      <PageHeader
        title="帳簿"
        description="仕訳帳・総勘定元帳・現金出納帳などの補助簿を確認します"
        actions={
          can(ctx.role, 'csv.export') ? (
            <a href={`/app/accounting/ledger/export?${data.exportQuery}`} className={cn(buttonVariants({ variant: 'secondary' }))}>
              <Download className="h-4 w-4" />
              CSV出力
            </a>
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/app/accounting/ledger?tab=${t.key}`}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'border-primary text-primary-deep' : 'border-transparent text-gray-500 hover:text-navy'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <Card className="mb-4 p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <input type="hidden" name="tab" value={tab} />
          <div>
            <Label htmlFor="from">開始日</Label>
            <Input id="from" type="date" name="from" defaultValue={from} />
          </div>
          <div>
            <Label htmlFor="to">終了日</Label>
            <Input id="to" type="date" name="to" defaultValue={to} />
          </div>
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
          {tab !== 'journal' && candidateAccounts.length > 0 && (
            <div>
              <Label htmlFor="account">科目</Label>
              <Select id="account" name="account" defaultValue={selectedAccountId ?? ''}>
                {candidateAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
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

      {body}
    </div>
  );
}
