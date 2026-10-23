import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can, ROLE_LABELS, type Role } from '@/lib/permissions';
import { resolveApprovalRule, type ApprovalRuleLike } from '@/lib/approvals';
import { mapRegisterBreakdown, STORE_DAY_REOPEN_ROLES, type RawRegisterBreakdownEntry } from '@/app/app/cash/close/data';
import type { RegisterBreakdownRow } from '@/components/cash/closing-snapshot';
import { APPROVAL_LABELS, CLOSING_STATUS_LABELS, KIND_LABELS, METHOD_LABELS, PETTY_COUNT_STATUS_LABELS, PETTY_KINDS, type ApprovalStatus, type CashKind, type ClosingStatus, type PettyCountStatus } from '@/components/cash/labels';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 小口現金タブ（GET ?part=petty&from&to&status）。Web の PettyTab と同じ取得・計算 */
export interface NativePettyPayload {
  store: { id: string; name: string };
  from: string;
  to: string;
  status: string;
  canApprove: boolean;
  canWrite: boolean;
  multiStore: boolean;
  openingBalance: number;
  theoreticalBalance: number;
  advanceBalance: number;
  accounts: { id: string; name: string }[];
  advances: { id: string; purpose: string | null; amount: number; businessDate: string }[];
  rows: {
    id: string;
    businessDate: string;
    storeName: string | null;
    kind: string;
    kindLabel: string;
    amount: number;
    purpose: string | null;
    accountName: string | null;
    approvalStatus: string;
    approvalLabel: string;
    /** 承認待ちのとき：要承認の役割（承認ルールがあれば） */
    requiredRole: string | null;
  }[];
  counts: { id: string; countDate: string; expectedAmount: number; countedAmount: number; difference: number; status: string; statusLabel: string }[];
}

export async function loadNativePetty(
  ctx: SessionContext,
  supabase: Supabase,
  store: { id: string; name: string },
  q: { from: string; to: string; status: string }
): Promise<NativePettyPayload> {
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
  let pettyQuery = supabase
    .from('cash_transactions')
    .select('id, business_date, kind, amount, purpose, approval_status, expense_accounts(name), stores(name)')
    .in('store_id', storeIds)
    .in('kind', PETTY_KINDS)
    .gte('business_date', q.from)
    .lte('business_date', q.to)
    .order('business_date', { ascending: false });
  if (q.status) pettyQuery = pettyQuery.eq('approval_status', q.status);

  const [{ data: rows }, { data: accounts }, { data: rulesData }, { data: settings }, { data: allTx }, { data: advanceRows }, { data: countRows }] = await Promise.all([
    pettyQuery,
    supabase.from('expense_accounts').select('id, name').eq('organization_id', ctx.organizationId).eq('status', 'active').order('sort_order'),
    supabase.from('approval_rules').select('target, min_amount, max_amount, approver_role, allow_self_approve').eq('organization_id', ctx.organizationId).eq('target', 'petty_cash'),
    supabase.from('store_settings').select('petty_opening_balance').eq('store_id', store.id).maybeSingle(),
    supabase.from('cash_transactions').select('kind, amount').eq('store_id', store.id).in('kind', PETTY_KINDS).eq('approval_status', 'approved'),
    supabase
      .from('cash_transactions')
      .select('id, purpose, amount, business_date')
      .eq('store_id', store.id)
      .eq('kind', 'petty_advance')
      .eq('approval_status', 'approved')
      .order('business_date', { ascending: false })
      .limit(50),
    supabase
      .from('petty_cash_counts')
      .select('id, count_date, expected_amount, counted_amount, difference, status')
      .in('store_id', storeIds)
      .gte('count_date', q.from)
      .lte('count_date', q.to)
      .order('count_date', { ascending: false }),
  ]);

  const rules: ApprovalRuleLike[] = (rulesData ?? []).map((r) => ({
    target: r.target as ApprovalRuleLike['target'],
    minAmount: r.min_amount as number,
    maxAmount: r.max_amount as number | null,
    approverRole: r.approver_role as ApprovalRuleLike['approverRole'],
    allowSelfApprove: r.allow_self_approve as boolean,
  }));
  const openingBalance = (settings?.petty_opening_balance as number | null) ?? 0;
  const sumOf = (kind: string) => (allTx ?? []).filter((t) => t.kind === kind).reduce((a, t) => a + (t.amount as number), 0);
  const canApprove = can(ctx.role, 'cash.approve');

  return {
    store,
    from: q.from,
    to: q.to,
    status: q.status,
    canApprove,
    canWrite: can(ctx.role, 'cash.write'),
    multiStore: !ctx.currentStore && ctx.stores.length > 1,
    openingBalance,
    theoreticalBalance: openingBalance + sumOf('petty_in') - sumOf('petty_out') - sumOf('petty_settlement'),
    advanceBalance: sumOf('petty_advance') - sumOf('petty_settlement'),
    accounts: (accounts ?? []).map((a) => ({ id: a.id as string, name: a.name as string })),
    advances: (advanceRows ?? []).map((a) => ({ id: a.id as string, purpose: a.purpose as string | null, amount: a.amount as number, businessDate: a.business_date as string })),
    rows: (rows ?? []).map((r) => {
      const rule = canApprove && r.approval_status === 'pending' ? resolveApprovalRule(rules, 'petty_cash', r.amount as number) : null;
      return {
        id: r.id as string,
        businessDate: r.business_date as string,
        storeName: (r.stores as unknown as { name: string } | null)?.name ?? null,
        kind: r.kind as string,
        kindLabel: KIND_LABELS[r.kind as CashKind] ?? (r.kind as string),
        amount: r.amount as number,
        purpose: r.purpose as string | null,
        accountName: (r.expense_accounts as unknown as { name: string } | null)?.name ?? null,
        approvalStatus: r.approval_status as string,
        approvalLabel: APPROVAL_LABELS[r.approval_status as ApprovalStatus] ?? (r.approval_status as string),
        requiredRole: rule ? ROLE_LABELS[rule.approverRole as Role] : null,
      };
    }),
    counts: (countRows ?? []).map((c) => ({
      id: c.id as string,
      countDate: c.count_date as string,
      expectedAmount: c.expected_amount as number,
      countedAmount: c.counted_amount as number,
      difference: c.difference as number,
      status: c.status as string,
      statusLabel: PETTY_COUNT_STATUS_LABELS[c.status as PettyCountStatus] ?? (c.status as string),
    })),
  };
}

/** 締め履歴タブ（GET ?part=closings&from&to）。Web の ClosingsTab と同じ */
export interface NativeClosingsPayload {
  store: { id: string; name: string };
  from: string;
  to: string;
  showStore: boolean;
  canApprove: boolean;
  canReopenStoreDay: boolean;
  methodLabels: Record<string, string>;
  rows: {
    id: string;
    storeId: string;
    businessDate: string;
    storeName: string | null;
    salesTotal: number;
    ordersCount: number;
    guestsCount: number;
    discountTotal: number;
    refundTotal: number;
    netSales: number;
    cashDifference: number;
    status: string;
    statusLabel: string;
    paymentBreakdown: Record<string, number>;
    refundBreakdown: Record<string, number>;
    pettyInTotal: number;
    pettyOutTotal: number;
    expectedCash: number | null;
    countedCash: number | null;
    note: string | null;
    registerBreakdown: RegisterBreakdownRow[];
  }[];
}

export async function loadNativeClosings(
  ctx: SessionContext,
  supabase: Supabase,
  store: { id: string; name: string },
  q: { from: string; to: string }
): Promise<NativeClosingsPayload> {
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);
  const { data: rows } = await supabase
    .from('daily_closings')
    .select(
      'id, store_id, business_date, sales_total, orders_count, guests_count, discount_total, refund_total, net_sales, payment_breakdown, refund_breakdown, petty_in_total, petty_out_total, expected_cash, counted_cash, cash_difference, status, note, register_breakdown, stores(name)'
    )
    .in('store_id', storeIds)
    .gte('business_date', q.from)
    .lte('business_date', q.to)
    .order('business_date', { ascending: false });

  const closedByIds = new Set<string>();
  for (const r of rows ?? []) {
    for (const e of (r.register_breakdown as RawRegisterBreakdownEntry[] | null) ?? []) if (e.closed_by) closedByIds.add(e.closed_by);
  }
  const { data: profiles } = closedByIds.size
    ? await supabase.from('profiles').select('id, display_name').in('id', [...closedByIds])
    : { data: [] as { id: string; display_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));

  return {
    store,
    from: q.from,
    to: q.to,
    showStore: !ctx.currentStore && ctx.stores.length > 1,
    canApprove: can(ctx.role, 'register.approve'),
    canReopenStoreDay: STORE_DAY_REOPEN_ROLES.includes(ctx.role ?? ''),
    methodLabels: METHOD_LABELS,
    rows: (rows ?? []).map((r) => ({
      id: r.id as string,
      storeId: r.store_id as string,
      businessDate: r.business_date as string,
      storeName: (r.stores as unknown as { name: string } | null)?.name ?? null,
      salesTotal: r.sales_total as number,
      ordersCount: r.orders_count as number,
      guestsCount: r.guests_count as number,
      discountTotal: r.discount_total as number,
      refundTotal: r.refund_total as number,
      netSales: r.net_sales as number,
      cashDifference: r.cash_difference as number,
      status: r.status as string,
      statusLabel: CLOSING_STATUS_LABELS[r.status as ClosingStatus] ?? (r.status as string),
      paymentBreakdown: (r.payment_breakdown as Record<string, number> | null) ?? {},
      refundBreakdown: (r.refund_breakdown as Record<string, number> | null) ?? {},
      pettyInTotal: r.petty_in_total as number,
      pettyOutTotal: r.petty_out_total as number,
      expectedCash: r.expected_cash as number | null,
      countedCash: r.counted_cash as number | null,
      note: r.note as string | null,
      registerBreakdown: mapRegisterBreakdown(r.register_breakdown, nameById),
    })),
  };
}
