import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { yen, todayJst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/components/invoices/labels';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { MonthlyCostsForm } from '@/components/settlement/monthly-costs-form';
import { OpenStoreButton } from '@/components/settlement/open-store-button';
import {
  buildDailyTable,
  canEditMonthlyCosts,
  fixedCostTotal,
  isMonthKey,
  monthWindow,
  nextMonth,
  prevMonth,
  profitLoss,
  proratedCosts,
  rangeLabel,
  shortDate,
  sumInRange,
  thisWeekWindow,
  type ProfitLoss,
} from '@/lib/monthly-settlement';
import { costsReader, loadSettlementSource, purchaseLines } from './data';

export const metadata: Metadata = { title: '月次清算' };

/**
 * 月次清算（管理画面だけ。レジ iPad には出さない。2026-10-04 Ronnie）。
 * 店ごと・月ごとに、レジで入れた売上・経費、仕入先の請求書、本部が入れる家賃・電気・水道・給料を1つにして、
 * 今週・今月の赤字黒字を出す。Google スプレッドシート（日付×仕入先の表）の置き換え。
 */
export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requirePermission('reports.view');
  const sp = await searchParams;
  const today = todayJst();
  const month = isMonthKey(sp.month) ? sp.month : today.slice(0, 7);

  if (ctx.isRegisterDevice) {
    return (
      <div>
        <PageHeader title="月次清算" en="Monthly P&L" />
        <EmptyState
          title="この画面はパソコン（管理画面）でご利用ください"
          description="売上・仕入・固定費・給料の清算は、店長以上のアカウントでパソコンから開きます。レジ（iPad）には出しません"
        />
      </div>
    );
  }

  const targetStores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  if (targetStores.length === 0) {
    return (
      <div>
        <PageHeader title="月次清算" en="Monthly P&L" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから開いてください" />
      </div>
    );
  }

  const mw = monthWindow(month, today);
  const ww = thisWeekWindow(today);
  const rangeFirst = mw.first < ww.first ? mw.first : ww.first;
  const rangeLast = mw.last > ww.last ? mw.last : ww.last;
  const src = await loadSettlementSource(
    targetStores.map((s) => s.id),
    rangeFirst,
    rangeLast
  );

  const canEdit = canEditMonthlyCosts(ctx);
  const monthLabel = `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
  const monthInProgress = mw.inProgress;

  /** 店ごとの 今月・今週 の損益 */
  const perStore = targetStores.map((store) => {
    const sales = src.salesByStore.get(store.id) ?? new Map<string, number>();
    const invoices = src.invoicesByStore.get(store.id) ?? [];
    const expenses = src.expensesByStore.get(store.id) ?? new Map<string, number>();
    const costs = costsReader(src.settingsByStore.get(store.id) ?? null);
    const inRange = (first: string, last: string) => invoices.filter((i) => i.date >= first && i.date <= last);
    const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);

    const mc = costs(month);
    const monthPl: ProfitLoss = profitLoss({
      sales: sumInRange(sales, mw.first, mw.last),
      purchases: sum(inRange(mw.first, mw.last)),
      expenses: sumInRange(expenses, mw.first, mw.last),
      fixed: fixedCostTotal(mc),
      salary: mc.salary,
    });
    const weekCosts = proratedCosts(ww.dates, costs);
    const weekPl: ProfitLoss = profitLoss({
      sales: sumInRange(sales, ww.first, ww.last),
      purchases: sum(inRange(ww.first, ww.last)),
      expenses: sumInRange(expenses, ww.first, ww.last),
      fixed: weekCosts.fixed,
      salary: weekCosts.salary,
    });
    return { store, sales, invoices, expenses, costs: mc, monthPl, weekPl };
  });

  const nav = (
    <div className="flex items-center gap-1">
      <Link
        href={`/app/settlement?month=${prevMonth(month)}`}
        aria-label="前の月"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-navy hover:bg-gray-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>
      <span className="min-w-[7.5rem] text-center text-sm font-bold text-navy">{monthLabel}</span>
      <Link
        href={`/app/settlement?month=${nextMonth(month)}`}
        aria-label="次の月"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-navy hover:bg-gray-50"
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
      {month !== today.slice(0, 7) && (
        <Link href="/app/settlement" className="ml-1 text-xs font-semibold text-primary underline">
          今月へ
        </Link>
      )}
    </div>
  );

  // ---------------------------------------------------------------- 全店（本部で「全店舗」を選んでいるとき）
  if (!ctx.currentStore) {
    const total = (pick: (p: (typeof perStore)[number]) => number) => perStore.reduce((s, p) => s + pick(p), 0);
    return (
      <div className="space-y-5">
        <PageHeader
          title="月次清算"
          en="Monthly P&L"
          description={`全店舗・${monthLabel}${monthInProgress ? `（${shortDate(mw.last)} まで）` : ''}。店を開くと日ごとの表と固定費・給料の入力`}
          actions={nav}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PlCard label="今週の損益" en="This week" sub={rangeLabel(ww.first, ww.last)} value={total((p) => p.weekPl.profit)} />
          <PlCard label={`${monthLabel}の損益`} en="This month" sub="固定費・給料は月の金額" value={total((p) => p.monthPl.profit)} />
          <PlCard label="売上" en="Sales" sub={monthLabel} value={total((p) => p.monthPl.sales)} plain />
          <PlCard
            label="仕入・経費・固定費・給料"
            en="Costs"
            sub={monthLabel}
            value={total((p) => p.monthPl.purchases + p.monthPl.expenses + p.monthPl.fixed + p.monthPl.salary)}
            plain
          />
        </div>
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>店舗</Th>
                <Th className="text-right">売上</Th>
                <Th className="text-right">仕入（請求書）</Th>
                <Th className="text-right">経費</Th>
                <Th className="text-right">家賃・電気・水道</Th>
                <Th className="text-right">給料</Th>
                <Th className="text-right">{monthLabel}の損益</Th>
                <Th className="text-right">今週の損益</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {perStore.map(({ store, monthPl, weekPl }) => (
                <Tr key={store.id}>
                  <Td className="font-medium text-navy">{store.name}</Td>
                  <Td className="text-right tabular-nums">{yen(monthPl.sales)}</Td>
                  <Td className="text-right tabular-nums">{yen(monthPl.purchases)}</Td>
                  <Td className="text-right tabular-nums">{yen(monthPl.expenses)}</Td>
                  <Td className="text-right tabular-nums">{yen(monthPl.fixed)}</Td>
                  <Td className="text-right tabular-nums">{yen(monthPl.salary)}</Td>
                  <Td className="text-right">
                    <ProfitCell value={monthPl.profit} />
                  </Td>
                  <Td className="text-right">
                    <ProfitCell value={weekPl.profit} />
                  </Td>
                  <Td className="text-right">
                    <OpenStoreButton storeId={store.id} label="開く" />
                  </Td>
                </Tr>
              ))}
              <Tr className="bg-gray-50 font-bold">
                <Td>合計</Td>
                <Td className="text-right tabular-nums">{yen(total((p) => p.monthPl.sales))}</Td>
                <Td className="text-right tabular-nums">{yen(total((p) => p.monthPl.purchases))}</Td>
                <Td className="text-right tabular-nums">{yen(total((p) => p.monthPl.expenses))}</Td>
                <Td className="text-right tabular-nums">{yen(total((p) => p.monthPl.fixed))}</Td>
                <Td className="text-right tabular-nums">{yen(total((p) => p.monthPl.salary))}</Td>
                <Td className="text-right">
                  <ProfitCell value={total((p) => p.monthPl.profit)} />
                </Td>
                <Td className="text-right">
                  <ProfitCell value={total((p) => p.weekPl.profit)} />
                </Td>
                <Td />
              </Tr>
            </TBody>
          </Table>
        </TableWrap>
        <p className="text-xs text-gray-500">
          売上＝レジで会計した金額（返金を引く）。仕入＝請求書・書類に入れた仕入先の請求書（差戻し以外）。経費＝レジ・管理画面で入れた経費（却下以外）。
          家賃・電気・水道・給料は各店を開いて本部が月ごとに入れる。今週の損益は、月の固定費・給料を日割りして引く。
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------- 1店舗（日ごとの表・固定費と給料の入力・請求書）
  const p = perStore[0];
  const table = buildDailyTable(mw.dates, p.sales, purchaseLines(p.invoices), p.expenses);
  const monthInvoices = p.invoices.filter((i) => i.date >= mw.first && i.date <= mw.last).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-5">
      <PageHeader
        title="月次清算"
        en="Monthly P&L"
        description={`${p.store.name}・${monthLabel}${monthInProgress ? `（${shortDate(mw.last)} まで）` : ''}`}
        actions={nav}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PlCard
          label="今週の損益"
          en="This week"
          sub={`${rangeLabel(ww.first, ww.last)}・固定費・給料は日割り`}
          value={p.weekPl.profit}
          detail={p.weekPl}
        />
        <PlCard label={`${monthLabel}の損益`} en="This month" sub="固定費・給料は月の金額" value={p.monthPl.profit} detail={p.monthPl} />
        <PlCard label="売上" en="Sales" sub={`${monthLabel}（返金を引いた金額）`} value={p.monthPl.sales} plain />
        <PlCard
          label="仕入・経費"
          en="Purchases"
          sub={table.outgoShare != null ? `売上の ${table.outgoShare}%` : monthLabel}
          value={p.monthPl.purchases + p.monthPl.expenses}
          plain
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle en="By day / by vendor">日ごとの売上と仕入（仕入先ごと）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th className="sticky left-0 bg-gray-50">日付</Th>
                  <Th className="text-right">売上</Th>
                  {table.vendors.map((v) => (
                    <Th key={v} className="text-right">
                      {v}
                    </Th>
                  ))}
                  <Th className="text-right">経費</Th>
                  <Th className="text-right">仕入・経費 計</Th>
                </Tr>
              </THead>
              <TBody>
                {table.rows.map((r) => (
                  <Tr key={r.date} className={cn(r.sales === 0 && r.outgo === 0 && 'text-gray-400')}>
                    <Td className="sticky left-0 bg-white font-medium text-navy">{shortDate(r.date)}</Td>
                    <Td className="text-right tabular-nums">{r.sales ? yen(r.sales) : ''}</Td>
                    {r.byVendor.map((v, i) => (
                      <Td key={i} className="text-right tabular-nums">
                        {v ? yen(v) : ''}
                      </Td>
                    ))}
                    <Td className="text-right tabular-nums">{r.expenses ? yen(r.expenses) : ''}</Td>
                    <Td className="text-right tabular-nums font-medium">{r.outgo ? yen(r.outgo) : ''}</Td>
                  </Tr>
                ))}
                <Tr className="bg-gray-50 font-bold">
                  <Td className="sticky left-0 bg-gray-50">TOTAL</Td>
                  <Td className="text-right tabular-nums">{yen(table.totals.sales)}</Td>
                  {table.totals.byVendor.map((v, i) => (
                    <Td key={i} className="text-right tabular-nums">
                      {yen(v)}
                    </Td>
                  ))}
                  <Td className="text-right tabular-nums">{yen(table.totals.expenses)}</Td>
                  <Td className="text-right tabular-nums">{yen(table.totals.outgo)}</Td>
                </Tr>
                <Tr className="bg-gray-50 text-xs text-gray-600">
                  <Td className="sticky left-0 bg-gray-50">売上比</Td>
                  <Td className="text-right">100%</Td>
                  {table.vendorShare.map((v, i) => (
                    <Td key={i} className="text-right tabular-nums">
                      {v == null ? '—' : `${v}%`}
                    </Td>
                  ))}
                  <Td className="text-right tabular-nums">{table.expensesShare == null ? '—' : `${table.expensesShare}%`}</Td>
                  <Td className="text-right tabular-nums font-semibold">{table.outgoShare == null ? '—' : `${table.outgoShare}%`}</Td>
                </Tr>
              </TBody>
            </Table>
          </TableWrap>
          {table.vendors.length === 0 && (
            <p className="px-5 py-3 text-xs text-gray-500">
              この月の仕入先の請求書はまだありません。
              <Link href="/app/invoices" className="ml-1 font-semibold text-primary underline">
                請求書・書類
              </Link>
              で仕入先の請求書を入れると、仕入先ごとの列が出ます。
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle en="Rent / utilities / payroll">家賃・電気・水道・給料（{monthLabel}）</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyCostsForm key={`${p.store.id}:${month}`} storeId={p.store.id} storeName={p.store.name} month={month} initial={p.costs} canEdit={canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle en="Vendor invoices">仕入先の請求書（{monthLabel}・{monthInvoices.length}件）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {monthInvoices.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-500">この月の請求書はありません</p>
          ) : (
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>日付</Th>
                    <Th>仕入先</Th>
                    <Th>番号</Th>
                    <Th className="text-right">金額</Th>
                    <Th>支払期日</Th>
                    <Th>状態</Th>
                  </Tr>
                </THead>
                <TBody>
                  {monthInvoices.map((inv) => (
                    <Tr key={inv.id}>
                      <Td>{shortDate(inv.date)}</Td>
                      <Td className="font-medium text-navy">{inv.vendor}</Td>
                      <Td className="text-gray-500">{inv.invoiceNo ?? ''}</Td>
                      <Td className="text-right tabular-nums">{yen(inv.amount)}</Td>
                      <Td className="text-gray-500">{inv.dueDate ? shortDate(inv.dueDate) : ''}</Td>
                      <Td>
                        <Badge tone={inv.status === 'paid' ? 'success' : 'gray'}>{INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ?? inv.status}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
          <p className="px-5 py-3 text-xs text-gray-500">
            請求書の追加・支払の記録は
            <Link href="/app/invoices" className="mx-1 font-semibold text-primary underline">
              請求書・書類
            </Link>
            から。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfitCell({ value }: { value: number }) {
  const loss = value < 0;
  return (
    <span className={cn('inline-flex items-center gap-1 font-bold tabular-nums', loss ? 'text-danger' : 'text-success')}>
      <Badge tone={loss ? 'danger' : 'success'}>{loss ? '赤字' : '黒字'}</Badge>
      {yen(value)}
    </span>
  );
}

/** 損益のカード。plain は赤字黒字の色を付けない（売上・費用） */
function PlCard({
  label,
  en,
  sub,
  value,
  detail,
  plain,
}: {
  label: string;
  en: string;
  sub?: string;
  value: number;
  detail?: ProfitLoss;
  plain?: boolean;
}) {
  const loss = value < 0;
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-gray-500">
        {label}
        <span className="en-inline ml-1">{en}</span>
      </p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', plain ? 'text-navy' : loss ? 'text-danger' : 'text-success')}>
        {!plain && (
          <Badge tone={loss ? 'danger' : 'success'} className="mr-2 align-middle">
            {loss ? '赤字' : '黒字'}
          </Badge>
        )}
        {yen(value)}
      </p>
      {sub && <p className="mt-1 text-[11px] text-gray-500">{sub}</p>}
      {detail && (
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          売上 {yen(detail.sales)} − 仕入 {yen(detail.purchases)} − 経費 {yen(detail.expenses)} − 固定費 {yen(detail.fixed)} − 給料 {yen(detail.salary)}
        </p>
      )}
    </Card>
  );
}
