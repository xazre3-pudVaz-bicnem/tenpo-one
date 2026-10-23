import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can, ROLE_LABELS } from '@/lib/permissions';
import { daysAgoJst, todayJst } from '@/lib/format';
import { resolveApprovalRule, type ApprovalRuleLike } from '@/lib/approvals';
import { sortShops } from '@/lib/cash-shops';
import { loadHomeData } from '@/components/dashboard/home-data';
import { APPROVAL_LABELS, PAID_VIA_LABELS, type ApprovalStatus, type PaidVia } from '@/components/cash/labels';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 仕入・経費（GET ?part=expenses）。Web の app/app/expenses/page.tsx（レジの iPad：上にお知らせ&アラート）と同じ組み立て */
export interface NativeExpensesPayload {
  store: { id: string; name: string };
  from: string;
  to: string;
  account: string;
  status: string;
  notices: {
    announcements: { id: string; title: string; createdAt: string; important: boolean; unread: boolean }[];
    unreadCount: number;
    alerts: { id: string; kindLabel: string; title: string; href: string; createdAt: string }[];
    alertCount: number;
    autoNotices: { id: string; message: string; linkLabel: string | null; href: string; at: string | null }[];
    todos: { key: string; label: string; count: number; valueLabel: string | null; href: string }[];
  };
  accounts: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  monthTotals: { name: string; total: number }[];
  billCount: number;
  billTotal: number;
  paidVia: { key: string; label: string }[];
  rows: {
    id: string;
    businessDate: string;
    storeName: string;
    accountName: string;
    amount: number;
    taxAmount: number;
    paidVia: string;
    vendorName: string | null;
    status: string;
    statusLabel: string;
    journaled: boolean;
    approverLabel: string | null;
  }[];
  canWrite: boolean;
  canApprove: boolean;
  canScan: boolean;
  canExport: boolean;
}

export async function loadNativeExpenses(
  ctx: SessionContext,
  supabase: Supabase,
  store: { id: string; name: string },
  sp: { from?: string | null; to?: string | null; account?: string | null; status?: string | null }
): Promise<NativeExpensesPayload> {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const from = sp.from && DATE.test(sp.from) ? sp.from : daysAgoJst(30);
  const to = sp.to && DATE.test(sp.to) ? sp.to : todayJst();
  const account = sp.account && /^[0-9a-f-]{36}$/i.test(sp.account) ? sp.account : '';
  const status = ['pending', 'approved', 'rejected'].includes(sp.status ?? '') ? (sp.status as string) : '';
  const monthStart = `${todayJst().slice(0, 7)}-01`;

  let query = supabase
    .from('expenses')
    .select('id, business_date, amount, tax_amount, paid_via, vendor_name, memo, approval_status, expense_accounts(id, name), stores(name)')
    .eq('store_id', store.id)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('business_date', { ascending: false })
    .limit(300);
  if (account) query = query.eq('expense_account_id', account);
  if (status) query = query.eq('approval_status', status);

  const [{ data: accounts }, { data: rulesData }, { data: rows }, { data: monthRows }, { data: vendorRows }, { data: billRows }, home] = await Promise.all([
    supabase.from('expense_accounts').select('id, name').eq('organization_id', ctx.organizationId).eq('status', 'active').order('sort_order'),
    supabase.from('approval_rules').select('target, min_amount, max_amount, approver_role, allow_self_approve').eq('organization_id', ctx.organizationId).eq('target', 'expense'),
    query,
    supabase.from('expenses').select('amount, expense_accounts(id, name)').eq('store_id', store.id).eq('status', 'active').gte('business_date', monthStart).lte('business_date', todayJst()),
    supabase.from('vendors').select('id, name, name_kana').eq('status', 'active').limit(300),
    supabase.from('invoices').select('amount').eq('store_id', store.id).neq('status', 'rejected').gte('issue_date', monthStart).lte('issue_date', todayJst()),
    loadHomeData({
      supabase,
      organizationId: ctx.organizationId as string,
      userId: ctx.userId,
      role: ctx.role,
      accountingEnabled: !ctx.disabledFeatures.has('accounting'),
      stores: [store],
      isAllStores: false,
      today: todayJst(),
      metricsOpts: {},
    }),
  ]);
  const rules: ApprovalRuleLike[] = (rulesData ?? []).map((r) => ({
    target: r.target as ApprovalRuleLike['target'],
    minAmount: r.min_amount as number,
    maxAmount: r.max_amount as number | null,
    approverRole: r.approver_role as ApprovalRuleLike['approverRole'],
    allowSelfApprove: r.allow_self_approve as boolean,
  }));
  const ids = (rows ?? []).map((r) => r.id as string);
  const { data: journaled } = ids.length
    ? await supabase.from('journal_entries').select('source_id').eq('organization_id', ctx.organizationId).eq('source_type', 'expense').in('source_id', ids)
    : { data: [] as { source_id: string }[] };
  const journaledIds = new Set((journaled ?? []).map((j) => j.source_id as string));
  const monthTotals = new Map<string, number>();
  for (const r of monthRows ?? []) {
    const name = (r.expense_accounts as unknown as { name: string } | null)?.name ?? '未分類';
    monthTotals.set(name, (monthTotals.get(name) ?? 0) + Number(r.amount));
  }
  return {
    store,
    from,
    to,
    account,
    status,
    notices: {
      announcements: home.announcements,
      unreadCount: home.unreadCount,
      alerts: home.alerts,
      alertCount: home.alertCount,
      autoNotices: home.autoNotices.map((n) => ({ id: n.id, message: n.message, linkLabel: n.linkLabel ?? null, href: n.href, at: n.at ?? null })),
      todos: home.todos.map((t) => ({ key: t.key, label: t.label, count: t.count, valueLabel: t.valueLabel ?? null, href: t.href })),
    },
    accounts: (accounts ?? []).map((a) => ({ id: a.id as string, name: a.name as string })),
    vendors: sortShops((vendorRows ?? []).map((v) => ({ id: v.id as string, name: v.name as string, kana: (v.name_kana as string | null) ?? null }))).map(({ id, name }) => ({ id, name })),
    monthTotals: [...monthTotals.entries()].map(([name, total]) => ({ name, total })),
    billCount: (billRows ?? []).length,
    billTotal: (billRows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0),
    paidVia: (Object.keys(PAID_VIA_LABELS) as PaidVia[]).map((k) => ({ key: k, label: PAID_VIA_LABELS[k] })),
    rows: (rows ?? []).map((r) => {
      const st = r.approval_status as ApprovalStatus;
      const rule = st === 'pending' ? resolveApprovalRule(rules, 'expense', Number(r.amount)) : null;
      return {
        id: r.id as string,
        businessDate: r.business_date as string,
        storeName: (r.stores as unknown as { name: string } | null)?.name ?? '—',
        accountName: (r.expense_accounts as unknown as { name: string } | null)?.name ?? '—',
        amount: Number(r.amount),
        taxAmount: Number(r.tax_amount ?? 0),
        paidVia: PAID_VIA_LABELS[r.paid_via as PaidVia] ?? (r.paid_via as string),
        vendorName: (r.vendor_name as string | null) ?? null,
        status: st,
        statusLabel: APPROVAL_LABELS[st] ?? st,
        journaled: journaledIds.has(r.id as string),
        approverLabel: rule ? ROLE_LABELS[rule.approverRole] : null,
      };
    }),
    canWrite: can(ctx.role, 'cash.write'),
    canApprove: can(ctx.role, 'cash.approve'),
    canScan: can(ctx.role, 'documents.write'),
    canExport: can(ctx.role, 'csv.export'),
  };
}
