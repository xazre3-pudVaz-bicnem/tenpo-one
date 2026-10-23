import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature, requirePermission } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { yen, weekdayJa } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { PeriodLinks } from '@/components/reports/period-links';
import { PeriodForm } from '@/components/reports/period-form';
import { DailySalesChart } from '@/components/reports/daily-sales-chart';
import { HourlySalesChart } from '@/components/reports/hourly-sales-chart';
import { WeekdaySalesChart } from '@/components/reports/weekday-sales-chart';
import { PaymentMethodChart } from '@/components/reports/payment-method-chart';
import { CategorySalesChart } from '@/components/reports/category-sales-chart';
import { LinkStatCard } from '@/components/reports/stat-link';
import { DeltaBadge } from '@/components/reports/delta-badge';
import { PlCascade } from '@/components/reports/pl-cascade';
import { calcDelta } from '@/components/reports/compare';
import { CostVarianceCard } from '@/components/reports/cost-variance-card';
import { loadReportData } from '@/lib/reports-data-server';

export const metadata: Metadata = { title: 'レポート・経営分析' };


export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; store?: string }>;
}) {
  await requireFeature('reports');
  const ctx = await requirePermission('reports.view');

  const sp = await searchParams;
  const data = await loadReportData(ctx, sp);
  if (!data) {
    return (
      <div>
        <PageHeader title="レポート" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗の割り当てを依頼してください" />
      </div>
    );
  }
  const {
    from,
    to,
    scopeLabel,
    storeOverrideId,
    extraQ,
    presets,
    compareLabel,
    plSteps,
    salesTotal,
    prevSalesTotal,
    grossProfit,
    prevGrossProfit,
    storeProfit,
    prevStoreProfit,
    costVariance,
    purchasePriceVariance,
    monthlyPl,
    avgSpend,
    prevAvgSpend,
    guestCount,
    prevGuestCount,
    flCost,
    flRatePct,
    costRatePct,
    prevCostRatePct,
    laborRatePct,
    prevLaborRatePct,
    turnoverRate,
    totalSeats,
    tableUtilizationPct,
    reservationCompletionRate,
    reservationCompleted,
    reservationCompletionBase,
    cancelRatePct,
    noShowRatePct,
    repeatRatePct,
    repeatCustomerCount,
    visitedCustomerCount,
    ltvAverage,
    wasteRatePct,
    wasteAmount,
    transactionCount,
    reservationCount,
    walkInCount,
    discountTotal,
    dailyChartData,
    paymentChartData,
    hourlyChartData,
    weekdayChartData,
    categoryChartData,
    storeComparison,
    productRows,
    staffRows,
    sourceRows,
    dailyRows,
    ordersHref,
    reservationsHref,
    customerCount,
    includeTakeoutGuests,
  } = data;

  return (
    <div>
      <PageHeader
        title="レポート・経営分析"
        description={`${scopeLabel}｜${from.replaceAll('-', '/')}〜${to.replaceAll('-', '/')}の実績`}
        actions={
          can(ctx.role, 'csv.export') && (
            <a href={`/app/reports/export?from=${from}&to=${to}`} className={buttonVariants({ variant: 'secondary' })}>
              CSV出力
            </a>
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodLinks basePath="/app/reports" presets={presets} currentFrom={from} currentTo={to} extra={extraQ} />
        <PeriodForm action="/app/reports" from={from} to={to} hidden={{ store: storeOverrideId ?? undefined }} />
      </div>
      {storeOverrideId && (
        <p className="mt-2 text-xs text-gray-500">
          {scopeLabel.replace('（全店舗から絞込中）', '')} に絞り込み中です。
          <Link href={`/app/reports?from=${from}&to=${to}`} className="ml-1 font-medium text-primary hover:underline">
            全店舗表示に戻す
          </Link>
        </p>
      )}

      {/* ---- P/Lカスケード ---- */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>P/Lカスケード（総売上 − 値引 − 返金 = 純売上 − 原価（理論） = 粗利益 − 人件費 − 経費 = 店舗利益）</CardTitle>
        </CardHeader>
        <CardContent>
          <PlCascade steps={plSteps} />
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1">
            <DeltaBadge delta={calcDelta(salesTotal, prevSalesTotal)} label={`純売上 ${compareLabel}`} />
            <DeltaBadge delta={calcDelta(grossProfit, prevGrossProfit)} label={`粗利益 ${compareLabel}`} />
            <DeltaBadge delta={calcDelta(storeProfit, prevStoreProfit)} label={`店舗利益 ${compareLabel}`} />
          </div>
          <p className="mt-2 text-xs text-gray-400">
            純売上 = 総売上（会計成立注文の合計・値引後）− 返金。原価は理論原価（販売×レシピ×平均仕入単価）を使用しています。実際の原価（廃棄・棚卸差異を反映）は下記「原価差異分析」を参照してください。
          </p>
        </CardContent>
      </Card>

      <CostVarianceCard variance={costVariance} salesTotal={salesTotal} purchaseVariance={purchasePriceVariance} />

      {/* ---- 月別損益推移（3ヶ月） ---- */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>月別損益推移（前々月・前月・当月）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>項目</Th>
                  {monthlyPl.map((m) => (
                    <Th key={m.label} className="text-right">
                      {m.label}
                    </Th>
                  ))}
                </Tr>
              </THead>
              <TBody>
                <Tr>
                  <Td className="font-medium text-navy">売上（純）</Td>
                  {monthlyPl.map((m) => (
                    <Td key={m.label} className="text-right tabular-nums">
                      {yen(m.sales)}
                      {m.budgetSales != null && (
                        <span className={`ml-1.5 text-xs ${m.sales >= m.budgetSales ? 'text-success' : 'text-danger'}`}>
                          （予算比{m.budgetSales > 0 ? ((m.sales / m.budgetSales) * 100).toFixed(0) : '0'}%）
                        </span>
                      )}
                    </Td>
                  ))}
                </Tr>
                <Tr>
                  <Td className="font-medium text-navy">原価（理論）</Td>
                  {monthlyPl.map((m) => (
                    <Td key={m.label} className="text-right tabular-nums">
                      {yen(m.cost)}
                    </Td>
                  ))}
                </Tr>
                <Tr>
                  <Td className="font-medium text-navy">粗利益</Td>
                  {monthlyPl.map((m) => (
                    <Td key={m.label} className="text-right tabular-nums">
                      {yen(m.grossProfit)}
                    </Td>
                  ))}
                </Tr>
                <Tr>
                  <Td className="font-medium text-navy">人件費（概算）</Td>
                  {monthlyPl.map((m) => (
                    <Td key={m.label} className="text-right tabular-nums">
                      {yen(m.labor)}
                    </Td>
                  ))}
                </Tr>
                <Tr>
                  <Td className="font-medium text-navy">経費</Td>
                  {monthlyPl.map((m) => (
                    <Td key={m.label} className="text-right tabular-nums">
                      {yen(m.expense)}
                    </Td>
                  ))}
                </Tr>
                <Tr>
                  <Td className="font-semibold text-navy">店舗利益</Td>
                  {monthlyPl.map((m) => (
                    <Td key={m.label} className={`text-right tabular-nums font-semibold ${m.profit >= 0 ? 'text-success' : 'text-danger'}`}>
                      {yen(m.profit)}
                      {m.budgetProfit != null && (
                        <span className={`ml-1.5 text-xs font-normal ${m.profit >= m.budgetProfit ? 'text-success' : 'text-danger'}`}>
                          （予算比{m.budgetProfit !== 0 ? ((m.profit / m.budgetProfit) * 100).toFixed(0) : '0'}%）
                        </span>
                      )}
                    </Td>
                  ))}
                </Tr>
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>
      <p className="mt-1.5 text-xs text-gray-400">
        ※ 予算対比は「予算管理」（/app/budgets）に登録された値がある月のみ表示します。本社共通費（家賃・システム利用料等）の店舗への配賦は将来機能で、現状の経費は店舗（または選択スコープ）に直接紐づく経費のみを集計しています。
      </p>

      {/* ---- KPIグリッド ---- */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <LinkStatCard
          href={ordersHref}
          label="客単価"
          value={yen(avgSpend)}
          sub={<DeltaBadge delta={calcDelta(avgSpend, prevAvgSpend)} label={compareLabel} />}
        />
        <LinkStatCard
          href={ordersHref}
          label="客数"
          value={`${guestCount.toLocaleString('ja-JP')}名`}
          sub={<DeltaBadge delta={calcDelta(guestCount, prevGuestCount)} label={compareLabel} />}
        />
        <LinkStatCard href="/app/costing?tab=items" label="FLコスト" value={yen(flCost)} sub="原価+人件費" />
        <LinkStatCard href="/app/costing?tab=items" label="FL比率" value={`${flRatePct.toFixed(1)}%`} tone={flRatePct > 60 ? 'warning' : 'default'} />
        <LinkStatCard
          href="/app/costing?tab=items"
          label="原価率（理論）"
          value={`${costRatePct.toFixed(1)}%`}
          sub={<DeltaBadge delta={calcDelta(costRatePct, prevCostRatePct)} label={compareLabel} positiveIsGood={false} />}
        />
        <LinkStatCard
          href="/app/payroll"
          label="人件費率"
          value={`${laborRatePct.toFixed(1)}%`}
          sub={<DeltaBadge delta={calcDelta(laborRatePct, prevLaborRatePct)} label={compareLabel} positiveIsGood={false} />}
        />
        <LinkStatCard href={reservationsHref} label="回転率" value={`${turnoverRate.toFixed(2)}回`} sub={`客数÷総席数(${totalSeats}席)`} />
        <LinkStatCard href={ordersHref} label="テーブル稼働率" value={`${tableUtilizationPct.toFixed(1)}%`} sub="簡易計算（日別利用テーブル数の平均）" />
        <LinkStatCard href={`${reservationsHref}&status=completed`} label="予約成約率" value={`${reservationCompletionRate.toFixed(1)}%`} sub={`${reservationCompleted}/${reservationCompletionBase}件`} />
        <LinkStatCard href={`${reservationsHref}&status=cancelled`} label="キャンセル率" value={`${cancelRatePct.toFixed(1)}%`} tone={cancelRatePct > 10 ? 'warning' : 'default'} />
        <LinkStatCard href={`${reservationsHref}&status=no_show`} label="無断キャンセル率" value={`${noShowRatePct.toFixed(1)}%`} tone={noShowRatePct > 3 ? 'danger' : 'default'} />
        <LinkStatCard href="/app/customers?segment=repeater" label="再来店率" value={`${repeatRatePct.toFixed(1)}%`} sub={`${repeatCustomerCount}/${visitedCustomerCount}人（期間内）`} />
        <LinkStatCard href="/app/customers?sort=total_spent_desc" label="LTV平均" value={yen(ltvAverage)} sub={`累計購入額の平均（${customerCount}人）`} />
        <LinkStatCard href={`/app/costing?tab=waste&from=${from}&to=${to}`} label="廃棄率" value={`${wasteRatePct.toFixed(1)}%`} tone={wasteRatePct > 3 ? 'warning' : 'default'} sub={yen(wasteAmount)} />
      </div>
      <p className="mt-2 text-xs text-gray-400">
        ※ テーブル稼働率＝期間内の各日について「注文のあったテーブル数÷店舗のテーブル数」を算出し、日数で平均した簡易指標です。再来店率は選択期間内の来店回数（2回以上）で判定した近似値です。
        {!includeTakeoutGuests && '　客数・客単価は店内飲食（テーブル会計・コース）のみで算出しています（設定 > 企業情報 > KPI設定）。'}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <LinkStatCard href={ordersHref} label="会計件数" value={`${transactionCount.toLocaleString('ja-JP')}件`} />
        <LinkStatCard href={reservationsHref} label="予約数" value={`${reservationCount.toLocaleString('ja-JP')}件`} />
        <LinkStatCard href={reservationsHref} label="ウォークイン数" value={`${walkInCount.toLocaleString('ja-JP')}件`} />
        <LinkStatCard href={ordersHref} label="値引き額合計" value={yen(discountTotal)} />
        <LinkStatCard href={ordersHref} label="粗利率（対純売上・理論原価）" value={`${salesTotal > 0 ? ((grossProfit / salesTotal) * 100).toFixed(1) : '0.0'}%`} tone="success" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>日別売上推移</CardTitle>
          </CardHeader>
          <CardContent>
            {salesTotal === 0 ? (
              <EmptyState title="この期間の売上データがありません" className="border-0 py-10" />
            ) : (
              <Link href={ordersHref} className="block">
                <DailySalesChart data={dailyChartData} />
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>支払方法別構成</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentChartData.length === 0 ? (
              <EmptyState title="支払データがありません" className="border-0 py-10" />
            ) : (
              <Link href={ordersHref} className="block">
                <PaymentMethodChart data={paymentChartData} />
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>時間帯別売上</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href={ordersHref} className="block">
              <HourlySalesChart data={hourlyChartData} />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>曜日別売上</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href={ordersHref} className="block">
              <WeekdaySalesChart data={weekdayChartData} />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>カテゴリ別売上 TOP8</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryChartData.length === 0 ? (
              <EmptyState title="商品データがありません" className="border-0 py-10" />
            ) : (
              <Link href="/app/costing?tab=items" className="block">
                <CategorySalesChart data={categoryChartData} />
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      {storeComparison.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>店舗別比較</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>店舗</Th>
                    <Th className="text-right">売上</Th>
                    <Th className="text-right">会計件数</Th>
                    <Th className="text-right">客数</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {storeComparison.map((s) => (
                    <Tr key={s.id}>
                      <Td className="font-medium text-navy">{s.name}</Td>
                      <Td className="text-right tabular-nums">{yen(s.sales)}</Td>
                      <Td className="text-right tabular-nums">{s.count}件</Td>
                      <Td className="text-right tabular-nums">{s.guests}名</Td>
                      <Td>
                        <Link href={`/app/reports?store=${s.id}&from=${from}&to=${to}`} className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
                          この店舗を見る
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>商品別売上 TOP20</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {productRows.length === 0 ? (
              <div className="p-5">
                <EmptyState title="商品データがありません" className="border-0 py-8" />
              </div>
            ) : (
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>商品名</Th>
                      <Th className="text-right">数量</Th>
                      <Th className="text-right">売上</Th>
                      <Th className="text-right">原価</Th>
                      <Th className="text-right">粗利</Th>
                      <Th />
                    </Tr>
                  </THead>
                  <TBody>
                    {productRows.map((p) => (
                      <Tr key={p.key}>
                        <Td className="font-medium text-navy">{p.name}</Td>
                        <Td className="text-right tabular-nums">{p.quantity}</Td>
                        <Td className="text-right tabular-nums">{yen(p.revenue)}</Td>
                        <Td className="text-right tabular-nums">{p.cost == null ? '—' : yen(p.cost)}</Td>
                        <Td className="text-right tabular-nums">{p.cost == null ? '—' : yen(p.revenue - p.cost)}</Td>
                        <Td>
                          <Link href={`/app/costing?tab=items&q=${encodeURIComponent(p.name)}`} className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
                            原価
                          </Link>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>スタッフ別売上</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {staffRows.length === 0 ? (
              <div className="p-5">
                <EmptyState title="スタッフ別データがありません" className="border-0 py-8" />
              </div>
            ) : (
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>スタッフ</Th>
                      <Th className="text-right">件数</Th>
                      <Th className="text-right">売上</Th>
                      <Th className="text-right">客単価</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {staffRows.map((s) => (
                      <Tr key={s.name}>
                        <Td className="font-medium text-navy">{s.name}</Td>
                        <Td className="text-right tabular-nums">{s.count}件</Td>
                        <Td className="text-right tabular-nums">{yen(s.sales)}</Td>
                        <Td className="text-right tabular-nums">{yen(s.avgSpend)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>予約経路別</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sourceRows.length === 0 ? (
              <div className="p-5">
                <EmptyState title="予約データがありません" className="border-0 py-8" />
              </div>
            ) : (
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <Tr>
                      <Th>経路</Th>
                      <Th className="text-right">件数</Th>
                      <Th className="text-right">来店完了率</Th>
                      <Th className="text-right">キャンセル率</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {sourceRows.map((s) => (
                      <Tr key={s.name}>
                        <Td>
                          <Link href={`${reservationsHref}${s.id ? `&source=${s.id}` : ''}`} className="font-medium text-primary hover:underline">
                            {s.name}
                          </Link>
                        </Td>
                        <Td className="text-right tabular-nums">{s.total}件</Td>
                        <Td className="text-right tabular-nums">{s.completionRate.toFixed(1)}%</Td>
                        <Td className="text-right tabular-nums">{s.cancelRate.toFixed(1)}%</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>日別売上明細</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>日付</Th>
                    <Th className="text-right">総売上</Th>
                    <Th className="text-right">返金</Th>
                    <Th className="text-right">純売上</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {[...dailyRows].reverse().map((r) => (
                    <Tr key={r.date}>
                      <Td>
                        {r.date.replaceAll('-', '/')}（{weekdayJa(r.date)}）
                      </Td>
                      <Td className="text-right tabular-nums">{yen(r.gross)}</Td>
                      <Td className="text-right tabular-nums">{r.refund > 0 ? <span className="text-danger">−{yen(r.refund)}</span> : yen(0)}</Td>
                      <Td className="text-right tabular-nums font-semibold text-navy">{yen(r.net)}</Td>
                      <Td>
                        <Link href={`/app/orders?from=${r.date}&to=${r.date}`} className="text-xs font-medium text-primary hover:underline">
                          明細を見る
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
