import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, ArrowRight } from 'lucide-react';
import { requirePermission, requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { yen, todayJst } from '@/lib/format';
import {
  aggregateTrialBalance, buildProfitAndLoss, buildBalanceSheet, type AccountInfo, type PostedLine,
} from '@/lib/accounting';
import { ACCOUNT_CATEGORY_LABELS, ACCOUNT_CATEGORY_ORDER } from '@/components/accounting/labels';

export const metadata: Metadata = { title: '財務レポート | 会計' };

function firstDayOfMonth(dateJst: string): string {
  return `${dateJst.slice(0, 7)}-01`;
}

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; store?: string }>;
}) {
  await requirePermission('csv.export');
  const ctx = await requireFeature('accounting');
  const sp = await searchParams;
  const supabase = await createClient();

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
  const accountInfos: AccountInfo[] = (accountsData ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    category: a.category as AccountInfo['category'],
  }));
  const subTypeById = new Map((accountsData ?? []).map((a) => [a.id as string, a.sub_type as string | null]));

  let lineQuery = supabase
    .from('journal_entry_lines')
    .select('account_id, side, amount, journal_entries!inner(entry_date, status, store_id)')
    .eq('organization_id', ctx.organizationId)
    .eq('journal_entries.status', 'posted')
    .gte('journal_entries.entry_date', from)
    .lte('journal_entries.entry_date', to);
  if (storeId) lineQuery = lineQuery.eq('journal_entries.store_id', storeId);
  const { data: linesRaw } = await lineQuery.limit(20000);

  const postedLines: PostedLine[] = (linesRaw ?? []).map((l) => ({
    accountId: l.account_id as string,
    side: l.side as 'debit' | 'credit',
    amount: l.amount as number,
  }));

  const tb = aggregateTrialBalance(postedLines, accountInfos);
  const pl = buildProfitAndLoss(tb);
  const bs = buildBalanceSheet(tb);

  const debitGrandTotal = tb.reduce((sum, r) => sum + r.debitTotal, 0);
  const creditGrandTotal = tb.reduce((sum, r) => sum + r.creditTotal, 0);

  const cashBankBalance = tb.filter((r) => ['cash', 'bank'].includes(subTypeById.get(r.account.id) ?? '')).reduce((s, r) => s + r.balance, 0);
  const receivableBalance = tb.filter((r) => subTypeById.get(r.account.id) === 'receivable').reduce((s, r) => s + r.balance, 0);
  const payableBalance = tb.filter((r) => subTypeById.get(r.account.id) === 'payable').reduce((s, r) => s + r.balance, 0);

  const groupedTb = ACCOUNT_CATEGORY_ORDER.map((category) => ({
    category,
    rows: tb.filter((r) => r.account.category === category),
    subtotal: tb.filter((r) => r.account.category === category).reduce((s, r) => s + r.balance, 0),
  })).filter((g) => g.rows.length > 0);

  const exportParams = new URLSearchParams({ from, to });
  if (storeId) exportParams.set('store', storeId);

  return (
    <div>
      <PageHeader
        title="財務レポート"
        description="確定済み仕訳から試算表・損益計算書・貸借対照表を自動集計します"
        actions={
          can(ctx.role, 'csv.export') ? (
            <a href={`/app/accounting/statements/export?${exportParams.toString()}`} className={cn(buttonVariants({ variant: 'secondary' }))}>
              <Download className="h-4 w-4" />
              試算表CSV出力
            </a>
          ) : undefined
        }
      />

      <Card className="mb-4 p-4">
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              集計する
            </Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-gray-500">
          残高は選択期間内に確定した仕訳から集計しています。期首からの累計残高を見る場合は開始日を早めてください。
        </p>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="現金・預金残高" value={yen(cashBankBalance)} />
        <StatCard label="売掛金残高" value={yen(receivableBalance)} />
        <StatCard label="買掛金・未払金残高" value={yen(payableBalance)} />
        <StatCard label="当期純利益" value={yen(pl.netIncome)} tone={pl.netIncome >= 0 ? 'success' : 'danger'} />
      </div>

      <Card className="mb-4 bg-primary-soft/40 p-4">
        <p className="text-sm text-navy">
          仕訳データはPOS売上・仕入・経費・給与から自動生成できます。
          <Link href="/app/accounting/auto" className="ml-1 inline-flex items-center gap-1 font-medium text-primary-deep hover:underline">
            自動仕訳ページへ
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>試算表</CardTitle>
            <Badge tone={debitGrandTotal === creditGrandTotal ? 'success' : 'danger'}>
              {debitGrandTotal === creditGrandTotal ? '借方・貸方の総計が一致しています' : '借方・貸方の総計が一致していません'}
            </Badge>
          </CardHeader>
          <CardContent>
            {groupedTb.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">この期間に確定した仕訳がありません</p>
            ) : (
              <div className="space-y-5">
                {groupedTb.map((g) => (
                  <div key={g.category}>
                    <h3 className="mb-2 text-sm font-semibold text-navy">{ACCOUNT_CATEGORY_LABELS[g.category]}</h3>
                    <TableWrap>
                      <Table>
                        <THead>
                          <Tr>
                            <Th>コード</Th>
                            <Th>科目</Th>
                            <Th className="text-right">借方計</Th>
                            <Th className="text-right">貸方計</Th>
                            <Th className="text-right">残高</Th>
                          </Tr>
                        </THead>
                        <TBody>
                          {g.rows.map((r) => (
                            <Tr key={r.account.id}>
                              <Td className="font-mono text-xs">{r.account.code}</Td>
                              <Td className="font-medium text-navy">{r.account.name}</Td>
                              <Td className="text-right tabular-nums">{yen(r.debitTotal)}</Td>
                              <Td className="text-right tabular-nums">{yen(r.creditTotal)}</Td>
                              <Td className="text-right font-medium tabular-nums">{yen(r.balance)}</Td>
                            </Tr>
                          ))}
                          <Tr className="bg-gray-50 font-medium">
                            <Td colSpan={4}>{ACCOUNT_CATEGORY_LABELS[g.category]} 小計</Td>
                            <Td className="text-right tabular-nums">{yen(g.subtotal)}</Td>
                          </Tr>
                        </TBody>
                      </Table>
                    </TableWrap>
                  </div>
                ))}
                <div className="flex justify-end gap-6 text-sm">
                  <span className="text-gray-500">借方総計: <span className="font-medium tabular-nums text-navy">{yen(debitGrandTotal)}</span></span>
                  <span className="text-gray-500">貸方総計: <span className="font-medium tabular-nums text-navy">{yen(creditGrandTotal)}</span></span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>損益計算書</CardTitle>
          </CardHeader>
          <CardContent>
            <TableWrap>
              <Table>
                <TBody>
                  <Tr className="bg-gray-50">
                    <Td className="font-semibold text-navy">収益</Td>
                    <Td className="text-right font-semibold tabular-nums">{yen(pl.revenueTotal)}</Td>
                  </Tr>
                  {pl.revenues.map((r) => (
                    <Tr key={r.account.id}>
                      <Td className="pl-8 text-gray-600">{r.account.name}</Td>
                      <Td className="text-right tabular-nums">{yen(r.balance)}</Td>
                    </Tr>
                  ))}
                  <Tr className="bg-gray-50">
                    <Td className="font-semibold text-navy">費用</Td>
                    <Td className="text-right font-semibold tabular-nums">{yen(pl.expenseTotal)}</Td>
                  </Tr>
                  {pl.expenses.map((r) => (
                    <Tr key={r.account.id}>
                      <Td className="pl-8 text-gray-600">{r.account.name}</Td>
                      <Td className="text-right tabular-nums">{yen(r.balance)}</Td>
                    </Tr>
                  ))}
                  <Tr className="border-t-2 border-navy/10">
                    <Td className="font-bold text-navy">当期純利益（収益−費用）</Td>
                    <Td className={cn('text-right font-bold tabular-nums', pl.netIncome >= 0 ? 'text-success' : 'text-danger')}>
                      {yen(pl.netIncome)}
                    </Td>
                  </Tr>
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>貸借対照表</CardTitle>
            <Badge tone={bs.balanced ? 'success' : 'danger'}>{bs.balanced ? '貸借が一致しています' : '貸借が一致していません'}</Badge>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <TableWrap>
                <Table>
                  <TBody>
                    <Tr className="bg-gray-50">
                      <Td className="font-semibold text-navy">資産</Td>
                      <Td className="text-right font-semibold tabular-nums">{yen(bs.assetTotal)}</Td>
                    </Tr>
                    {bs.assets.map((r) => (
                      <Tr key={r.account.id}>
                        <Td className="pl-8 text-gray-600">{r.account.name}</Td>
                        <Td className="text-right tabular-nums">{yen(r.balance)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
              <TableWrap>
                <Table>
                  <TBody>
                    <Tr className="bg-gray-50">
                      <Td className="font-semibold text-navy">負債</Td>
                      <Td className="text-right font-semibold tabular-nums">{yen(bs.liabilityTotal)}</Td>
                    </Tr>
                    {bs.liabilities.map((r) => (
                      <Tr key={r.account.id}>
                        <Td className="pl-8 text-gray-600">{r.account.name}</Td>
                        <Td className="text-right tabular-nums">{yen(r.balance)}</Td>
                      </Tr>
                    ))}
                    <Tr className="bg-gray-50">
                      <Td className="font-semibold text-navy">純資産</Td>
                      <Td className="text-right font-semibold tabular-nums">{yen(bs.equityTotal)}</Td>
                    </Tr>
                    {bs.equity.map((r) => (
                      <Tr key={r.account.id}>
                        <Td className="pl-8 text-gray-600">{r.account.name}</Td>
                        <Td className="text-right tabular-nums">{yen(r.balance)}</Td>
                      </Tr>
                    ))}
                    <Tr>
                      <Td className="pl-8 text-gray-600">当期純利益</Td>
                      <Td className="text-right tabular-nums">{yen(bs.netIncome)}</Td>
                    </Tr>
                    <Tr className="border-t-2 border-navy/10">
                      <Td className="font-bold text-navy">負債・純資産合計</Td>
                      <Td className="text-right font-bold tabular-nums">{yen(bs.liabilityTotal + bs.equityTotal + bs.netIncome)}</Td>
                    </Tr>
                  </TBody>
                </Table>
              </TableWrap>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
