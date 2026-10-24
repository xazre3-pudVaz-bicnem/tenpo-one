import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { yen } from '@/lib/format';
import {
  CONSECUTIVE_DAYS_WARNING_THRESHOLD,
  LABOR_COST_RATIO_WARNING_THRESHOLD,
  WEEKLY_MINUTES_WARNING_THRESHOLD,
  loadShiftsWeek,
} from '@/lib/shifts-server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { WeekNav } from './week-nav';
import { ShiftGrid } from './shift-grid';
import { RequirementsPanel } from './requirements-panel';

export const metadata: Metadata = { title: 'シフト' };

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFeature('attendance');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="シフト" />
        <EmptyState title="所属店舗がありません" />
      </div>
    );
  }

  // 週の中身（シフト・人件費・不足・注意）は lib/shifts-server.ts（iPad のネイティブと同じ組み立て）
  const {
    canManage,
    todayWeekStart,
    weekStart,
    weekEnd,
    rangeLabel,
    weekDates,
    staff: allRows,
    shiftsByKey,
    orgStaffOptions,
    laborRows,
    totalCost,
    forecastRows,
    shortages,
    consecutiveWarnings,
    weeklyHourWarnings,
    outOfHoursWarnings,
    requirements,
  } = await loadShiftsWeek(ctx, supabase, store, sp.week);

  return (
    <div>
      <PageHeader title="シフト" description={`${store.name}の週間シフト表`} />

      <div className="mb-4">
        <WeekNav
          weekStart={weekStart}
          weekEnd={weekEnd}
          rangeLabel={rangeLabel}
          canManage={canManage}
          storeId={store.id}
          todayWeekStart={todayWeekStart}
        />
      </div>

      {shortages.length > 0 && (
        <Card className="mb-4 border-warning/30 bg-warning-soft">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">人員が不足している時間帯があります</p>
              <ul className="mt-1 space-y-0.5">
                {shortages.map((sh, i) => (
                  <li key={i}>
                    {sh.label} {sh.timeFrom}〜{sh.timeTo}：必要{sh.required}人に対し確定シフト{sh.actual}人
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {(consecutiveWarnings.length > 0 || weeklyHourWarnings.length > 0 || outOfHoursWarnings.length > 0) && (
        <Card className="mb-4 border-warning/30 bg-warning-soft">
          <CardContent className="space-y-3 p-4 text-sm text-warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-semibold">スタッフ配置の注意（保存を妨げるものではありません）</p>
            </div>
            {consecutiveWarnings.length > 0 && (
              <div>
                <p className="font-medium">
                  連勤（確定シフトが{CONSECUTIVE_DAYS_WARNING_THRESHOLD}日以上連続）
                </p>
                <ul className="mt-1 space-y-0.5">
                  {consecutiveWarnings.map((w) => (
                    <li key={w.profileId}>
                      {w.name}さん {w.streak}連勤
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {weeklyHourWarnings.length > 0 && (
              <div>
                <p className="font-medium">
                  週勤務時間超過（当週合計が{Math.floor(WEEKLY_MINUTES_WARNING_THRESHOLD / 60)}時間超）
                </p>
                <ul className="mt-1 space-y-0.5">
                  {weeklyHourWarnings.map((w) => (
                    <li key={w.profileId}>
                      {w.name}さん {Math.floor(w.minutes / 60)}時間{w.minutes % 60}分
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {outOfHoursWarnings.length > 0 && (
              <div>
                <p className="font-medium">営業時間外シフト</p>
                <ul className="mt-1 space-y-0.5">
                  {outOfHoursWarnings.map((w, i) => (
                    <li key={i}>
                      {w.name}さん {w.label} {w.startTime}〜{w.endTime}（{w.reason}）
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {allRows.length === 0 ? (
        <EmptyState title="この店舗にスタッフが割り当てられていません" description="スタッフ管理から店舗へ割当を行ってください" />
      ) : (
        <ShiftGrid
          storeId={store.id}
          weekDates={weekDates}
          staff={allRows}
          shiftsByKey={shiftsByKey}
          canManage={canManage}
          selfId={ctx.userId}
          orgStaffOptions={orgStaffOptions}
        />
      )}

      <Card className="mt-5">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>人件費シミュレーター（日別・予算比較）</CardTitle>
          <Link href="/app/budgets" className="text-xs font-medium text-primary hover:underline">
            予算は予算管理ページで設定できます
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrap className="border-0">
            <Table>
              <THead>
                <Tr>
                  <Th>日付</Th>
                  <Th>基準</Th>
                  <Th className="text-right">売上基準</Th>
                  <Th className="text-right">予定人件費</Th>
                  <Th className="text-right">人件費率</Th>
                  <Th className="text-right">予算人件費率</Th>
                  <Th className="text-right">差</Th>
                </Tr>
              </THead>
              <TBody>
                {forecastRows.map((r) => (
                  <Tr key={r.date}>
                    <Td className="font-medium text-navy">{r.label}</Td>
                    <Td>
                      <Badge tone={r.source === 'budget' ? 'primary' : 'gray'}>
                        {r.source === 'budget' ? '予算日割り' : '過去4週平均'}
                      </Badge>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {r.salesBasis != null ? yen(r.salesBasis) : <span className="text-xs text-gray-400">予測不可</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{yen(r.plannedLabor)}</Td>
                    <Td
                      className={cn(
                        'text-right tabular-nums font-medium',
                        r.ratio != null && r.ratio > LABOR_COST_RATIO_WARNING_THRESHOLD ? 'text-danger' : 'text-navy'
                      )}
                    >
                      {r.ratio != null ? `${r.ratio.toFixed(1)}%` : '—'}
                    </Td>
                    <Td className="text-right tabular-nums text-gray-500">
                      {r.targetRatio != null ? `${r.targetRatio.toFixed(1)}%` : '—'}
                    </Td>
                    <Td
                      className={cn(
                        'text-right tabular-nums font-medium',
                        r.diff != null && r.diff > 0 ? 'text-danger' : 'text-navy'
                      )}
                    >
                      {r.diff != null ? `${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)}pt` : '—'}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
            当月の予算（店舗別 → 全社の順で優先）が設定されている日は予算売上の日割り（月の予算売上 ÷ 日数）を基準に、未設定の日は過去4週間の同曜日の売上実績（日次締め）の平均で人件費率を計算します。人件費率が
            {LABOR_COST_RATIO_WARNING_THRESHOLD}%を超える日、予算人件費率との差がプラスの日は警告色で表示します。
          </p>
        </CardContent>
      </Card>

      {allRows.length > 0 && (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>人件費予測（当週・スタッフ別）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>スタッフ</Th>
                    <Th className="text-right">シフト時間</Th>
                    <Th className="text-right">予測人件費</Th>
                  </Tr>
                </THead>
                <TBody>
                  {laborRows.map((r) => (
                    <Tr key={r.name}>
                      <Td className="font-medium text-navy">
                        {r.name}
                        {r.isHelp && <span className="ml-1.5 text-xs text-primary">（ヘルプ）</span>}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {Math.floor(r.minutes / 60)}:{String(r.minutes % 60).padStart(2, '0')}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {r.cost != null ? yen(r.cost) : <span className="text-xs text-gray-400">時給未設定のため除外</span>}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <div className="border-t border-gray-100 px-5 py-3 text-right text-sm font-semibold text-navy">
              合計（判明分のみ）: {yen(totalCost)}
            </div>
          </CardContent>
        </Card>
      )}

      {canManage && <RequirementsPanel storeId={store.id} requirements={requirements} />}
    </div>
  );
}
