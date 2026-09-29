import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { computeSalesMetrics, SETTLED_ORDER_STATUSES, type SalesMetricsOptions } from '@/lib/metrics';
import { yen, formatTime } from '@/lib/format';
import { loadExpectedOpening, loadStoreDay } from '@/lib/register-day-server';
import { mdLabel, registerDayFlowActive } from '@/lib/register-day';
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
import { METHOD_LABELS, METHOD_LABELS_EN } from '@/components/cash/labels';
import { loadRegisterBoard, loadTodayCashRows, receiptStateOf, STORE_DAY_CLOSE_ROLES } from './data';
import { loadCloseBreakdown, type BreakdownPeriod } from './breakdown-data';
import { CloseBreakdownCard } from '@/components/cash/close-breakdown';
import { RegisterReportPreview } from '@/components/cash/register-report-preview';
import { CalendarDays, CalendarRange } from 'lucide-react';

export const metadata: Metadata = { title: 'レジクローズ' };

/** 支払方法別の表で常に表示する方法（プロトタイプ: 現金・クレジット・QR・電子マネー） */
const BASE_METHODS = ['cash', 'credit', 'qr', 'emoney'];

export default async function CashClosePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string; logout?: string }>;
}) {
  const ctx = await requireFeature('accounting');
  const sp = await searchParams;
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
  // 「今日」＝いまの営業日。レジ精算をするまでは日付をまたいでも前の営業日のまま（2026-09-28 Ronnie）
  const [storeDay, lastClose] = await Promise.all([loadStoreDay(supabase, store.id), loadExpectedOpening(supabase, store.id)]);
  const today = storeDay.businessDate;
  // 売上の内訳の期間（日次／月次。2026-09-27 Ronnie）
  const period: BreakdownPeriod = sp.period === 'month' ? 'month' : 'day';
  const bdDate =
    period === 'day'
      ? (sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today)
      : (sp.date && /^\d{4}-\d{2}$/.test(sp.date) ? sp.date : today.slice(0, 7));
  const canOperate = can(ctx.role, 'register.operate');
  const canScan = can(ctx.role, 'documents.write') && can(ctx.role, 'cash.write');
  const canSettle = can(ctx.role, 'cash.write');
  /** レジ端末（<店舗名>（レジ）アカウントの iPad）。締めに要るものだけを1画面に出す */
  const isRegi = ctx.isRegisterDevice === true;

  const [board, cashRows, { data: settledOrders }, { data: refunds }, { data: openOrders }, { data: payments }, { data: orgKpiRow }, breakdown] =
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
      // 売上の内訳は管理画面だけ（レジの iPad では読まない）
      isRegi ? null : loadCloseBreakdown(store.id, period, bdDate),
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

  // 現金実査（開局していなければ開局のカード）
  const countSection = (
    <div className="space-y-3">
      {openSessions.map((s) => (
        <RegisterCountCard
          key={s.id}
          session={s}
          showRegisterName={openSessions.length > 1 || cards.length > 1}
          canOperate={canOperate}
          today={today}
          openSlipCount={openCount}
          nextFloatTarget={storeDay.nextFloatSetting ?? s.openingFloat}
          denominationColumns={isRegi ? 2 : 1}
        />
      ))}
      {openSessions.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle en="Cash count">現金実査</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 sm:p-4">
            <p className="text-sm text-ink-2">
              {cards.length === 0
                ? 'レジが登録されていません。設定からレジを登録してください。'
                : closedCards.length > 0
                  ? '開局中のレジはありません（レジ精算ずみ）。レジ精算がすむと営業日完了になります。'
                  : '開局中のレジはありません。開局すると現金実査とクローズができます。'}
            </p>
            {canOperate &&
              unopenedCards.map((c) =>
                c.type === 'unopened' ? (
                  <RegisterOpenCard
                    key={c.registerId}
                    storeId={store.id}
                    registerId={c.registerId}
                    registerName={c.registerName}
                    expectedOpening={registerDayFlowActive(storeDay.clock) ? lastClose.expected : null}
                    expectedFrom={lastClose.businessDate}
                  />
                ) : null
              )}
          </CardContent>
        </Card>
      )}
    </div>
  );

  // 支払方法別
  const methodCard = (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle en="By method">支払方法別</CardTitle>
      </CardHeader>
      <table className="w-full text-sm">
        <tbody>
          {[...byMethod.entries()].map(([method, v]) => (
            <tr key={method} className="border-b border-line last:border-b-0">
              <td className="px-4 py-2 text-ink sm:px-5">
                {METHOD_LABELS[method] ?? method}
                <span className="ml-1 text-[11px] text-ink-3">{METHOD_LABELS_EN[method] ?? ''}</span>
              </td>
              <td className="px-4 py-2 text-[12.5px] text-ink-3 tabular-nums">{v.count}件</td>
              <td className="px-4 py-2 text-right font-bold text-ink tabular-nums sm:px-5">{yen(v.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-lilac-soft">
            <td className="px-4 py-2 font-bold text-ink sm:px-5">合計</td>
            <td className="px-4 py-2 text-[12.5px] text-ink-3 tabular-nums">{(payments ?? []).length}件</td>
            <td className="px-4 py-2 text-right font-extrabold text-saffron tabular-nums sm:px-5">
              {yen((payments ?? []).reduce((a, p) => a + p.amount, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );

  // 締めたレジ（再印刷など）
  const closedSection =
    closedCards.length > 0 ? (
      <div className="grid gap-3 lg:grid-cols-2">
        {closedCards.map((c) =>
          c.type === 'closed' ? (
            <RegisterClosedCard key={c.session.id} storeDayClosed={!!todayClosing} session={c.session} canOperate={canOperate} />
          ) : null
        )}
      </div>
    ) : null;

  // 本日の売上
  const salesCard = (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{storeDay.continuing ? `${mdLabel(today)} の営業日の売上（会計済）` : '本日の売上（会計済）'}</CardTitle>
        {openCount > 0 ? (
          <Link href="/app/orders?status=open" className="text-[13px] text-ink-3 hover:text-royal hover:underline">
            未会計 <span className="tabular-nums">{openCount}</span>卓 <span className="tabular-nums">{yen(openTotal)}</span>
            （クローズ前に会計してください）
          </Link>
        ) : (
          <span className="text-[13px] text-ink-3">未会計はありません</span>
        )}
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kv label="売上合計（税込）" value={yen(metrics.grossSales)} sub={metrics.refunds > 0 ? `返金 −${yen(metrics.refunds)} ／ 純売上 ${yen(metrics.netSales)}` : undefined} />
          <Kv label="会計件数" value={`${metrics.transactionCount}件`} />
          <Kv label="客数" value={`${metrics.guests}名`} />
          <Kv label="客単価" value={yen(metrics.avgSpend)} />
        </div>
        {/* 支払方法別（現場の要望: 締めのときに 現金・カード・PayPay 等の合計を一目で見たい） */}
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[...byMethod.entries()]
            .filter(([m, v]) => BASE_METHODS.includes(m) || v.count > 0)
            .map(([method, v]) => (
              <Kv
                key={method}
                label={`${METHOD_LABELS[method] ?? method} / ${METHOD_LABELS_EN[method] ?? method}`}
                value={yen(v.amount)}
                sub={`${v.count}件`}
              />
            ))}
        </div>
      </CardContent>
    </Card>
  );

  // 本日の出金レシート
  const receiptCard = (
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
        <p className="px-5 py-3 text-sm text-ink-3">本日の出金（経費）はありません</p>
      ) : (
        <ul>
          {receiptRows.map((r) => {
            const state = receiptStateOf(r);
            const { main, sub } = splitPurpose(r.purpose, r.kind);
            return (
              <li
                key={r.id}
                className={cn(
                  'grid grid-cols-[52px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-b border-line px-4 py-1.5 text-[13px] sm:px-5',
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
      <p className="flex items-start gap-1.5 px-5 py-2 text-xs text-ink-2">
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
  );

  return (
    <div>
      <PageHeader
        title="レジクローズ"
        en="Close register"
        description="本日の締め処理。現金を実査して差額を確認してからクローズします"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* 右上の 日次／月次（2026-09-28 Ronnie「レジクローズに月毎で見るタブを右上に」）。
                売上の内訳の期間なので、内訳を出さないレジの iPad では出さない */}
            {!isRegi && (
            <nav className="inline-flex rounded-xl border border-line bg-white p-1" aria-label="期間">
              <Link
                href={`/app/cash/close?period=day&date=${today}`}
                className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold', period === 'day' ? 'on-brand text-white' : 'text-ink-2 hover:bg-lilac-soft')}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                日次<span className="font-num text-[10.5px] font-semibold opacity-80">Daily</span>
              </Link>
              <Link
                href={`/app/cash/close?period=month&date=${today.slice(0, 7)}`}
                className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold', period === 'month' ? 'on-brand text-white' : 'text-ink-2 hover:bg-lilac-soft')}
              >
                <CalendarRange className="h-3.5 w-3.5" />
                月次<span className="font-num text-[10.5px] font-semibold opacity-80">Monthly</span>
              </Link>
            </nav>
            )}
            <Link href="/app/cash" className={cn(buttonVariants({ variant: 'secondary' }))}>
              <ArrowLeft className="h-4 w-4" />
              入出金
            </Link>
          </div>
        }
      />

      {/* レジクローズの箱はすべて小さく（2026-09-29 Ronnie「レジクローズの箱を全部小さく」）。カードの見出しの上下も詰める */}
      <div className="space-y-3 [--ui-card-header-py:0.5rem] [--ui-card-title-size:0.9375rem]">
        {/* レジ端末でログアウトを押したが、レジが開いている（2026-09-28 Ronnie「レジ精算をしないとログアウトできない」） */}
        {sp.logout === 'blocked' && storeDay.openCount > 0 && (
          <p className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[14px] font-bold text-danger">
            レジが開いたままなのでログアウトできません。現金を数えてレジ精算（レジクローズ）をすると、自動でログアウトします。
          </p>
        )}

        {isRegi ? (
          <>
            {/* レジの iPad：締めに要るものだけを1画面に（2026-09-29 Ronnie「iPad の画面に全部入るように」）。
                左 現金実査（金種は2列）、右 本日の売上・支払方法別。売上の内訳・レジ精算（画面）・出金レシートは管理画面だけ */}
            <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              {countSection}
              <div className="space-y-3">
                {salesCard}
                {methodCard}
                {ngRows.length > 0 && (
                  <p className="flex items-start gap-1.5 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] font-bold text-danger">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    レシートのない出金・未精算の仮払いが <span className="tabular-nums">{ngRows.length}</span>件（<span className="tabular-nums">{yen(ngTotal)}</span>）あります。現金差額の原因になります
                  </p>
                )}
              </div>
            </div>
            {closedSection}
          </>
        ) : (
          <>
            {/* レジクローズ（現金実査）はいちばん上（2026-09-29 Ronnie「レジクローズする所を上に」）。支払方法別はその横／下 */}
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {countSection}
              {methodCard}
            </div>
            {closedSection}
            {salesCard}
            {/* 売上の内訳（予約経路別・担当別・コース／メニュー・飲み放題。画面だけ） */}
            {breakdown && <CloseBreakdownCard data={breakdown} period={period} date={bdDate} today={today} basePath="/app/cash/close" />}
            {/* レジ精算をレシートそっくりに（開局中の途中集計 or 今日の締め。2026-09-28 Ronnie） */}
            {period === 'day' && (openSessions[0] || closedCards[closedCards.length - 1]) && (
              <RegisterReportPreview
                sessionId={openSessions[0]?.id ?? (closedCards[closedCards.length - 1] as { session: { id: string } }).session.id}
                live={openSessions.length > 0}
              />
            )}
            {receiptCard}
            <StoreDayClosePanel
              storeId={store.id}
              businessDate={today}
              items={board.preCloseItems}
              alreadyClosed={!!todayClosing}
              canClose={STORE_DAY_CLOSE_ROLES.includes(ctx.role ?? '')}
            />

            {todayClosing && <TodayClosingSummary closing={todayClosing} registerBreakdown={board.registerBreakdown} />}
          </>
        )}
      </div>
    </div>
  );
}

function Kv({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-lilac-soft px-3 py-2">
      <span className="text-[11px] text-ink-3">{label}</span>
      <b className="text-[17px] leading-tight font-extrabold text-ink tabular-nums">{value}</b>
      {sub && <span className="text-[11px] text-ink-3 tabular-nums">{sub}</span>}
    </div>
  );
}
