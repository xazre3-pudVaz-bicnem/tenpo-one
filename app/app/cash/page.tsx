import type { Metadata } from 'next';
import Link from 'next/link';
import { Camera, Download, Lock } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can, ROLE_LABELS, type Role } from '@/lib/permissions';
import { resolveApprovalRule, type ApprovalRuleLike } from '@/lib/approvals';
import { yen, formatDate, formatTime, todayJst, daysAgoJst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/state';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { PeriodFilter } from '@/components/cash/period-filter';
import { RegisterOpenCard } from '@/components/cash/register-open-card';
import { RegisterClosedCard } from '@/components/cash/register-closed-card';
import { SessionCard } from '@/components/cash/session-card';
import { PettyCashAddDialog } from '@/components/cash/petty-cash-add-dialog';
import { PettyOpeningBalanceDialog } from '@/components/cash/petty-opening-balance-dialog';
import { PettyCashCountDialog } from '@/components/cash/petty-cash-count-dialog';
import { PettyCashCountApprove } from '@/components/cash/petty-cash-count-approve';
import { ApprovalActions } from '@/components/cash/approval-actions';
import { ClosingRow, type ClosingRowData } from '@/components/cash/closing-row';
import { TodayClosingSummary } from '@/components/cash/today-closing-summary';
import { ChecklistCard } from '@/components/cash/checklist-card';
import { StoreDayClosePanel } from '@/components/cash/store-day-close-panel';
import { CashEntryForm } from '@/components/cash/cash-entry-form';
import { CashHistoryTable, splitPurpose } from '@/components/cash/cash-history';
import { approvePettyCash, rejectPettyCash } from '@/app/app/cash/actions';
import {
  loadRegisterBoard,
  loadTodayCashRows,
  mapRegisterBreakdown,
  STORE_DAY_CLOSE_ROLES,
  STORE_DAY_REOPEN_ROLES,
  type RawRegisterBreakdownEntry,
} from '@/app/app/cash/close/data';
import {
  KIND_LABELS,
  APPROVAL_LABELS,
  APPROVAL_TONES,
  PETTY_KINDS,
  PETTY_COUNT_STATUS_LABELS,
  PETTY_COUNT_STATUS_TONES,
  type CashKind,
  type ApprovalStatus,
  type ClosingStatus,
  type PettyCountStatus,
} from '@/components/cash/labels';

export const metadata: Metadata = { title: '入出金' };

type CashTab = 'register' | 'petty' | 'closings';

const CASH_TABS = [
  { key: 'register', label: 'レジ入出金', en: 'Register', href: '/app/cash' },
  { key: 'petty', label: '小口現金', en: 'Petty cash', href: '/app/cash?tab=petty' },
  { key: 'closings', label: '締め履歴', en: 'Closings', href: '/app/cash?tab=closings' },
];

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; status?: string }>;
}) {
  const ctx = await requireFeature('accounting');
  const sp = await searchParams;

  const tab: CashTab = sp.tab === 'petty' || sp.tab === 'closings' ? sp.tab : 'register';
  const store = ctx.currentStore ?? ctx.stores[0] ?? null;

  return (
    <div>
      <PageHeader
        title="入出金"
        en="Cash in / out"
        description={
          store ? '現金の入金・出金を登録します（売上以外）' : '所属店舗がありません'
        }
        actions={
          <>
            {can(ctx.role, 'register.operate') && (
              <Link href="/app/cash/close" className={cn(buttonVariants({ variant: 'secondary' }))}>
                <Lock className="h-4 w-4" />
                レジクローズ
              </Link>
            )}
            {can(ctx.role, 'csv.export') && (
              <Link
                href={`/app/cash/export?from=${sp.from ?? daysAgoJst(30)}&to=${sp.to ?? todayJst()}`}
                className={cn(buttonVariants({ variant: 'secondary' }))}
              >
                <Download className="h-4 w-4" />
                現金台帳CSV
              </Link>
            )}
          </>
        }
      />

      <SegmentedTabs tabs={CASH_TABS} active={tab} className="mb-4" />

      {!store ? (
        <EmptyState title="所属店舗がありません" description="レジ操作には店舗への割当が必要です。管理者に確認してください。" />
      ) : tab === 'register' ? (
        <RegisterTab
          storeId={store.id}
          role={ctx.role}
          canScan={can(ctx.role, 'documents.write') && can(ctx.role, 'cash.write')}
          canPetty={can(ctx.role, 'cash.write')}
        />
      ) : tab === 'petty' ? (
        <PettyTab
          storeIds={ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id)}
          defaultStoreId={store.id}
          organizationId={ctx.organizationId}
          from={sp.from ?? daysAgoJst(30)}
          to={sp.to ?? todayJst()}
          status={sp.status ?? ''}
          canApprove={can(ctx.role, 'cash.approve')}
          canWrite={can(ctx.role, 'cash.write')}
          multiStore={!ctx.currentStore && ctx.stores.length > 1}
        />
      ) : (
        <ClosingsTab
          storeIds={ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id)}
          showStore={!ctx.currentStore && ctx.stores.length > 1}
          from={sp.from ?? daysAgoJst(30)}
          to={sp.to ?? todayJst()}
          canApprove={can(ctx.role, 'register.approve')}
          canReopenStoreDay={STORE_DAY_REOPEN_ROLES.includes(ctx.role ?? '')}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// レジ入出金タブ（プロトタイプの「入出金」：左=登録 / 右=本日の履歴）
// ---------------------------------------------------------------

async function RegisterTab({
  storeId,
  role,
  canScan,
  canPetty,
}: {
  storeId: string;
  role: string | null;
  canScan: boolean;
  canPetty: boolean;
}) {
  const today = todayJst();
  const [board, rows] = await Promise.all([loadRegisterBoard(storeId, today), loadTodayCashRows(storeId, today)]);
  const { cards, openSessions, todayClosing } = board;
  const theoretical = openSessions.reduce((a, s) => a + s.theoreticalCash, 0);
  const openAdvances = rows.filter((r) => r.kind === 'petty_advance' && r.advanceOpen);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle en="Entry">登録</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canScan && (
              <Link
                href="/app/scan"
                className="flex items-center gap-3 rounded-xl border-2 border-dashed border-iris bg-iris-soft px-4 py-3.5 text-royal transition-colors hover:bg-lilac"
              >
                <Camera className="h-6 w-6 shrink-0" />
                <span className="min-w-0">
                  <b className="block text-[15px]">
                    レシートを撮って保存<span className="en-inline">Snap receipt</span>
                  </b>
                  <span className="block text-xs text-ink-3">出金のレシート・請求書を書類ボックスへ。その場で撮っても、あとから写真・PDFを選んで添付してもかまいません</span>
                </span>
              </Link>
            )}
            {canPetty && (
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/app/cash?tab=petty"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9 border-wisteria font-bold text-royal')}
                >
                  買い物に持ち出し（仮払い）<span className="en-inline">Advance</span>
                </Link>
              </div>
            )}

            {openAdvances.length > 0 && (
              <div className="space-y-2">
                {openAdvances.map((a) => {
                  const { main, sub } = splitPurpose(a.purpose, a.kind);
                  return (
                    <div key={a.id} className="rounded-xl border border-dashed border-saffron bg-saffron-soft px-3 py-2.5 text-[12.5px]">
                      <p className="text-[13.5px] font-bold text-ink">
                        仮払い {a.createdByName} ・ <span className="tabular-nums">{formatTime(a.occurredAt)}</span> 持ち出し{' '}
                        <span className="tabular-nums">{yen(a.amount)}</span>{' '}
                        <span className="ml-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-saffron">精算待ち</span>
                      </p>
                      <p className="mt-0.5 text-ink-2">
                        {main}
                        {sub ? ` ・ ${sub}` : ''}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {canScan && (
                          <Link href={`/app/scan?tx=${a.id}`} className={cn(buttonVariants({ size: 'sm' }), 'h-8 text-[12.5px]')}>
                            レシートを撮る
                          </Link>
                        )}
                        <Link
                          href="/app/cash?tab=petty"
                          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8 border-wisteria text-[12.5px] font-bold text-royal')}
                        >
                          精算する
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <CashEntryForm
              storeId={storeId}
              sessions={openSessions.map((s) => ({ id: s.id, registerName: s.registerName }))}
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle en="Today">本日の入出金履歴</CardTitle>
          </CardHeader>
          <div className="px-5 pt-5 pb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-lilac-soft px-4 py-3.5">
              <span className="text-sm text-ink">
                現在の現金在高（理論値）
                <small className="block text-[11px] text-ink-3">
                  {openSessions.length > 0
                    ? `釣銭準備金＋現金売上＋入金−出金−現金返金（開局中 ${openSessions.length}台）`
                    : '開局中のレジがありません'}
                </small>
              </span>
              <b className="text-[28px] font-extrabold text-royal tabular-nums">
                {openSessions.length > 0 ? yen(theoretical) : '—'}
              </b>
            </div>
          </div>
          <CashHistoryTable rows={rows} canScan={canScan} canSettle={canPetty} />
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink">
            レジ<span className="en-inline">Registers</span>
          </h2>
          <Link href="/app/cash/close" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
            <Lock className="h-3.5 w-3.5" />
            レジクローズ（現金実査）へ
          </Link>
        </div>
        {cards.length === 0 ? (
          <EmptyState title="レジが登録されていません" description="設定からレジを登録すると開局操作ができるようになります。" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {cards.map((c) =>
              c.type === 'unopened' ? (
                <RegisterOpenCard key={c.registerId} storeId={storeId} registerId={c.registerId} registerName={c.registerName} />
              ) : c.type === 'open' ? (
                <SessionCard
                  key={c.session.id}
                  session={{
                    id: c.session.id,
                    storeId,
                    registerName: c.session.registerName,
                    openedByName: c.session.openedByName,
                    openedAt: c.session.openedAt,
                    openingFloat: c.session.openingFloat,
                  }}
                  breakdown={c.session.breakdown}
                  theoreticalCash={c.session.theoreticalCash}
                />
              ) : (
                <RegisterClosedCard key={c.session.id} storeDayClosed={!!todayClosing} session={c.session} canOperate={can(role as Role | null, 'register.operate')} />
              )
            )}
          </div>
        )}
      </section>

      <ChecklistCard
        title="開店チェックリスト"
        description="開局・本日の見込み・重要在庫・未完了タスクをまとめて確認できます。"
        items={board.openingItems}
      />

      <StoreDayClosePanel
        storeId={storeId}
        businessDate={today}
        items={board.preCloseItems}
        alreadyClosed={!!todayClosing}
        canClose={STORE_DAY_CLOSE_ROLES.includes(role ?? '')}
      />

      {todayClosing && <TodayClosingSummary closing={todayClosing} registerBreakdown={board.registerBreakdown} />}
    </div>
  );
}

// ---------------------------------------------------------------
// 小口現金タブ
// ---------------------------------------------------------------

async function PettyTab({
  storeIds,
  defaultStoreId,
  organizationId,
  from,
  to,
  status,
  canApprove,
  canWrite,
  multiStore,
}: {
  storeIds: string[];
  defaultStoreId: string;
  organizationId: string;
  from: string;
  to: string;
  status: string;
  canApprove: boolean;
  canWrite: boolean;
  multiStore: boolean;
}) {
  const supabase = await createClient();

  // 小口一覧・費目・承認ルール・店舗設定・累計・立替一覧・実査履歴はすべて相互に独立のため並列取得する。
  let pettyQuery = supabase
    .from('cash_transactions')
    .select('id, business_date, kind, amount, purpose, approval_status, expense_accounts(name), stores(name)')
    .in('store_id', storeIds)
    .in('kind', PETTY_KINDS)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('business_date', { ascending: false });
  if (status) pettyQuery = pettyQuery.eq('approval_status', status);

  const [
    { data: rows },
    { data: accounts },
    { data: approvalRulesData },
    { data: settings },
    { data: allTx },
    { data: advanceRows },
    { data: countRows },
  ] = await Promise.all([
    pettyQuery,
    supabase
      .from('expense_accounts')
      .select('id, name')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('sort_order'),
    supabase
      .from('approval_rules')
      .select('target, min_amount, max_amount, approver_role, allow_self_approve')
      .eq('organization_id', organizationId)
      .eq('target', 'petty_cash'),
    // 開始残高（店舗設定）
    supabase
      .from('store_settings')
      .select('petty_opening_balance')
      .eq('store_id', defaultStoreId)
      .maybeSingle(),
    // 理論残高・立替残高は運用開始からの累計で計算する（期間絞込の影響を受けない）
    supabase
      .from('cash_transactions')
      .select('kind, amount')
      .eq('store_id', defaultStoreId)
      .in('kind', PETTY_KINDS)
      .eq('approval_status', 'approved'),
    // 精算ダイアログ用：承認済みの立替一覧（厳密な消込は行わないため参考表示）
    supabase
      .from('cash_transactions')
      .select('id, purpose, amount, business_date')
      .eq('store_id', defaultStoreId)
      .eq('kind', 'petty_advance')
      .eq('approval_status', 'approved')
      .order('business_date', { ascending: false })
      .limit(50),
    // 実査履歴
    supabase
      .from('petty_cash_counts')
      .select('id, count_date, expected_amount, counted_amount, difference, status')
      .in('store_id', storeIds)
      .gte('count_date', from)
      .lte('count_date', to)
      .order('count_date', { ascending: false }),
  ]);

  const approvalRules: ApprovalRuleLike[] = (approvalRulesData ?? []).map((r) => ({
    target: r.target as ApprovalRuleLike['target'],
    minAmount: r.min_amount as number,
    maxAmount: r.max_amount as number | null,
    approverRole: r.approver_role as ApprovalRuleLike['approverRole'],
    allowSelfApprove: r.allow_self_approve as boolean,
  }));
  const openingBalance = settings?.petty_opening_balance ?? 0;
  const sumOf = (kind: string) => (allTx ?? []).filter((t) => t.kind === kind).reduce((a, t) => a + t.amount, 0);
  const totalIn = sumOf('petty_in');
  const totalOut = sumOf('petty_out');
  const totalSettlement = sumOf('petty_settlement');
  const totalAdvance = sumOf('petty_advance');
  const theoreticalBalance = openingBalance + totalIn - totalOut - totalSettlement;
  const advanceBalance = totalAdvance - totalSettlement;
  const advances = (advanceRows ?? []).map((a) => ({
    id: a.id as string,
    purpose: a.purpose as string | null,
    amount: a.amount as number,
    businessDate: a.business_date as string,
  }));

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-primary-deep">
        POSの現金売上はレジ台帳（レジ入出金タブ）で管理されます。小口現金は釣銭・経費用の別台帳です。同じ現金を両方に入力しないでください。
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="開始残高"
          value={yen(openingBalance)}
          sub={canApprove ? <PettyOpeningBalanceDialog storeId={defaultStoreId} currentAmount={openingBalance} /> : undefined}
        />
        <StatCard label="理論残高" value={yen(theoreticalBalance)} tone="primary" sub={multiStore ? '基準店舗のみ' : undefined} />
        <StatCard
          label="立替残高（未精算）"
          value={yen(advanceBalance)}
          tone={advanceBalance > 0 ? 'warning' : 'default'}
          sub="承認済み立替 − 精算の概算（個別の消込は未対応）"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {canWrite && <PettyCashAddDialog storeId={defaultStoreId} accounts={accounts ?? []} advances={advances} />}
        {canWrite && <PettyCashCountDialog storeId={defaultStoreId} expectedAmount={theoreticalBalance} />}
      </div>

      <PeriodFilter action="/app/cash" hidden={{ tab: 'petty' }} from={from} to={to}>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="status">
            承認状態
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="h-10 w-40 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-primary focus:outline-2 focus:outline-primary/30"
          >
            <option value="">すべて</option>
            <option value="pending">承認待ち</option>
            <option value="approved">承認済み</option>
            <option value="rejected">差戻し</option>
          </select>
        </div>
      </PeriodFilter>

      {(rows ?? []).length === 0 ? (
        <EmptyState title="小口現金の記録はありません" description="期間や絞込条件を変更するか、入出金を登録してください。" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>営業日</Th>
                <Th>店舗</Th>
                <Th>区分</Th>
                <Th className="text-right">金額</Th>
                <Th>用途</Th>
                <Th>勘定科目</Th>
                <Th>承認状態</Th>
                <Th>操作</Th>
              </Tr>
            </THead>
            <TBody>
              {(rows ?? []).map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDate(r.business_date)}</Td>
                  <Td>{(r.stores as unknown as { name: string } | null)?.name ?? '—'}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {KIND_LABELS[r.kind as CashKind]}
                      {r.kind === 'petty_advance' && <Badge tone="gray">現金移動なし</Badge>}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{yen(r.amount)}</Td>
                  <Td>{r.purpose ?? '—'}</Td>
                  <Td>{(r.expense_accounts as unknown as { name: string } | null)?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={APPROVAL_TONES[r.approval_status as ApprovalStatus]}>
                      {APPROVAL_LABELS[r.approval_status as ApprovalStatus]}
                    </Badge>
                  </Td>
                  <Td>
                    {canApprove && r.approval_status === 'pending' && (
                      <div className="space-y-1">
                        <ApprovalActions
                          onApprove={approvePettyCash.bind(null, r.id)}
                          onReject={rejectPettyCash.bind(null, r.id)}
                          rejectTitle="小口現金の差戻し"
                        />
                        {(() => {
                          const rule = resolveApprovalRule(approvalRules, 'petty_cash', r.amount);
                          return rule ? (
                            <p className="text-xs text-gray-500">要承認: {ROLE_LABELS[rule.approverRole]}</p>
                          ) : null;
                        })()}
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      <div>
        <h3 className="mb-2 text-base font-bold text-ink">
          実査履歴<span className="en-inline">Counts</span>
        </h3>
        {(countRows ?? []).length === 0 ? (
          <EmptyState title="実査の記録はありません" description="「実残高を数える」から実査を記録してください。" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <Tr>
                  <Th>実査日</Th>
                  <Th className="text-right">理論残高</Th>
                  <Th className="text-right">実残高</Th>
                  <Th className="text-right">差異</Th>
                  <Th>状態</Th>
                  <Th>操作</Th>
                </Tr>
              </THead>
              <TBody>
                {(countRows ?? []).map((c) => (
                  <Tr key={c.id}>
                    <Td>{formatDate(c.count_date)}</Td>
                    <Td className="text-right tabular-nums">{yen(c.expected_amount)}</Td>
                    <Td className="text-right tabular-nums">{yen(c.counted_amount)}</Td>
                    <Td className={`text-right tabular-nums font-medium ${c.difference !== 0 ? 'text-danger' : ''}`}>
                      {c.difference > 0 ? '+' : ''}
                      {yen(c.difference)}
                    </Td>
                    <Td>
                      <Badge tone={PETTY_COUNT_STATUS_TONES[c.status as PettyCountStatus]}>
                        {PETTY_COUNT_STATUS_LABELS[c.status as PettyCountStatus]}
                      </Badge>
                    </Td>
                    <Td>{canApprove && c.status === 'recorded' && <PettyCashCountApprove id={c.id} />}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// 締め履歴タブ
// ---------------------------------------------------------------

async function ClosingsTab({
  storeIds,
  showStore,
  from,
  to,
  canApprove,
  canReopenStoreDay,
}: {
  storeIds: string[];
  showStore: boolean;
  from: string;
  to: string;
  canApprove: boolean;
  canReopenStoreDay: boolean;
}) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('daily_closings')
    .select(
      'id, store_id, business_date, sales_total, orders_count, guests_count, discount_total, refund_total, net_sales, payment_breakdown, refund_breakdown, petty_in_total, petty_out_total, expected_cash, counted_cash, cash_difference, status, note, register_breakdown, stores(name)'
    )
    .in('store_id', storeIds)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('business_date', { ascending: false });

  // レジ別内訳の締め担当名を一括解決（全行分のclosed_byをまとめて1回で問い合わせる）
  const closedByIds = new Set<string>();
  for (const r of rows ?? []) {
    for (const e of (r.register_breakdown as RawRegisterBreakdownEntry[] | null) ?? []) {
      if (e.closed_by) closedByIds.add(e.closed_by);
    }
  }
  const { data: profiles } = closedByIds.size
    ? await supabase.from('profiles').select('id, display_name').in('id', [...closedByIds])
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  return (
    <div className="space-y-5">
      <PeriodFilter action="/app/cash" hidden={{ tab: 'closings' }} from={from} to={to} />

      <div className="rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-primary-deep">
        締めはその時点のスナップショットです。締め後に発生した返金は、返金が発生した営業日側の集計に計上されます（過去の締めの数値は書き換えられません）。行を開くと純売上・返金内訳・小口入出金・理論現金／実現金の詳細を確認できます。
      </div>

      {(rows ?? []).length === 0 ? (
        <EmptyState title="締め履歴はありません" description="期間を変更するか、レジ締めを行ってください。" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th />
                <Th>営業日</Th>
                {showStore && <Th>店舗</Th>}
                <Th className="text-right">総売上</Th>
                <Th className="text-right">純売上</Th>
                <Th className="text-right">件数</Th>
                <Th className="text-right">客数</Th>
                <Th className="text-right">現金差異</Th>
                <Th>状態</Th>
                <Th>操作</Th>
              </Tr>
            </THead>
            <TBody>
              {(rows ?? []).map((r) => {
                const data: ClosingRowData = {
                  id: r.id,
                  storeId: r.store_id,
                  businessDate: r.business_date,
                  storeName: (r.stores as unknown as { name: string } | null)?.name,
                  salesTotal: r.sales_total,
                  ordersCount: r.orders_count,
                  guestsCount: r.guests_count,
                  discountTotal: r.discount_total,
                  refundTotal: r.refund_total,
                  netSales: r.net_sales,
                  cashDifference: r.cash_difference,
                  status: r.status as ClosingStatus,
                  paymentBreakdown: (r.payment_breakdown as Record<string, number>) ?? {},
                  refundBreakdown: (r.refund_breakdown as Record<string, number>) ?? {},
                  pettyInTotal: r.petty_in_total,
                  pettyOutTotal: r.petty_out_total,
                  expectedCash: r.expected_cash,
                  countedCash: r.counted_cash,
                  note: r.note,
                  registerBreakdown: mapRegisterBreakdown(r.register_breakdown, nameById),
                };
                return (
                  <ClosingRow
                    key={r.id}
                    closing={data}
                    showStore={showStore}
                    canApprove={canApprove}
                    canReopenStoreDay={canReopenStoreDay}
                  />
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
