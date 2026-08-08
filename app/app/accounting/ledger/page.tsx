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
import { yen, formatDate, todayJst } from '@/lib/format';
import { TAX_TREATMENT_LABELS, type AccountCategory, type TaxTreatment } from '@/lib/accounting';
import { SUB_TYPE_LABELS, type SubType } from '@/components/accounting/labels';
import { computeOpeningBalance, buildLedgerRows, type LedgerEntryLine } from '@/components/accounting/ledger';

export const metadata: Metadata = { title: '帳簿 | 会計' };

type Tab = 'journal' | 'general' | 'cash' | 'bank' | 'receivable' | 'payable';
const TABS: { key: Tab; label: string }[] = [
  { key: 'journal', label: '仕訳帳' },
  { key: 'general', label: '総勘定元帳' },
  { key: 'cash', label: '現金出納帳' },
  { key: 'bank', label: '預金出納帳' },
  { key: 'receivable', label: '売掛帳' },
  { key: 'payable', label: '買掛帳' },
];
const TAB_SUBTYPE: Partial<Record<Tab, SubType>> = { cash: 'cash', bank: 'bank', receivable: 'receivable', payable: 'payable' };

function firstDayOfMonth(dateJst: string): string {
  return `${dateJst.slice(0, 7)}-01`;
}

interface AccountOpt {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
  subType: string | null;
}

interface JournalEntryDisplay {
  id: string;
  entryNo: number;
  entryDate: string;
  description: string;
  lines: { accountCode: string; accountName: string; side: 'debit' | 'credit'; amount: number; taxTreatment: TaxTreatment; memo: string | null }[];
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; store?: string; account?: string }>;
}) {
  await requirePermission('csv.export');
  const ctx = await requireFeature('accounting');
  const sp = await searchParams;
  const supabase = await createClient();

  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'journal';
  const today = todayJst();
  const from = sp.from || firstDayOfMonth(today);
  const to = sp.to || today;
  const storeId = sp.store || (ctx.isHq ? '' : (ctx.currentStore?.id ?? ''));

  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name, category, sub_type')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order')
    .order('code');
  const accounts: AccountOpt[] = (accountsData ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    category: a.category as AccountCategory,
    subType: a.sub_type as string | null,
  }));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const exportParams = new URLSearchParams({ type: tab, from, to });
  if (storeId) exportParams.set('store', storeId);

  let body: React.ReactNode = null;
  let selectedAccountId: string | null = null;
  let candidateAccounts: AccountOpt[] = [];

  if (tab === 'journal') {
    let query = supabase
      .from('journal_entries')
      .select('id, entry_no, entry_date, description')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'posted')
      .gte('entry_date', from)
      .lte('entry_date', to);
    if (storeId) query = query.eq('store_id', storeId);
    const { data: entries } = await query.order('entry_date', { ascending: false }).order('entry_no', { ascending: false }).limit(1000);
    const list = entries ?? [];
    const entryIds = list.map((e) => e.id as string);

    let linesByEntry = new Map<string, JournalEntryDisplay['lines']>();
    if (entryIds.length > 0) {
      const { data: linesData } = await supabase
        .from('journal_entry_lines')
        .select('entry_id, account_id, side, amount, tax_treatment, memo')
        .in('entry_id', entryIds)
        .order('line_no');
      linesByEntry = new Map();
      for (const l of linesData ?? []) {
        const acc = accountById.get(l.account_id as string);
        const arr = linesByEntry.get(l.entry_id as string) ?? [];
        arr.push({
          accountCode: acc?.code ?? '',
          accountName: acc?.name ?? '(削除済み科目)',
          side: l.side as 'debit' | 'credit',
          amount: l.amount as number,
          taxTreatment: l.tax_treatment as TaxTreatment,
          memo: l.memo as string | null,
        });
        linesByEntry.set(l.entry_id as string, arr);
      }
    }

    const displayEntries: JournalEntryDisplay[] = list.map((e) => ({
      id: e.id as string,
      entryNo: e.entry_no as number,
      entryDate: e.entry_date as string,
      description: e.description as string,
      lines: linesByEntry.get(e.id as string) ?? [],
    }));

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
    const subType = TAB_SUBTYPE[tab];
    candidateAccounts = subType ? accounts.filter((a) => a.subType === subType) : accounts;
    selectedAccountId = sp.account && candidateAccounts.some((a) => a.id === sp.account) ? sp.account : (candidateAccounts[0]?.id ?? null);

    if (!selectedAccountId) {
      body = (
        <EmptyState
          title={subType ? `${SUB_TYPE_LABELS[subType]}の科目が登録されていません` : '科目が登録されていません'}
          description="「設定」→「勘定科目」で補助区分を設定した科目を登録してください"
        />
      );
    } else {
      exportParams.set('account', selectedAccountId);
      const account = accountById.get(selectedAccountId)!;

      const buildLineQuery = () => {
        let q = supabase
          .from('journal_entry_lines')
          .select('id, entry_id, line_no, side, amount, memo, journal_entries!inner(entry_date, description, status, store_id)')
          .eq('account_id', selectedAccountId)
          .eq('organization_id', ctx.organizationId)
          .eq('journal_entries.status', 'posted');
        if (storeId) q = q.eq('journal_entries.store_id', storeId);
        return q;
      };

      const [{ data: beforeLines }, { data: periodLinesRaw }] = await Promise.all([
        buildLineQuery().lt('journal_entries.entry_date', from),
        buildLineQuery()
          .gte('journal_entries.entry_date', from)
          .lte('journal_entries.entry_date', to)
          .order('entry_date', { foreignTable: 'journal_entries', ascending: true })
          .order('line_no', { ascending: true }),
      ]);

      const opening = computeOpeningBalance((beforeLines ?? []).map((l) => ({ side: l.side as 'debit' | 'credit', amount: l.amount as number })), account.category);

      const periodEntryIds = [...new Set((periodLinesRaw ?? []).map((l) => l.entry_id as string))];
      let counterByEntry = new Map<string, string>();
      if (periodEntryIds.length > 0) {
        const { data: allLines } = await supabase
          .from('journal_entry_lines')
          .select('entry_id, account_id')
          .in('entry_id', periodEntryIds);
        const byEntry = new Map<string, string[]>();
        for (const l of allLines ?? []) {
          if ((l.account_id as string) === selectedAccountId) continue;
          const acc = accountById.get(l.account_id as string);
          const arr = byEntry.get(l.entry_id as string) ?? [];
          if (acc) arr.push(acc.name);
          byEntry.set(l.entry_id as string, arr);
        }
        counterByEntry = new Map([...byEntry.entries()].map(([id, names]) => [id, [...new Set(names)].join('・') || '(相手科目複数)']));
      }

      const periodLines: LedgerEntryLine[] = (periodLinesRaw ?? []).map((l) => {
        const je = l.journal_entries as unknown as { entry_date: string; description: string };
        return {
          entryId: l.entry_id as string,
          entryDate: je.entry_date,
          description: je.description,
          side: l.side as 'debit' | 'credit',
          amount: l.amount as number,
          memo: l.memo as string | null,
        };
      });

      const rows = buildLedgerRows(periodLines, account.category, opening, (entryId) => counterByEntry.get(entryId) ?? '—');

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
              </Tr>
            </THead>
            <TBody>
              <Tr>
                <Td colSpan={5} className="font-medium text-gray-500">
                  繰越残高
                </Td>
                <Td className="text-right font-medium tabular-nums">{yen(opening)}</Td>
              </Tr>
              {rows.length === 0 ? (
                <Tr>
                  <Td colSpan={6} className="text-center text-gray-400">
                    期間内の明細はありません
                  </Td>
                </Tr>
              ) : (
                rows.map((r, idx) => (
                  <Tr key={idx}>
                    <Td className="whitespace-nowrap text-xs text-gray-500">{formatDate(r.date)}</Td>
                    <Td className="max-w-xs truncate">{r.description}</Td>
                    <Td className="max-w-[10rem] truncate text-gray-500">{r.counter}</Td>
                    <Td className="text-right tabular-nums">{r.debit > 0 ? yen(r.debit) : ''}</Td>
                    <Td className="text-right tabular-nums">{r.credit > 0 ? yen(r.credit) : ''}</Td>
                    <Td className="text-right font-medium tabular-nums">{yen(r.balance)}</Td>
                  </Tr>
                ))
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
            <a href={`/app/accounting/ledger/export?${exportParams.toString()}`} className={cn(buttonVariants({ variant: 'secondary' }))}>
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
