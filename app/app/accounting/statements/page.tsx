import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, ArrowRight, AlertTriangle } from 'lucide-react';
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
  aggregateTrialBalance,
  aggregateTrialBalanceWithOpening,
  buildOperatingStatement,
  buildBalanceSheet,
  type AccountInfo,
  type PostedLine,
  type TrialBalanceRow,
  type OperatingStatement,
} from '@/lib/accounting';
import { ACCOUNT_CATEGORY_LABELS, ACCOUNT_CATEGORY_ORDER } from '@/components/accounting/labels';

export const metadata: Metadata = { title: '財務レポート | 会計' };

function firstDayOfMonth(dateJst: string): string {
  return `${dateJst.slice(0, 7)}-01`;
}

/** 'YYYY-MM-DD' の delta 日後（UTCカレンダー演算・TZ非依存） */
function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM' を delta ヶ月ずらす */
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(ym: string): { from: string; to: string } {
  return { from: `${ym}-01`, to: addDays(`${shiftMonth(ym, 1)}-01`, -1) };
}

/** from〜to に含まれる暦月の一覧（'YYYY-MM'）。最大12ヶ月まで */
function monthsInRange(from: string, to: string): string[] {
  const startYm = from.slice(0, 7);
  const endYm = to.slice(0, 7);
  const result: string[] = [];
  let cur = startYm;
  let guard = 0;
  while (cur <= endYm && guard < 13) {
    result.push(cur);
    cur = shiftMonth(cur, 1);
    guard += 1;
  }
  return result;
}

const BS_CATEGORIES = new Set(['asset', 'liability', 'equity']);

const STAGE_ROWS: { label: string; get: (s: OperatingStatement) => number; emphasize?: boolean }[] = [
  { label: '売上高', get: (s) => s.revenueTotal },
  { label: '売上原価', get: (s) => s.cogsTotal },
  { label: '売上総利益', get: (s) => s.grossProfit, emphasize: true },
  { label: '人件費', get: (s) => s.laborTotal },
  { label: '経費', get: (s) => s.opexTotal },
  { label: '営業利益', get: (s) => s.operatingIncome, emphasize: true },
];

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
  const storeName = storeId ? (ctx.stores.find((s) => s.id === storeId)?.name ?? null) : null;

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

  /** posted・店舗絞込・期間指定で仕訳明細を取得する（このページ全体で使い回す） */
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
  const fetchOperatingStatement = async (rangeFrom: string, rangeTo: string): Promise<OperatingStatement> =>
    buildOperatingStatement(aggregateTrialBalance(await fetchPostedLines(rangeFrom, rangeTo), accountInfos));

  // 期首残高付き試算表: 期間開始前の全確定仕訳（期首）と期間内の確定仕訳（当期）を別々に集計する
  const baseMonth = from.slice(0, 7);
  const prevMonthYm = shiftMonth(baseMonth, -1);
  const lastYearYm = shiftMonth(baseMonth, -12);
  const prevMonthRange = monthRange(prevMonthYm);
  const lastYearRange = monthRange(lastYearYm);
  const months = monthsInRange(from, to);
  const showMonthlyBreakdown = months.length >= 2 && months.length <= 12;

  const [openingPostedLines, periodPostedLines, opStatementPrevMonth, opStatementLastYear, monthlyStatements] = await Promise.all([
    fetchPostedLines('1900-01-01', addDays(from, -1)),
    fetchPostedLines(from, to),
    fetchOperatingStatement(prevMonthRange.from, prevMonthRange.to),
    fetchOperatingStatement(lastYearRange.from, lastYearRange.to),
    showMonthlyBreakdown
      ? Promise.all(months.map((ym) => fetchOperatingStatement(monthRange(ym).from, monthRange(ym).to)))
      : Promise.resolve([] as OperatingStatement[]),
  ]);

  const tbOpening = aggregateTrialBalanceWithOpening(openingPostedLines, periodPostedLines, accountInfos);

  // P/L（段階損益）は当期の期中増減（期首残高を含まない）で計算する
  const tbForPL: TrialBalanceRow[] = tbOpening.map((r) => ({ account: r.account, debitTotal: r.debitTotal, creditTotal: r.creditTotal, balance: r.balance }));
  const opStatement = buildOperatingStatement(tbForPL);

  // B/S は資産・負債・純資産のみ期末（期首＋期中）の累計残高を使い、当期純利益の算出に使う収益・費用は期中のみで計算する
  const tbForBS: TrialBalanceRow[] = tbOpening.map((r) => ({
    account: r.account,
    debitTotal: r.debitTotal,
    creditTotal: r.creditTotal,
    balance: BS_CATEGORIES.has(r.account.category) ? r.closingBalance : r.balance,
  }));
  const bs = buildBalanceSheet(tbForBS);

  const debitGrandTotal = tbOpening.reduce((sum, r) => sum + r.debitTotal, 0);
  const creditGrandTotal = tbOpening.reduce((sum, r) => sum + r.creditTotal, 0);
  const trialBalanced = debitGrandTotal === creditGrandTotal;

  const cashBankBalance = tbOpening.filter((r) => ['cash', 'bank'].includes(subTypeById.get(r.account.id) ?? '')).reduce((s, r) => s + r.closingBalance, 0);
  const receivableBalance = tbOpening.filter((r) => subTypeById.get(r.account.id) === 'receivable').reduce((s, r) => s + r.closingBalance, 0);
  const payableBalance = tbOpening.filter((r) => subTypeById.get(r.account.id) === 'payable').reduce((s, r) => s + r.closingBalance, 0);

  const groupedTb = ACCOUNT_CATEGORY_ORDER.map((category) => ({
    category,
    rows: tbOpening.filter((r) => r.account.category === category),
  })).filter((g) => g.rows.length > 0);

  const exportParams = new URLSearchParams({ from, to });
  if (storeId) exportParams.set('store', storeId);

  /** 試算表の各数値セルから該当科目の元帳（総勘定元帳）へのドリルダウンURL */
  const ledgerHref = (accountId: string, rangeFrom: string, rangeTo: string) => {
    const params = new URLSearchParams({ tab: 'general', account: accountId, from: rangeFrom, to: rangeTo });
    if (storeId) params.set('store', storeId);
    return `/app/accounting/ledger?${params.toString()}`;
  };
  const openingLedgerHref = (accountId: string) => ledgerHref(accountId, '1900-01-01', addDays(from, -1));
  const periodLedgerHref = (accountId: string) => ledgerHref(accountId, from, to);

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
                <option value="">全社（全店舗）</option>
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
          残高・試算表は選択期間の確定仕訳から集計しています。期首残高は期間開始日より前の全確定仕訳の累計です。
        </p>
      </Card>

      {!bs.balanced && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div>
            <p className="text-sm font-bold text-danger">資産合計と負債・純資産合計が一致していません。仕訳データに異常があります</p>
            <p className="mt-1 text-xs text-danger/80">
              資産合計 {yen(bs.assetTotal)} ／ 負債・純資産合計 {yen(bs.liabilityTotal + bs.equityTotal + bs.netIncome)}
              （差額 {yen(bs.assetTotal - (bs.liabilityTotal + bs.equityTotal + bs.netIncome))}）
            </p>
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="現金・預金残高（期末）" value={yen(cashBankBalance)} />
        <StatCard label="売掛金残高（期末）" value={yen(receivableBalance)} />
        <StatCard label="買掛金・未払金残高（期末）" value={yen(payableBalance)} />
        <StatCard label="当期純利益" value={yen(opStatement.operatingIncome)} tone={opStatement.operatingIncome >= 0 ? 'success' : 'danger'} />
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
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>試算表（期首残高対応）</CardTitle>
            <Badge tone={trialBalanced ? 'success' : 'danger'}>
              {trialBalanced ? '期間内の借方・貸方は一致しています' : '貸借不一致 — データ異常です'}
            </Badge>
          </CardHeader>
          <CardContent>
            {groupedTb.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">この期間に確定した仕訳・期首残高がありません</p>
            ) : (
              <div className="space-y-5">
                <p className="text-xs text-gray-500">各金額は該当科目の総勘定元帳へのリンクです。クリックすると明細を確認できます。</p>
                {groupedTb.map((g) => {
                  const subtotalOpening = g.rows.reduce((s, r) => s + r.openingBalance, 0);
                  const subtotalDebit = g.rows.reduce((s, r) => s + r.debitTotal, 0);
                  const subtotalCredit = g.rows.reduce((s, r) => s + r.creditTotal, 0);
                  const subtotalClosing = g.rows.reduce((s, r) => s + r.closingBalance, 0);
                  return (
                    <div key={g.category}>
                      <h3 className="mb-2 text-sm font-semibold text-navy">{ACCOUNT_CATEGORY_LABELS[g.category]}</h3>
                      <TableWrap>
                        <Table>
                          <THead>
                            <Tr>
                              <Th>コード</Th>
                              <Th>科目</Th>
                              <Th className="text-right">期首残高</Th>
                              <Th className="text-right">借方計</Th>
                              <Th className="text-right">貸方計</Th>
                              <Th className="text-right">期末残高</Th>
                            </Tr>
                          </THead>
                          <TBody>
                            {g.rows.map((r) => (
                              <Tr key={r.account.id}>
                                <Td className="font-mono text-xs">{r.account.code}</Td>
                                <Td className="font-medium text-navy">{r.account.name}</Td>
                                <Td className="text-right tabular-nums">
                                  <Link href={openingLedgerHref(r.account.id)} className="hover:text-primary-deep hover:underline">
                                    {yen(r.openingBalance)}
                                  </Link>
                                </Td>
                                <Td className="text-right tabular-nums">
                                  <Link href={periodLedgerHref(r.account.id)} className="hover:text-primary-deep hover:underline">
                                    {yen(r.debitTotal)}
                                  </Link>
                                </Td>
                                <Td className="text-right tabular-nums">
                                  <Link href={periodLedgerHref(r.account.id)} className="hover:text-primary-deep hover:underline">
                                    {yen(r.creditTotal)}
                                  </Link>
                                </Td>
                                <Td className="text-right font-medium tabular-nums">
                                  <Link href={periodLedgerHref(r.account.id)} className="hover:text-primary-deep hover:underline">
                                    {yen(r.closingBalance)}
                                  </Link>
                                </Td>
                              </Tr>
                            ))}
                            <Tr className="bg-gray-50 font-medium">
                              <Td colSpan={2}>{ACCOUNT_CATEGORY_LABELS[g.category]} 小計</Td>
                              <Td className="text-right tabular-nums">{yen(subtotalOpening)}</Td>
                              <Td className="text-right tabular-nums">{yen(subtotalDebit)}</Td>
                              <Td className="text-right tabular-nums">{yen(subtotalCredit)}</Td>
                              <Td className="text-right tabular-nums">{yen(subtotalClosing)}</Td>
                            </Tr>
                          </TBody>
                        </Table>
                      </TableWrap>
                    </div>
                  );
                })}
                <div className="flex flex-wrap justify-end gap-6 text-sm">
                  <span className="text-gray-500">期間借方総計: <span className="font-medium tabular-nums text-navy">{yen(debitGrandTotal)}</span></span>
                  <span className="text-gray-500">期間貸方総計: <span className="font-medium tabular-nums text-navy">{yen(creditGrandTotal)}</span></span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>損益計算書（段階損益）</CardTitle>
            <Badge tone="gray">表示範囲: {storeName ?? '全社（全店舗）'}</Badge>
          </CardHeader>
          <CardContent className="space-y-6">
            <TableWrap>
              <Table>
                <TBody>
                  <Tr className="bg-gray-50">
                    <Td className="font-semibold text-navy">売上高</Td>
                    <Td className="text-right font-semibold tabular-nums">{yen(opStatement.revenueTotal)}</Td>
                  </Tr>
                  {opStatement.revenues.map((r) => (
                    <Tr key={r.account.id}>
                      <Td className="pl-8 text-gray-600">{r.account.name}</Td>
                      <Td className="text-right tabular-nums">{yen(r.balance)}</Td>
                    </Tr>
                  ))}
                  <Tr className="bg-gray-50">
                    <Td className="font-semibold text-navy">売上原価</Td>
                    <Td className="text-right font-semibold tabular-nums">{yen(opStatement.cogsTotal)}</Td>
                  </Tr>
                  {opStatement.cogs.map((r) => (
                    <Tr key={r.account.id}>
                      <Td className="pl-8 text-gray-600">{r.account.name}</Td>
                      <Td className="text-right tabular-nums">{yen(r.balance)}</Td>
                    </Tr>
                  ))}
                  <Tr className="border-t-2 border-navy/10">
                    <Td className="font-bold text-navy">売上総利益</Td>
                    <Td className="text-right font-bold tabular-nums">{yen(opStatement.grossProfit)}</Td>
                  </Tr>
                  <Tr className="bg-gray-50">
                    <Td className="font-semibold text-navy">人件費</Td>
                    <Td className="text-right font-semibold tabular-nums">{yen(opStatement.laborTotal)}</Td>
                  </Tr>
                  {opStatement.labor.map((r) => (
                    <Tr key={r.account.id}>
                      <Td className="pl-8 text-gray-600">{r.account.name}</Td>
                      <Td className="text-right tabular-nums">{yen(r.balance)}</Td>
                    </Tr>
                  ))}
                  <Tr className="bg-gray-50">
                    <Td className="font-semibold text-navy">経費</Td>
                    <Td className="text-right font-semibold tabular-nums">{yen(opStatement.opexTotal)}</Td>
                  </Tr>
                  {opStatement.opex.map((r) => (
                    <Tr key={r.account.id}>
                      <Td className="pl-8 text-gray-600">{r.account.name}</Td>
                      <Td className="text-right tabular-nums">{yen(r.balance)}</Td>
                    </Tr>
                  ))}
                  <Tr className="border-t-2 border-navy/10">
                    <Td className="font-bold text-navy">営業利益（売上総利益－人件費－経費）</Td>
                    <Td className={cn('text-right font-bold tabular-nums', opStatement.operatingIncome >= 0 ? 'text-success' : 'text-danger')}>
                      {yen(opStatement.operatingIncome)}
                    </Td>
                  </Tr>
                </TBody>
              </Table>
            </TableWrap>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-navy">期間比較（月次）</h3>
              <p className="mb-2 text-xs text-gray-500">
                当期の開始日（{from}）が属する月を基準に、前月（{prevMonthYm}）・前年同月（{lastYearYm}）の実績を比較します。
              </p>
              <TableWrap>
                <Table>
                  <THead>
                    <Tr>
                      <Th>科目</Th>
                      <Th className="text-right">当期</Th>
                      <Th className="text-right">前月</Th>
                      <Th className="text-right">前年同月</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {STAGE_ROWS.map((row) => (
                      <Tr key={row.label} className={row.emphasize ? 'bg-gray-50 font-medium' : undefined}>
                        <Td className={row.emphasize ? 'font-semibold text-navy' : 'text-gray-600'}>{row.label}</Td>
                        <Td className="text-right tabular-nums">{yen(row.get(opStatement))}</Td>
                        <Td className="text-right tabular-nums">{yen(row.get(opStatementPrevMonth))}</Td>
                        <Td className="text-right tabular-nums">{yen(row.get(opStatementLastYear))}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            {showMonthlyBreakdown && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-navy">月別推移</h3>
                <TableWrap>
                  <Table>
                    <THead>
                      <Tr>
                        <Th>科目</Th>
                        {months.map((ym) => (
                          <Th key={ym} className="text-right">
                            {ym}
                          </Th>
                        ))}
                      </Tr>
                    </THead>
                    <TBody>
                      {STAGE_ROWS.map((row) => (
                        <Tr key={row.label} className={row.emphasize ? 'bg-gray-50 font-medium' : undefined}>
                          <Td className={row.emphasize ? 'font-semibold text-navy' : 'text-gray-600'}>{row.label}</Td>
                          {monthlyStatements.map((s, idx) => (
                            <Td key={months[idx]} className="text-right tabular-nums">
                              {yen(row.get(s))}
                            </Td>
                          ))}
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>
            )}
            {months.length > 12 && (
              <p className="text-xs text-gray-400">選択期間が12ヶ月を超えるため、月別推移の表示は省略しています（期間比較は表示しています）。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>貸借対照表</CardTitle>
            <Badge tone={bs.balanced ? 'success' : 'danger'}>{bs.balanced ? '貸借が一致しています' : '貸借が一致していません'}</Badge>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-gray-500">資産・負債・純資産は期末（{to}時点）の累計残高です。</p>
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
