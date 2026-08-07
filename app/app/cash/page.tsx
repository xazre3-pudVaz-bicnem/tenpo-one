import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { yen, formatDate, todayJst, daysAgoJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { CashTabs, type CashTab } from '@/components/cash/tabs';
import { PeriodFilter } from '@/components/cash/period-filter';
import { OpenRegisterForm } from '@/components/cash/open-register-form';
import { SessionCard, type SessionCardData } from '@/components/cash/session-card';
import { PettyCashAddDialog } from '@/components/cash/petty-cash-add-dialog';
import { PettyOpeningBalanceDialog } from '@/components/cash/petty-opening-balance-dialog';
import { PettyCashCountDialog } from '@/components/cash/petty-cash-count-dialog';
import { PettyCashCountApprove } from '@/components/cash/petty-cash-count-approve';
import { ApprovalActions } from '@/components/cash/approval-actions';
import { ClosingRow, type ClosingRowData } from '@/components/cash/closing-row';
import { approvePettyCash, rejectPettyCash } from '@/app/app/cash/actions';
import {
  KIND_LABELS,
  APPROVAL_LABELS,
  APPROVAL_TONES,
  CLOSING_STATUS_LABELS,
  CLOSING_STATUS_TONES,
  METHOD_LABELS,
  PETTY_KINDS,
  PETTY_COUNT_STATUS_LABELS,
  PETTY_COUNT_STATUS_TONES,
  type CashKind,
  type ApprovalStatus,
  type ClosingStatus,
  type PettyCountStatus,
} from '@/components/cash/labels';

export const metadata: Metadata = { title: 'レジ締め・小口現金' };

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; status?: string }>;
}) {
  const ctx = await requireMember();
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
        <RegisterTab storeId={store.id} />
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
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// レジタブ
// ---------------------------------------------------------------

async function RegisterTab({ storeId }: { storeId: string }) {
  const supabase = await createClient();
  const today = todayJst();

  const { data: registers } = await supabase
    .from('registers')
    .select('id, name')
    .eq('store_id', storeId)
    .eq('status', 'active')
    .order('name');

  const { data: sessions } = await supabase
    .from('register_sessions')
    .select('id, register_id, opened_at, opened_by, opening_float, registers(name)')
    .eq('store_id', storeId)
    .eq('status', 'open')
    .order('opened_at');

  const openedByIds = [...new Set((sessions ?? []).map((s) => s.opened_by).filter((v): v is string => !!v))];
  const { data: openers } = openedByIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', openedByIds)
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((openers ?? []).map((p) => [p.id, p.display_name]));

  const sessionIds = (sessions ?? []).map((s) => s.id);
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

  const openRegisterIds = new Set((sessions ?? []).map((s) => s.register_id));
  const availableRegisters = (registers ?? []).filter((r) => !openRegisterIds.has(r.id));

  const { data: todayClosing } = await supabase
    .from('daily_closings')
    .select('*')
    .eq('store_id', storeId)
    .eq('business_date', today)
    .maybeSingle();

  return (
    <div className="space-y-5">
      {(registers ?? []).length === 0 ? (
        <EmptyState title="レジが登録されていません" description="設定からレジを登録すると開局操作ができるようになります。" />
      ) : (
        availableRegisters.length > 0 && <OpenRegisterForm storeId={storeId} registers={availableRegisters} />
      )}

      {(sessions ?? []).length === 0 ? (
        <EmptyState title="開局中のレジはありません" description="レジを開局すると営業中のセッションがここに表示されます。" />
      ) : (
        <div className="space-y-4">
          {(sessions ?? []).map((s) => {
            const breakdown = breakdownBySession.get(s.id) ?? {};
            const sale = breakdown.sale ?? 0;
            const refund = breakdown.refund ?? 0;
            const deposit = (breakdown.deposit ?? 0) + (breakdown.petty_in ?? 0);
            const withdrawal = (breakdown.withdrawal ?? 0) + (breakdown.petty_out ?? 0);
            const theoreticalCash = s.opening_float + sale - refund + deposit - withdrawal;
            const data: SessionCardData = {
              id: s.id,
              storeId,
              registerName: (s.registers as unknown as { name: string } | null)?.name ?? '—',
              openedByName: s.opened_by ? (nameById.get(s.opened_by) ?? '—') : '—',
              openedAt: s.opened_at,
              openingFloat: s.opening_float,
            };
            return <SessionCard key={s.id} session={data} breakdown={breakdown} theoreticalCash={theoreticalCash} />;
          })}
        </div>
      )}

      {todayClosing && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>本日の締めサマリ</CardTitle>
            <Badge tone={CLOSING_STATUS_TONES[todayClosing.status as ClosingStatus]}>
              {CLOSING_STATUS_LABELS[todayClosing.status as ClosingStatus]}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="売上" value={yen(todayClosing.sales_total)} />
              <StatCard label="会計件数" value={`${todayClosing.orders_count}件`} />
              <StatCard label="客数" value={`${todayClosing.guests_count}名`} />
              <StatCard
                label="現金差異"
                value={`${todayClosing.cash_difference > 0 ? '+' : ''}${yen(todayClosing.cash_difference)}`}
                tone={todayClosing.cash_difference !== 0 ? 'danger' : 'success'}
              />
            </div>
            {todayClosing.payment_breakdown && Object.keys(todayClosing.payment_breakdown).length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500">支払方法内訳</p>
                <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {Object.entries(todayClosing.payment_breakdown as Record<string, number>).map(([method, amt]) => (
                    <li key={method} className="flex gap-2">
                      <span className="text-gray-600">{METHOD_LABELS[method] ?? method}</span>
                      <span className="tabular-nums font-medium text-navy">{yen(amt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                      <ApprovalActions
                        onApprove={approvePettyCash.bind(null, r.id)}
                        onReject={rejectPettyCash.bind(null, r.id)}
                        rejectTitle="小口現金の差戻し"
                      />
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
}: {
  storeIds: string[];
  showStore: boolean;
  from: string;
  to: string;
  canApprove: boolean;
}) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('daily_closings')
    .select(
      'id, business_date, sales_total, orders_count, guests_count, discount_total, refund_total, payment_breakdown, cash_difference, status, note, stores(name)'
    )
    .in('store_id', storeIds)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('business_date', { ascending: false });

  return (
    <div className="space-y-5">
      <PeriodFilter action="/app/cash" hidden={{ tab: 'closings' }} from={from} to={to} />

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
                <Th className="text-right">売上</Th>
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
                  businessDate: r.business_date,
                  storeName: (r.stores as unknown as { name: string } | null)?.name,
                  salesTotal: r.sales_total,
                  ordersCount: r.orders_count,
                  guestsCount: r.guests_count,
                  discountTotal: r.discount_total,
                  refundTotal: r.refund_total,
                  cashDifference: r.cash_difference,
                  status: r.status as ClosingStatus,
                  paymentBreakdown: (r.payment_breakdown as Record<string, number>) ?? {},
                  note: r.note,
                };
                return <ClosingRow key={r.id} closing={data} showStore={showStore} canApprove={canApprove} />;
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
