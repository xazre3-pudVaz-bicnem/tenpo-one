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
  type CashKind,
  type ApprovalStatus,
  type ClosingStatus,
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
}: {
  storeIds: string[];
  defaultStoreId: string;
  organizationId: string;
  from: string;
  to: string;
  status: string;
  canApprove: boolean;
  canWrite: boolean;
}) {
  const supabase = await createClient();

  let query = supabase
    .from('cash_transactions')
    .select('id, business_date, kind, amount, purpose, approval_status, expense_accounts(name), stores(name)')
    .in('store_id', storeIds)
    .in('kind', ['petty_in', 'petty_out'])
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

  const monthStart = `${todayJst().slice(0, 7)}-01`;
  const { data: monthTx } = await supabase
    .from('cash_transactions')
    .select('kind, amount')
    .in('store_id', storeIds)
    .in('kind', ['petty_in', 'petty_out'])
    .eq('approval_status', 'approved')
    .gte('business_date', monthStart)
    .lte('business_date', todayJst());
  const monthIn = (monthTx ?? []).filter((t) => t.kind === 'petty_in').reduce((a, t) => a + t.amount, 0);
  const monthOut = (monthTx ?? []).filter((t) => t.kind === 'petty_out').reduce((a, t) => a + t.amount, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="当月小口残高" value={yen(monthIn - monthOut)} tone="primary" />
        <StatCard label="当月入金" value={yen(monthIn)} />
        <StatCard label="当月出金" value={yen(monthOut)} />
      </div>

      {canWrite && <PettyCashAddDialog storeId={defaultStoreId} accounts={accounts ?? []} />}

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
                  <Td>{KIND_LABELS[r.kind as CashKind]}</Td>
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
