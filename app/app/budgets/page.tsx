import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, CalendarCheck, Target } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { yen } from '@/lib/format';
import { loadBudgetsData, SEAT_ONLY_UNIT_DAYS } from '@/lib/budgets-data-server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { BudgetForm, type BudgetFormData } from './budget-form';
import { MonthlyTargetForm } from './monthly-target-form';

export const metadata: Metadata = { title: '予算管理' };

function achievementTone(rate: number | null): BadgeTone {
  if (rate == null) return 'gray';
  if (rate >= 100) return 'success';
  if (rate >= 90) return 'warning';
  return 'danger';
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const ctx = await requirePermission('reports.view');
  const supabase = await createClient();

  const sp = await searchParams;
  // 読み込みと計算は lib/budgets-data-server.ts（iPad アプリのネイティブ画面と共用）
  const data = await loadBudgetsData(ctx, supabase, sp.month);
  if (!data) {
    return (
      <div>
        <PageHeader title="予算管理" />
        <p className="text-sm text-gray-500">アクセス可能な店舗がありません</p>
      </div>
    );
  }
  const {
    canEdit,
    monthFirst,
    monthLast,
    elapsedDays,
    daysInMonth,
    rows,
    targetRow,
    targetEditable,
    monthLabel,
    forecastFrom,
    forecast,
    singleUnit,
    landing,
    targetAmount,
    metricsOpts,
    rowEditable,
  } = data;

  return (
    <div>
      <PageHeader
        title="予算管理"
        description="月別・店舗別の予算設定と実績・着地予測の比較"
        actions={
          <Link
            href={`/app/budgets/daily?month=${monthFirst.slice(0, 7)}`}
            className="tap3d inline-flex items-center gap-1.5 rounded-xl bg-plum px-4 py-2 text-[13px] font-bold text-white"
          >
            <CalendarDays className="h-4 w-4" />
            日別予算登録
            <span className="text-[10px] font-semibold opacity-70">Daily</span>
          </Link>
        }
      />

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="month">対象月</Label>
          <Input id="month" name="month" type="month" defaultValue={monthFirst.slice(0, 7)} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">
          表示する
        </Button>
      </form>

      <p className="mb-3 text-xs text-gray-500">
        経過{elapsedDays}日／{daysInMonth}日（{monthFirst.slice(0, 7).replaceAll('-', '/')}）。着地予測 = 実績 ÷ 経過日数 × 月日数（lib/forecast.ts の線形予測）。
      </p>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {/* 今月の売上目標（金額を入れて保存） */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-navy">
                <Target className="h-4 w-4 text-iris" aria-hidden />
                {monthLabel}の売上目標
                <span className="text-[11px] font-semibold text-ink-3">Monthly sales target</span>
              </h2>
              <span className="text-xs text-ink-3">
                {targetRow.storeName}｜{monthFirst.slice(0, 7).replaceAll('-', '/')}
              </span>
            </div>
            {targetEditable ? (
              <MonthlyTargetForm
                key={`${targetRow.storeId ?? 'all'}-${monthFirst}`}
                storeId={targetRow.storeId}
                month={monthFirst}
                current={targetAmount}
              />
            ) : (
              <p className="text-2xl font-bold text-ink tabular-nums">{targetAmount != null ? yen(targetAmount) : '未設定'}</p>
            )}
            {/* 予算の説明はホームではなくここに（2026-09-30 Ronnie） */}
            {targetRow.storeId && (
              <p className="text-xs leading-relaxed text-ink-3">
                保存すると、直近8週の曜日ごとの売上に合わせて日別予算を自動で作ります（よく売れる曜日ほど多め）。
                ホームの「予算売上高」はその日の分です。1日ずつ直すときは「日別予算」から。
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-lilac-soft px-3 py-2">
                <dt className="text-[11px] text-ink-3">実績（純売上）<span className="ml-1">Sales</span></dt>
                <dd className="text-lg font-bold text-saffron tabular-nums">{yen(targetRow.actual.sales)}</dd>
              </div>
              <div className="rounded-xl bg-lilac-soft px-3 py-2">
                <dt className="text-[11px] text-ink-3">達成率<span className="ml-1">Achievement</span></dt>
                <dd className="text-lg font-bold text-royal tabular-nums">
                  {targetRow.achievementPct != null ? `${targetRow.achievementPct.toFixed(1)}%` : '—'}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* ご予約から見込む売上（自動計算） */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-navy">
                <CalendarCheck className="h-4 w-4 text-iris" aria-hidden />
                ご予約から見込む売上
                <span className="text-[11px] font-semibold text-ink-3">Booking forecast</span>
              </h2>
              <Badge tone="navy">自動計算</Badge>
            </div>
            {forecast ? (
              <>
                <p className="text-xs text-ink-3">
                  {forecastFrom.slice(5).replace('-', '/')}〜{monthLast.slice(5).replace('-', '/')} に入っているご予約（キャンセル・来店済みを除く）
                </p>
                <dl className="divide-y divide-line rounded-xl border border-line text-sm">
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt>
                      コースのご予約
                      <span className="ml-1.5 text-xs text-ink-3 tabular-nums">
                        {forecast.course.count}件・{forecast.course.guests}名
                      </span>
                      <span className="block text-[11px] text-ink-3">コースの金額 × 人数</span>
                    </dt>
                    <dd className="font-bold tabular-nums">{yen(forecast.course.amount)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt>
                      席のみのご予約
                      <span className="ml-1.5 text-xs text-ink-3 tabular-nums">
                        {forecast.seatOnly.count}件・{forecast.seatOnly.guests}名
                      </span>
                      <span className="block text-[11px] text-ink-3">
                        {singleUnit
                          ? singleUnit.basis === 'seat_only'
                            ? `席のみ客単価 ${yen(singleUnit.unit)} × 人数（直近${SEAT_ONLY_UNIT_DAYS}日の席のみ ${singleUnit.samples}組の平均）`
                            : singleUnit.basis === 'store'
                              ? `客単価 ${yen(singleUnit.unit)} × 人数（直近${SEAT_ONLY_UNIT_DAYS}日に席のみが無いため店全体の平均）`
                              : `直近${SEAT_ONLY_UNIT_DAYS}日の会計が無いため計算できません`
                          : `店舗ごとの席のみ客単価（直近${SEAT_ONLY_UNIT_DAYS}日の平均）× 人数`}
                      </span>
                    </dt>
                    <dd className="font-bold tabular-nums">{yen(forecast.seatOnly.amount)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 bg-iris-soft/60 px-3 py-2">
                    <dt className="font-bold text-navy">予約見込み 合計</dt>
                    <dd className="text-lg font-extrabold text-royal tabular-nums">{yen(forecast.total)}</dd>
                  </div>
                </dl>
                {landing != null && (
                  <p className="text-sm text-ink-2">
                    実績 {yen(targetRow.actual.sales)} ＋ 予約見込み {yen(forecast.total)} ＝{' '}
                    <b className="text-navy tabular-nums">{yen(landing)}</b>
                    {targetAmount != null && targetAmount > 0 && (
                      <Badge className="ml-1.5" tone={achievementTone((landing / targetAmount) * 100)}>
                        目標の {((landing / targetAmount) * 100).toFixed(0)}%
                      </Badge>
                    )}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-3">過去の月のため、これからのご予約はありません</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>店舗</Th>
                  <Th className="text-right">売上予算</Th>
                  <Th className="text-right">売上実績（純）</Th>
                  <Th className="text-right">達成率</Th>
                  <Th className="text-right">着地予測</Th>
                  <Th className="text-right">原価率(目標/実績)</Th>
                  <Th className="text-right">人件費率(目標/実績)</Th>
                  <Th className="text-right">利益(目標/実績)</Th>
                  <Th className="text-right">客数(目標/実績)</Th>
                  <Th className="text-right">客単価(目標/実績)</Th>
                  {canEdit && <Th />}
                </Tr>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const editable = rowEditable(r.storeId);
                  const formData: BudgetFormData = {
                    storeId: r.storeId,
                    storeName: r.storeName,
                    month: monthFirst,
                    salesBudget: r.budget?.sales_budget ?? 0,
                    costRateTarget: r.budget?.cost_rate_target ?? null,
                    laborRateTarget: r.budget?.labor_rate_target ?? null,
                    profitTarget: r.budget?.profit_target ?? null,
                    guestsTarget: r.budget?.guests_target ?? null,
                    avgSpendTarget: r.budget?.avg_spend_target ?? null,
                    note: r.budget?.note ?? null,
                  };
                  return (
                    <Tr key={r.storeId ?? '__all__'}>
                      <Td className="font-medium text-navy">
                        {r.storeName}
                        {r.storeId === null && <Badge className="ml-2" tone="navy">全社</Badge>}
                      </Td>
                      <Td className="text-right tabular-nums">{r.budget ? yen(r.budget.sales_budget) : '—'}</Td>
                      <Td className="text-right tabular-nums font-semibold text-navy">{yen(r.actual.sales)}</Td>
                      <Td className="text-right tabular-nums">
                        {r.achievementPct == null ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <Badge tone={achievementTone(r.achievementPct)}>{r.achievementPct.toFixed(1)}%</Badge>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {r.forecast == null ? (
                          '—'
                        ) : (
                          <span>
                            {yen(r.forecast)}
                            {r.forecastPct != null && (
                              <Badge className="ml-1.5" tone={achievementTone(r.forecastPct)}>
                                {r.forecastPct.toFixed(0)}%
                              </Badge>
                            )}
                          </span>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.cost_rate_target != null ? `${r.budget.cost_rate_target}%` : '—'} / {r.actual.costRate.toFixed(1)}%
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.labor_rate_target != null ? `${r.budget.labor_rate_target}%` : '—'} / {r.actual.laborRate.toFixed(1)}%
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.profit_target != null ? yen(r.budget.profit_target) : '—'} / {yen(r.actual.profit)}
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.guests_target ?? '—'} / {r.actual.guests}
                      </Td>
                      <Td className="text-right tabular-nums text-xs">
                        {r.budget?.avg_spend_target != null ? yen(r.budget.avg_spend_target) : '—'} / {yen(r.actual.avgSpend)}
                      </Td>
                      {canEdit && <Td>{editable ? <BudgetForm data={formData} /> : <span className="text-xs text-gray-300">—</span>}</Td>}
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>
      <p className="mt-2 text-xs text-gray-400">
        ※ 売上実績は純売上（会計成立注文の合計 − 期間内の返金額）。原価・人件費は「レポート」画面と同じ概算ロジック（原価はレシピ原価優先、人件費は時給ルール×実働時間の概算）。全社行は本社管理者（org_owner/hq_admin）のみ編集できます。
        {metricsOpts.includeTakeoutGuests === false && '　客数は店内飲食（テーブル会計・コース）のみで算出しています（設定 > 企業情報 > KPI設定）。'}
      </p>
    </div>
  );
}
