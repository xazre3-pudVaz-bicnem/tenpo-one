import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, MinusCircle } from 'lucide-react';
import { requirePermission, requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { yen, todayJst, daysAgoJst, formatDate } from '@/lib/format';
import { RECON_STATUS_LABEL, reconciliationScope, type ReconStatus } from '@/lib/reconciliation';
import { loadReconciliationData } from '@/lib/reconciliation-server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: '売上・現金・在庫の照合' };

const STATUS_LABEL = RECON_STATUS_LABEL;
const STATUS_TONE: Record<ReconStatus, BadgeTone> = { ok: 'success', mismatch: 'danger', no_data: 'gray' };

function StatusIcon({ status }: { status: ReconStatus }) {
  if (status === 'ok') return <CheckCircle2 className="h-5 w-5 text-success" />;
  if (status === 'mismatch') return <AlertTriangle className="h-5 w-5 text-danger" />;
  return <MinusCircle className="h-5 w-5 text-gray-400" />;
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; store?: string }>;
}) {
  await requirePermission('csv.export');
  const ctx = await requireFeature('accounting');
  const sp = await searchParams;
  const supabase = await createClient();

  // 期間・店舗と中身の読み込みは lib/reconciliation.ts・lib/reconciliation-server.ts（iPad ネイティブと同じ。2026-10-24）
  const { from, to, storeId, storeName, storeIds } = reconciliationScope(ctx, sp, todayJst(), daysAgoJst(6));

  if (storeIds.length === 0) {
    return (
      <div>
        <PageHeader title="照合（売上・現金・在庫）" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗の割り当てを依頼してください" />
      </div>
    );
  }

  const {
    posNetSales,
    paymentsNet,
    journalNetSales,
    diffPayments,
    diffJournal,
    unconfirmedDayCount,
    salesStatus,
    cashRows,
    cashDiffDays,
    expectedCashTotal,
    countedCashTotal,
    cashDifferenceTotal,
    cashStatus,
    hasStockCounts,
    inventoryDiffRows,
    inventoryDiffAmountTotal,
    inventoryStatus,
    overallStatus,
  } = await loadReconciliationData(supabase, ctx, { from, to, storeId, storeName, storeIds });

  const periodQuery = new URLSearchParams({ from, to });
  if (storeId) periodQuery.set('store', storeId);

  return (
    <div>
      <PageHeader
        title="照合（売上・現金・在庫）"
        description={`${storeName ?? '全社（全店舗）'}｜${from.replaceAll('-', '/')}〜${to.replaceAll('-', '/')}`}
      />

      <Card className="mb-5 p-4">
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
              照合する
            </Button>
          </div>
        </form>
      </Card>

      {/* ---- サマリー ---- */}
      <Card
        className={cn(
          'mb-5 p-4',
          overallStatus === 'ok' && 'border-success/30 bg-success-soft/30',
          overallStatus === 'mismatch' && 'border-danger/30 bg-danger-soft/30'
        )}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <StatusIcon status={overallStatus} />
            <p className="text-sm font-bold text-navy">
              {overallStatus === 'ok' ? '売上・現金・在庫はすべて一致しています' : overallStatus === 'mismatch' ? '不一致があります。内容を確認してください' : 'データが不足しています'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS_TONE[salesStatus]}>売上照合: {STATUS_LABEL[salesStatus]}</Badge>
            <Badge tone={STATUS_TONE[cashStatus]}>現金照合: {STATUS_LABEL[cashStatus]}</Badge>
            <Badge tone={STATUS_TONE[inventoryStatus]}>在庫照合: {STATUS_LABEL[inventoryStatus]}</Badge>
          </div>
        </div>
      </Card>

      {/* ---- 1) 売上照合 ---- */}
      <Card className="mb-5">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>売上照合（POS純売上 / 決済合計 / 仕訳売上）</CardTitle>
          <Badge tone={STATUS_TONE[salesStatus]}>{STATUS_LABEL[salesStatus]}</Badge>
        </CardHeader>
        <CardContent>
          <TableWrap>
            <Table>
              <THead>
                <Tr>
                  <Th>指標</Th>
                  <Th className="text-right">金額</Th>
                  <Th className="text-right">POS純売上との差額</Th>
                  <Th>定義</Th>
                </Tr>
              </THead>
              <TBody>
                <Tr>
                  <Td className="font-medium text-navy">
                    <Link href={`/app/orders?from=${from}&to=${to}`} className="hover:text-primary-deep hover:underline">
                      (a) POS純売上
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">{yen(posNetSales)}</Td>
                  <Td className="text-right tabular-nums text-gray-400">—</Td>
                  <Td className="text-xs text-gray-500">会計成立注文（paid+refunded）total合計 − 返金</Td>
                </Tr>
                <Tr>
                  <Td className="font-medium text-navy">
                    <Link href={`/app/cash?tab=today`} className="hover:text-primary-deep hover:underline">
                      (b) 決済合計
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums">{yen(paymentsNet)}</Td>
                  <Td className={cn('text-right tabular-nums font-medium', diffPayments !== 0 && 'text-danger')}>
                    {diffPayments === 0 ? '±0' : `${diffPayments > 0 ? '+' : ''}${yen(diffPayments)}`}
                  </Td>
                  <Td className="text-xs text-gray-500">payments（completed）合計 − 返金</Td>
                </Tr>
                <Tr>
                  <Td className="font-medium text-navy">
                    <Link href="/app/accounting/auto" className="hover:text-primary-deep hover:underline">
                      (c) 仕訳売上
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums">{yen(journalNetSales)}</Td>
                  <Td className={cn('text-right tabular-nums font-medium', diffJournal !== 0 && 'text-danger')}>
                    {diffJournal === 0 ? '±0' : `${diffJournal > 0 ? '+' : ''}${yen(diffJournal)}`}
                  </Td>
                  <Td className="text-xs text-gray-500">確定済み仕訳（pos_sales/pos_refund）の売上高（400/401）net</Td>
                </Tr>
              </TBody>
            </Table>
          </TableWrap>

          {unconfirmedDayCount > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
              <span>自動仕訳が未確定の日が{unconfirmedDayCount}日あります（仕訳売上に反映されていません）</span>
              <Link href="/app/accounting/auto" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
                自動仕訳ページへ
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- 2) 現金照合 ---- */}
      <Card className="mb-5">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>現金照合（理論現金 / 実現金 / 差異）</CardTitle>
          <Badge tone={STATUS_TONE[cashStatus]}>{STATUS_LABEL[cashStatus]}</Badge>
        </CardHeader>
        <CardContent>
          {cashRows.length === 0 ? (
            <EmptyState title="締め記録がありません" description="この期間にレジ締め（daily_closings）の記録がありません" className="border-0 py-10" />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <p className="text-xs font-medium text-gray-500">理論現金合計</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-navy">{yen(expectedCashTotal)}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <p className="text-xs font-medium text-gray-500">実現金合計</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-navy">{yen(countedCashTotal)}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <p className="text-xs font-medium text-gray-500">差異合計</p>
                  <p className={cn('mt-1 text-xl font-bold tabular-nums', cashDifferenceTotal !== 0 ? 'text-danger' : 'text-navy')}>
                    {cashDifferenceTotal > 0 ? '+' : ''}
                    {yen(cashDifferenceTotal)}
                  </p>
                </div>
              </div>

              {cashDiffDays.length === 0 ? (
                <p className="mt-3 text-xs text-gray-400">この期間に現金差異のある日はありません。</p>
              ) : (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-gray-500">差異のある日（{cashDiffDays.length}日）</p>
                  <TableWrap>
                    <Table>
                      <THead>
                        <Tr>
                          <Th>営業日</Th>
                          <Th>店舗</Th>
                          <Th className="text-right">理論現金</Th>
                          <Th className="text-right">実現金</Th>
                          <Th className="text-right">差異</Th>
                          <Th />
                        </Tr>
                      </THead>
                      <TBody>
                        {cashDiffDays.map((r) => (
                          <Tr key={r.id}>
                            <Td>{formatDate(r.businessDate)}</Td>
                            <Td>{r.storeName}</Td>
                            <Td className="text-right tabular-nums">{yen(r.expectedCash)}</Td>
                            <Td className="text-right tabular-nums">{yen(r.countedCash)}</Td>
                            <Td className={cn('text-right tabular-nums font-semibold', r.cashDifference !== 0 && 'text-danger')}>
                              {r.cashDifference > 0 ? '+' : ''}
                              {yen(r.cashDifference)}
                            </Td>
                            <Td>
                              <Link
                                href={`/app/cash?tab=closings&from=${r.businessDate}&to=${r.businessDate}`}
                                className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
                              >
                                締め履歴を見る
                              </Link>
                            </Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrap>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-400">
                理論現金・実現金は締め時点のスナップショット（daily_closings）です。締めが未実行の日は集計に含まれません。
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- 3) 在庫照合 ---- */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>在庫照合（直近の棚卸差異）</CardTitle>
          <Badge tone={STATUS_TONE[inventoryStatus]}>{STATUS_LABEL[inventoryStatus]}</Badge>
        </CardHeader>
        <CardContent>
          {!hasStockCounts ? (
            <EmptyState
              title="棚卸データがありません"
              description="対象店舗で確定済みの棚卸がありません。「在庫」から棚卸を実施してください"
              className="border-0 py-10"
              action={
                <Link href="/app/inventory?tab=counts" className={cn(buttonVariants({ variant: 'secondary' }))}>
                  在庫（棚卸）へ
                </Link>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <p className="text-xs font-medium text-gray-500">差異品目数</p>
                  <p className={cn('mt-1 text-xl font-bold tabular-nums', inventoryDiffRows.length > 0 ? 'text-danger' : 'text-navy')}>
                    {inventoryDiffRows.length}件
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <p className="text-xs font-medium text-gray-500">差異金額合計（実数不足を正）</p>
                  <p className={cn('mt-1 text-xl font-bold tabular-nums', inventoryDiffAmountTotal !== 0 ? 'text-danger' : 'text-navy')}>
                    {inventoryDiffAmountTotal > 0 ? '+' : ''}
                    {yen(inventoryDiffAmountTotal)}
                  </p>
                </div>
              </div>

              {inventoryDiffRows.length > 0 && (
                <div className="mt-4">
                  <TableWrap>
                    <Table>
                      <THead>
                        <Tr>
                          <Th>品目</Th>
                          <Th className="text-right">差異数量</Th>
                          <Th className="text-right">単価</Th>
                          <Th className="text-right">差異金額</Th>
                        </Tr>
                      </THead>
                      <TBody>
                        {inventoryDiffRows.map((r) => (
                          <Tr key={r.id}>
                            <Td className="font-medium text-navy">{r.name}</Td>
                            <Td className={cn('text-right tabular-nums', r.diffQty < 0 ? 'text-danger' : 'text-success')}>
                              {r.diffQty > 0 ? '+' : ''}
                              {r.diffQty}
                              {r.unit}
                            </Td>
                            <Td className="text-right tabular-nums">{yen(r.unitCost)}</Td>
                            <Td className={cn('text-right tabular-nums font-semibold', (r.diffAmount ?? 0) !== 0 && 'text-danger')}>
                              {r.diffAmount == null ? '単価未設定' : `${r.diffAmount > 0 ? '+' : ''}${yen(r.diffAmount)}`}
                            </Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrap>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-400">
                各店舗の最新の確定済み棚卸を対象にしています（この照合ページの期間指定とは独立です）。差異金額は品目の現在平均単価で評価した参考値です。
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
