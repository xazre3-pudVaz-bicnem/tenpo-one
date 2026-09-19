import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { computeSalesMetrics, SETTLED_ORDER_STATUSES, type SalesMetricsOptions } from '@/lib/metrics';
import { yen, formatTime, todayJst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { RegisterClosedCard } from '@/components/cash/register-closed-card';
import { RegisterOpenCard } from '@/components/cash/register-open-card';
import { StoreDayClosePanel } from '@/components/cash/store-day-close-panel';
import { TodayClosingSummary } from '@/components/cash/today-closing-summary';
import { RegisterCountCard } from '@/components/cash/register-count-card';
import { ReceiptCell, splitPurpose } from '@/components/cash/cash-history';
import { METHOD_LABELS } from '@/components/cash/labels';
import { loadRegisterBoard, loadTodayCashRows, receiptStateOf, STORE_DAY_CLOSE_ROLES } from './data';

export const metadata: Metadata = { title: 'レジクローズ' };

/** 支払方法別の表で常に表示する方法（プロトタイプ: 現金・クレジット・QR・電子マネー） */
const BASE_METHODS = ['cash', 'credit', 'qr', 'emoney'];

export default async function CashClosePage() {
  const ctx = await requireFeature('accounting');
  const store = ctx.currentStore ?? ctx.stores[0] ?? null;

  if (!store) {
    return (
      <div>
        <PageHeader title="レジクローズ" en="Close register" />
        <EmptyState title="所属店舗がありません" description="レジ操作には店舗への割当が必要です。管理者に確認してください。" />
      </div>
    );
  }

  const supabase = await createClient();
  const today = todayJst();
  const canOperate = can(ctx.role, 'register.operate');
  const canScan = can(ctx.role, 'documents.write') && can(ctx.role, 'cash.write');
  const canSettle = can(ctx.role, 'cash.write');

  const [board, cashRows, { data: settledOrders }, { data: refunds }, { data: openOrders }, { data: payments }, { data: orgKpiRow }] =
    await Promise.all([
      loadRegisterBoard(store.id, today),
      loadTodayCashRows(store.id, today),
      supabase
        .from('orders')
        .select('total, discount_total, guest_count, status, order_type')
        .eq('store_id', store.id)
        .eq('business_date', today)
        .in('status', [...SETTLED_ORDER_STATUSES])
        .limit(5000),
      supabase.from('refunds').select('amount, kind').eq('store_id', store.id).eq('business_date', today).limit(5000),
      supabase
        .from('orders')
        .select('id, total')
        .eq('store_id', store.id)
        .eq('business_date', today)
        .eq('status', 'open')
        .limit(1000),
      supabase
        .from('payments')
        .select('method, amount')
        .eq('store_id', store.id)
        .eq('business_date', today)
        .eq('status', 'completed')
        .limit(10000),
      supabase.from('organizations').select('kpi_settings').eq('id', ctx.organizationId).maybeSingle(),
    ]);

  const metricsOpts: SalesMetricsOptions = {
    includeTakeoutGuests: (orgKpiRow?.kpi_settings as { includeTakeoutGuests?: boolean } | null)?.includeTakeoutGuests ?? true,
  };
  const metrics = computeSalesMetrics(settledOrders ?? [], refunds ?? [], metricsOpts);
  const openCount = (openOrders ?? []).length;
  const openTotal = (openOrders ?? []).reduce((a, o) => a + o.total, 0);

  // 支払方法別
  const byMethod = new Map<string, { count: number; amount: number }>();
  for (const m of BASE_METHODS) byMethod.set(m, { count: 0, amount: 0 });
  for (const p of payments ?? []) {
    const cur = byMethod.get(p.method) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += p.amount;
    byMethod.set(p.method, cur);
  }

  // 出金レシートチェック（古い順）
  const receiptRows = cashRows
    .filter((r) => receiptStateOf(r) !== 'none')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const okRows = receiptRows.filter((r) => receiptStateOf(r) === 'ok');
  const ngRows = receiptRows.filter((r) => receiptStateOf(r) !== 'ok');
  const ngTotal = ngRows.reduce((a, r) => a + r.amount, 0);

  const { openSessions, cards, todayClosing } = board;
  const closedCards = cards.filter((c) => c.type === 'closed');
  const unopenedCards = cards.filter((c) => c.type === 'unopened');

  return (
    <div>
      <PageHeader
        title="レジクローズ"
        en="Close register"
        description="本日の締め処理。現金を実査して差額を確認してからクローズします"
        actions={
          <Link href="/app/cash" className={cn(buttonVariants({ variant: 'secondary' }))}>
            <ArrowLeft className="h-4 w-4" />
            入出金
          </Link>
        }
      />

      <div className="space-y-4">
        {/* 本日の売上 */}
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>本日の売上（会計済）</CardTitle>
            {openCount > 0 ? (
              <Link href="/app/orders?status=open" className="text-[13px] text-ink-3 hover:text-royal hover:underline">
                未会計 <span className="tabular-nums">{openCount}</span>卓 <span className="tabular-nums">{yen(openTotal)}</span>
                （クローズ前に会計してください）
              </Link>
            ) : (
              <span className="text-[13px] text-ink-3">未会計はありません</span>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kv label="売上合計（税込）" value={yen(metrics.grossSales)} sub={metrics.refunds > 0 ? `返金 −${yen(metrics.refunds)} ／ 純売上 ${yen(metrics.netSales)}` : undefined} />
              <Kv label="会計件数" value={`${metrics.transactionCount}件`} />
              <Kv label="客数" value={`${metrics.guests}名`} />
              <Kv label="客単価" value={yen(metrics.avgSpend)} />
            </div>
          </CardContent>
        </Card>

        {/* 本日の出金レシート */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle en="Receipt check">本日の出金レシート</CardTitle>
            <span className="text-[13px] text-ink-3">
              出金 <span className="tabular-nums">{receiptRows.length}</span>件 ・ レシートあり{' '}
              <span className="tabular-nums">{okRows.length}</span> ・{' '}
              <b className={ngRows.length > 0 ? 'text-ink-2' : 'text-success'}>
                レシート未添付／未精算 <span className="tabular-nums">{ngRows.length}</span>件
                {ngRows.length > 0 && <span className="tabular-nums">（{yen(ngTotal)}）</span>}
              </b>
            </span>
          </CardHeader>
          {receiptRows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3">本日の出金（経費）はありません</p>
          ) : (
            <ul>
              {receiptRows.map((r) => {
                const state = receiptStateOf(r);
                const { main, sub } = splitPurpose(r.purpose, r.kind);
                return (
                  <li
                    key={r.id}
                    className={cn(
                      'grid grid-cols-[52px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-b border-line px-4 py-2.5 text-[13px] sm:px-5',
                      state !== 'ok' && 'bg-danger-soft'
                    )}
                  >
                    <time className="text-xs font-bold text-ink-3 tabular-nums">{formatTime(r.occurredAt)}</time>
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{main}</span>
                      <small className="block truncate text-[11px] text-ink-3">
                        {sub ?? r.registerName ?? '小口現金'}
                        {r.approvalStatus === 'pending' && <span className="ml-1 font-bold text-saffron">承認待ち</span>}
                      </small>
                    </span>
                    <b className="text-ink tabular-nums">{yen(r.amount)}</b>
                    <ReceiptCell row={r} canScan={canScan} canSettle={canSettle} compact />
                  </li>
                );
              })}
            </ul>
          )}
          <p className="flex items-start gap-1.5 px-5 py-2.5 text-xs text-ink-2">
            {ngRows.length > 0 ? (
              <>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                レシートのない出金・未精算の仮払いは現金差額の原因になります。クローズ前にレシートを撮るか、仮払いを精算してください
                {canScan && (
                  <Link href="/app/scan" className="ml-1 shrink-0 font-bold text-royal hover:underline">
                    スキャンへ
                  </Link>
                )}
              </>
            ) : (
              <>
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                {receiptRows.length > 0 ? 'すべての出金にレシートがあります。' : '確認が必要な出金はありません。'}
              </>
            )}
          </p>
        </Card>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* 支払方法別 */}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle en="By method">支払方法別</CardTitle>
            </CardHeader>
            <table className="w-full text-sm">
              <tbody>
                {[...byMethod.entries()].map(([method, v]) => (
                  <tr key={method} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3 text-ink sm:px-5">{METHOD_LABELS[method] ?? method}</td>
                    <td className="px-4 py-3 text-[12.5px] text-ink-3 tabular-nums">{v.count}件</td>
                    <td className="px-4 py-3 text-right font-bold text-ink tabular-nums sm:px-5">{yen(v.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-lilac-soft">
                  <td className="px-4 py-3 font-bold text-ink sm:px-5">合計</td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-3 tabular-nums">{(payments ?? []).length}件</td>
                  <td className="px-4 py-3 text-right font-extrabold text-saffron tabular-nums sm:px-5">
                    {yen((payments ?? []).reduce((a, p) => a + p.amount, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>

          {/* 現金実査 */}
          <div className="space-y-4">
            {openSessions.map((s) => (
              <RegisterCountCard
                key={s.id}
                session={s}
                showRegisterName={openSessions.length > 1 || cards.length > 1}
                canOperate={canOperate}
                today={today}
              />
            ))}
            {openSessions.length === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle en="Cash count">現金実査</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-ink-2">
                    {cards.length === 0
                      ? 'レジが登録されていません。設定からレジを登録してください。'
                      : closedCards.length > 0
                        ? '開局中のレジはありません（本日のレジはクローズ済みです）。下の「店舗日次締め」で営業日を締めてください。'
                        : '開局中のレジはありません。開局すると現金実査とクローズができます。'}
                  </p>
                  {canOperate &&
                    unopenedCards.map((c) =>
                      c.type === 'unopened' ? (
                        <RegisterOpenCard key={c.registerId} storeId={store.id} registerId={c.registerId} registerName={c.registerName} />
                      ) : null
                    )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {closedCards.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {closedCards.map((c) =>
              c.type === 'closed' ? <RegisterClosedCard key={c.session.id} storeDayClosed={!!todayClosing} session={c.session} /> : null
            )}
          </div>
        )}

        <StoreDayClosePanel
          storeId={store.id}
          businessDate={today}
          items={board.preCloseItems}
          alreadyClosed={!!todayClosing}
          canClose={STORE_DAY_CLOSE_ROLES.includes(ctx.role ?? '')}
        />

        {todayClosing && <TodayClosingSummary closing={todayClosing} registerBreakdown={board.registerBreakdown} />}
      </div>
    </div>
  );
}

function Kv({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-lilac-soft px-3.5 py-3">
      <span className="text-xs text-ink-3">{label}</span>
      <b className="text-[22px] leading-tight font-extrabold text-ink tabular-nums">{value}</b>
      {sub && <span className="text-[11px] text-ink-3 tabular-nums">{sub}</span>}
    </div>
  );
}
