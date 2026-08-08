import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can, ROLE_LABELS } from '@/lib/permissions';
import { resolveApprovalRule, type ApprovalRuleLike } from '@/lib/approvals';
import { expectedCash } from '@/lib/metrics';
import { yen, formatDate, todayJst, daysAgoJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { CashTabs, type CashTab } from '@/components/cash/tabs';
import { PeriodFilter } from '@/components/cash/period-filter';
import { RegisterOpenCard } from '@/components/cash/register-open-card';
import { RegisterClosedCard } from '@/components/cash/register-closed-card';
import { SessionCard, type SessionCardData } from '@/components/cash/session-card';
import { PettyCashAddDialog } from '@/components/cash/petty-cash-add-dialog';
import { PettyOpeningBalanceDialog } from '@/components/cash/petty-opening-balance-dialog';
import { PettyCashCountDialog } from '@/components/cash/petty-cash-count-dialog';
import { PettyCashCountApprove } from '@/components/cash/petty-cash-count-approve';
import { ApprovalActions } from '@/components/cash/approval-actions';
import { ClosingRow, type ClosingRowData } from '@/components/cash/closing-row';
import { ClosingSnapshot, type RegisterBreakdownRow } from '@/components/cash/closing-snapshot';
import { ChecklistCard, type ChecklistItem } from '@/components/cash/checklist-card';
import { StoreDayClosePanel } from '@/components/cash/store-day-close-panel';
import { approvePettyCash, rejectPettyCash } from '@/app/app/cash/actions';
import {
  KIND_LABELS,
  APPROVAL_LABELS,
  APPROVAL_TONES,
  CLOSING_STATUS_LABELS,
  CLOSING_STATUS_TONES,
  PETTY_KINDS,
  PETTY_COUNT_STATUS_LABELS,
  PETTY_COUNT_STATUS_TONES,
  type CashKind,
  type ApprovalStatus,
  type ClosingStatus,
  type PettyCountStatus,
} from '@/components/cash/labels';

/** 店舗日次締め（close_store_day）を実行できるロール。app/app/cash/actions.tsのSTORE_DAY_CLOSE_ROLESと一致させること */
const STORE_DAY_CLOSE_ROLES = ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager'];
/** 店舗日次締めの再オープン（reopen_store_day）を実行できるロール */
const STORE_DAY_REOPEN_ROLES = ['org_owner', 'hq_admin', 'area_manager'];

/** 予約が「本日まだ有効」とみなせるステータス（仮予約・キャンセル・無断キャンセル・会計済み・キャンセル待ちは除く） */
const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'waiting', 'arrived', 'seated', 'billing'];

/** register_breakdown（jsonb）の1要素の生の型。supabase/migrations/00027の close_store_day が生成する */
interface RawRegisterBreakdownEntry {
  register_id: string;
  register_name: string;
  session_id: string;
  opening_float: number;
  cash_sales: number;
  cash_refunds: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  counted_cash: number;
  difference: number;
  closed_by: string | null;
}

function mapRegisterBreakdown(
  raw: unknown,
  nameById: Map<string, string>
): RegisterBreakdownRow[] {
  return ((raw as RawRegisterBreakdownEntry[] | null) ?? []).map((e) => ({
    registerName: e.register_name,
    openingFloat: e.opening_float,
    cashSales: e.cash_sales,
    cashRefunds: e.cash_refunds,
    cashIn: e.cash_in,
    cashOut: e.cash_out,
    expectedCash: e.expected_cash,
    countedCash: e.counted_cash,
    difference: e.difference,
    closedByName: e.closed_by ? (nameById.get(e.closed_by) ?? '—') : '—',
  }));
}

export const metadata: Metadata = { title: 'レジ締め・小口現金' };

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
        title="レジ締め・小口現金"
        description={store ? `${store.name}を中心に表示しています` : '所属店舗がありません'}
        actions={
          can(ctx.role, 'csv.export') ? (
            <Link
              href={`/app/cash/export?from=${sp.from ?? daysAgoJst(30)}&to=${sp.to ?? todayJst()}`}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-navy hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              現金台帳CSV
            </Link>
          ) : undefined
        }
      />

      <CashTabs active={tab} />

      {!store ? (
        <EmptyState title="所属店舗がありません" description="レジ操作には店舗への割当が必要です。管理者に確認してください。" />
      ) : tab === 'register' ? (
        <RegisterTab storeId={store.id} role={ctx.role} />
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
// レジタブ
// ---------------------------------------------------------------

async function RegisterTab({ storeId, role }: { storeId: string; role: string | null }) {
  const supabase = await createClient();
  const today = todayJst();

  const [
    { data: registers },
    { data: todaySessions },
    { data: todayClosing },
    { count: unpaidOrdersCount },
    { data: unservedKdsRows },
    { count: unclockedStaffCount },
    { count: pendingPettyCount },
    { count: reservationsCount },
    { count: shiftsCount },
    { data: lowStockRows },
    { count: openTasksCount },
    { count: printerCount },
  ] = await Promise.all([
    supabase.from('registers').select('id, name').eq('store_id', storeId).eq('status', 'active').order('name'),
    supabase
      .from('register_sessions')
      .select(
        'id, register_id, status, opened_at, opened_by, opening_float, closed_at, closed_by, counted_cash, expected_cash, difference, registers(name)'
      )
      .eq('store_id', storeId)
      .eq('business_date', today)
      .order('opened_at'),
    supabase.from('daily_closings').select('*').eq('store_id', storeId).eq('business_date', today).maybeSingle(),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('business_date', today)
      .eq('status', 'open'),
    supabase
      .from('order_items')
      .select('id, orders!inner(status, business_date)')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .neq('kitchen_status', 'served')
      .eq('orders.status', 'open')
      .eq('orders.business_date', today),
    supabase
      .from('time_entries')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('work_date', today)
      .not('clock_in_at', 'is', null)
      .is('clock_out_at', null),
    supabase
      .from('cash_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .in('kind', PETTY_KINDS)
      .eq('approval_status', 'pending'),
    supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('reserved_date', today)
      .in('status', ACTIVE_RESERVATION_STATUSES),
    supabase
      .from('shifts')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('shift_date', today)
      .neq('status', 'cancelled'),
    supabase
      .from('inventory_items')
      .select('id, current_quantity, reorder_point')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .not('reorder_point', 'is', null),
    supabase
      .from('store_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .in('status', ['open', 'in_progress']),
    supabase.from('printer_configs').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('status', 'active'),
  ]);

  // 開局・締め担当者名の解決（今日のセッションに登場する opened_by / closed_by のみ）
  const profileIds = [
    ...new Set((todaySessions ?? []).flatMap((s) => [s.opened_by, s.closed_by]).filter((v): v is string => !!v)),
  ];
  const { data: profiles } = profileIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', profileIds)
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const openSessions = (todaySessions ?? []).filter((s) => s.status === 'open');
  const sessionIds = openSessions.map((s) => s.id);
  const { data: sessionTx } = sessionIds.length
    ? await supabase
        .from('cash_transactions')
        .select('register_session_id, kind, amount')
        .in('register_session_id', sessionIds)
        .eq('status', 'active')
    : { data: [] as { register_session_id: string | null; kind: string; amount: number }[] };

  const breakdownBySession = new Map<string, Partial<Record<CashKind, number>>>();
  for (const t of sessionTx ?? []) {
    if (!t.register_session_id) continue;
    const bucket = breakdownBySession.get(t.register_session_id) ?? {};
    const k = t.kind as CashKind;
    bucket[k] = (bucket[k] ?? 0) + t.amount;
    breakdownBySession.set(t.register_session_id, bucket);
  }

  // レジごとの「本日の最新セッション」（開局中があればそれを優先。無ければ最後に締めたもの）
  type TodaySession = NonNullable<typeof todaySessions>[number];
  const sessionsByRegister = new Map<string, TodaySession[]>();
  for (const s of todaySessions ?? []) {
    const arr = sessionsByRegister.get(s.register_id) ?? [];
    arr.push(s);
    sessionsByRegister.set(s.register_id, arr);
  }
  const latestSessionFor = (registerId: string) => {
    const arr = sessionsByRegister.get(registerId) ?? [];
    if (arr.length === 0) return null;
    return arr.find((s) => s.status === 'open') ?? arr[arr.length - 1];
  };

  const unservedKdsCount = (unservedKdsRows ?? []).length;
  const lowStockCount = (lowStockRows ?? []).filter(
    (i) => i.reorder_point != null && Number(i.current_quantity) <= Number(i.reorder_point)
  ).length;
  const openRegistersCount = openSessions.length;
  const totalRegistersCount = (registers ?? []).length;

  // ---- 開店チェックリスト ----
  const openingItems: ChecklistItem[] = [
    {
      key: 'registers-open',
      label: 'レジ開局状態',
      valueLabel: totalRegistersCount === 0 ? '未登録' : `${openRegistersCount}/${totalRegistersCount}台 開局中`,
      status: totalRegistersCount > 0 && openRegistersCount === totalRegistersCount ? 'ok' : 'warn',
    },
    {
      key: 'reservations',
      label: '本日の予約組数',
      valueLabel: `${reservationsCount ?? 0}組`,
      status: 'info',
      href: '/app/reservations',
    },
    {
      key: 'shifts',
      label: '本日の出勤予定',
      valueLabel: `${shiftsCount ?? 0}名`,
      status: 'info',
      href: '/app/shifts',
    },
    {
      key: 'inventory',
      label: '発注点割れの重要在庫',
      valueLabel: `${lowStockCount}品`,
      status: lowStockCount === 0 ? 'ok' : 'warn',
      href: '/app/inventory?sort=warning',
    },
    {
      key: 'tasks',
      label: '未完了タスク',
      valueLabel: `${openTasksCount ?? 0}件`,
      status: (openTasksCount ?? 0) === 0 ? 'ok' : 'warn',
      href: '/app/tasks',
    },
    {
      key: 'printer',
      label: 'レシートプリンター',
      valueLabel: (printerCount ?? 0) > 0 ? `${printerCount}台登録（Simulation）` : '未登録（Simulation）',
      status: 'info',
      href: '/app/settings/printers',
    },
  ];

  // ---- 店舗日次締め 実行前チェック ----
  const preCloseItems: ChecklistItem[] = [
    {
      key: 'unpaid-orders',
      label: '未会計伝票（当営業日）',
      valueLabel: `${unpaidOrdersCount ?? 0}件`,
      status: (unpaidOrdersCount ?? 0) === 0 ? 'ok' : 'warn',
      href: '/app/orders',
    },
    {
      key: 'unserved-kds',
      label: '未提供KDS',
      valueLabel: `${unservedKdsCount}件`,
      status: unservedKdsCount === 0 ? 'ok' : 'warn',
      href: '/app/kitchen',
    },
    {
      key: 'unclocked-staff',
      label: '未退勤スタッフ',
      valueLabel: `${unclockedStaffCount ?? 0}名`,
      status: (unclockedStaffCount ?? 0) === 0 ? 'ok' : 'warn',
      href: '/app/attendance',
    },
    {
      key: 'open-registers',
      label: '未締めレジ',
      valueLabel: `${openRegistersCount}台`,
      status: openRegistersCount === 0 ? 'ok' : 'warn',
    },
    {
      key: 'pending-petty',
      label: '承認待ち小口現金',
      valueLabel: `${pendingPettyCount ?? 0}件`,
      status: (pendingPettyCount ?? 0) === 0 ? 'ok' : 'warn',
      href: '/app/cash?tab=petty',
    },
  ];

  const registerBreakdown = mapRegisterBreakdown(todayClosing?.register_breakdown, nameById);

  return (
    <div className="space-y-5">
      <ChecklistCard
        title="開店チェックリスト"
        description="開局・本日の見込み・重要在庫・未完了タスクをまとめて確認できます。"
        items={openingItems}
      />

      {(registers ?? []).length === 0 ? (
        <EmptyState title="レジが登録されていません" description="設定からレジを登録すると開局操作ができるようになります。" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(registers ?? []).map((r) => {
            const session = latestSessionFor(r.id);
            if (!session) {
              return <RegisterOpenCard key={r.id} storeId={storeId} registerId={r.id} registerName={r.name} />;
            }
            if (session.status === 'open') {
              const breakdown = breakdownBySession.get(session.id) ?? {};
              const sale = breakdown.sale ?? 0;
              const refund = breakdown.refund ?? 0;
              const deposit = (breakdown.deposit ?? 0) + (breakdown.petty_in ?? 0);
              const withdrawal = (breakdown.withdrawal ?? 0) + (breakdown.petty_out ?? 0);
              const theoreticalCash = expectedCash({
                openingFloat: session.opening_float,
                cashSales: sale,
                cashIn: deposit,
                cashRefunds: refund,
                cashOut: withdrawal,
              });
              const data: SessionCardData = {
                id: session.id,
                storeId,
                registerName: (session.registers as unknown as { name: string } | null)?.name ?? r.name,
                openedByName: session.opened_by ? (nameById.get(session.opened_by) ?? '—') : '—',
                openedAt: session.opened_at,
                openingFloat: session.opening_float,
              };
              return <SessionCard key={session.id} session={data} breakdown={breakdown} theoreticalCash={theoreticalCash} />;
            }
            return (
              <RegisterClosedCard
                key={session.id}
                storeDayClosed={!!todayClosing}
                session={{
                  registerName: (session.registers as unknown as { name: string } | null)?.name ?? r.name,
                  openedByName: session.opened_by ? (nameById.get(session.opened_by) ?? '—') : '—',
                  closedByName: session.closed_by ? (nameById.get(session.closed_by) ?? '—') : '—',
                  openedAt: session.opened_at,
                  closedAt: session.closed_at,
                  openingFloat: session.opening_float,
                  expectedCash: session.expected_cash,
                  countedCash: session.counted_cash,
                  difference: session.difference,
                }}
              />
            );
          })}
        </div>
      )}

      <StoreDayClosePanel
        storeId={storeId}
        businessDate={today}
        items={preCloseItems}
        alreadyClosed={!!todayClosing}
        canClose={STORE_DAY_CLOSE_ROLES.includes(role ?? '')}
      />

      {todayClosing && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>本日の締めサマリ</CardTitle>
            <Badge tone={CLOSING_STATUS_TONES[todayClosing.status as ClosingStatus]}>
              {CLOSING_STATUS_LABELS[todayClosing.status as ClosingStatus]}
            </Badge>
          </CardHeader>
          <CardContent>
            <ClosingSnapshot
              data={{
                salesTotal: todayClosing.sales_total,
                refundTotal: todayClosing.refund_total,
                netSales: todayClosing.net_sales,
                discountTotal: todayClosing.discount_total,
                paymentBreakdown: (todayClosing.payment_breakdown as Record<string, number>) ?? {},
                refundBreakdown: (todayClosing.refund_breakdown as Record<string, number>) ?? {},
                pettyInTotal: todayClosing.petty_in_total,
                pettyOutTotal: todayClosing.petty_out_total,
                expectedCash: todayClosing.expected_cash,
                countedCash: todayClosing.counted_cash,
                cashDifference: todayClosing.cash_difference,
                registerBreakdown,
              }}
            />
          </CardContent>
        </Card>
      )}
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

  let query = supabase
    .from('cash_transactions')
    .select('id, business_date, kind, amount, purpose, approval_status, expense_accounts(name), stores(name)')
    .in('store_id', storeIds)
    .in('kind', PETTY_KINDS)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('business_date', { ascending: false });
  if (status) query = query.eq('approval_status', status);
  const { data: rows } = await query;

  const { data: accounts } = await supabase
    .from('expense_accounts')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('sort_order');

  const { data: approvalRulesData } = await supabase
    .from('approval_rules')
    .select('target, min_amount, max_amount, approver_role, allow_self_approve')
    .eq('organization_id', organizationId)
    .eq('target', 'petty_cash');
  const approvalRules: ApprovalRuleLike[] = (approvalRulesData ?? []).map((r) => ({
    target: r.target as ApprovalRuleLike['target'],
    minAmount: r.min_amount as number,
    maxAmount: r.max_amount as number | null,
    approverRole: r.approver_role as ApprovalRuleLike['approverRole'],
    allowSelfApprove: r.allow_self_approve as boolean,
  }));

  // 開始残高（店舗設定）
  const { data: settings } = await supabase
    .from('store_settings')
    .select('petty_opening_balance')
    .eq('store_id', defaultStoreId)
    .maybeSingle();
  const openingBalance = settings?.petty_opening_balance ?? 0;

  // 理論残高・立替残高は運用開始からの累計で計算する（期間絞込の影響を受けない）
  const { data: allTx } = await supabase
    .from('cash_transactions')
    .select('kind, amount')
    .eq('store_id', defaultStoreId)
    .in('kind', PETTY_KINDS)
    .eq('approval_status', 'approved');
  const sumOf = (kind: string) => (allTx ?? []).filter((t) => t.kind === kind).reduce((a, t) => a + t.amount, 0);
  const totalIn = sumOf('petty_in');
  const totalOut = sumOf('petty_out');
  const totalSettlement = sumOf('petty_settlement');
  const totalAdvance = sumOf('petty_advance');
  const theoreticalBalance = openingBalance + totalIn - totalOut - totalSettlement;
  const advanceBalance = totalAdvance - totalSettlement;

  // 精算ダイアログ用：承認済みの立替一覧（厳密な消込は行わないため参考表示）
  const { data: advanceRows } = await supabase
    .from('cash_transactions')
    .select('id, purpose, amount, business_date')
    .eq('store_id', defaultStoreId)
    .eq('kind', 'petty_advance')
    .eq('approval_status', 'approved')
    .order('business_date', { ascending: false })
    .limit(50);
  const advances = (advanceRows ?? []).map((a) => ({
    id: a.id as string,
    purpose: a.purpose as string | null,
    amount: a.amount as number,
    businessDate: a.business_date as string,
  }));

  // 実査履歴
  const { data: countRows } = await supabase
    .from('petty_cash_counts')
    .select('id, count_date, expected_amount, counted_amount, difference, status')
    .in('store_id', storeIds)
    .gte('count_date', from)
    .lte('count_date', to)
    .order('count_date', { ascending: false });

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-primary-deep">
        POSの現金売上はレジ台帳（レジタブ）で管理されます。小口現金は釣銭・経費用の別台帳です。同じ現金を両方に入力しないでください。
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
        <h3 className="mb-2 text-sm font-semibold text-navy">実査履歴</h3>
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
