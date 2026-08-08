/**
 * 自動仕訳エンジン（サーバー専用の純ヘルパー）。
 * 業務データ（売上・仕入・経費・小口現金・給与）から lib/accounting.ts のビルダーで
 * 仕訳候補を生成し、勘定科目コード→accounts.id を解決してDBへ書き込む。
 * page.tsx（サマリー集計）と actions.ts（プレビュー・確定）の双方から利用する。
 */

import { createClient } from '@/lib/supabase/server';
import {
  STD,
  buildSalesJournal,
  buildPurchaseJournal,
  buildExpenseJournal,
  buildPayrollJournal,
  validateJournalBalance,
  type JournalLineDraft,
  type TaxTreatment,
} from '@/lib/accounting';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type AutoSourceType = 'pos_sales' | 'purchase' | 'expense' | 'petty_cash' | 'payroll';

/** journal_entries.source_type の全候補のうち、このモジュール群が書き込みうる値（自動仕訳5種 + 銀行取引） */
export type JournalSourceType = AutoSourceType | 'bank';

export interface AccountRef {
  id: string;
  code: string;
  name: string;
}

export interface AccountMaps {
  byCode: Map<string, AccountRef>;
  byId: Map<string, AccountRef>;
}

export interface ResolvedLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  side: 'debit' | 'credit';
  amount: number;
  taxTreatment: TaxTreatment;
  memo?: string;
}

/** 候補（プレビュー表示用のシリアライズ可能な形） */
export interface JournalCandidateView {
  key: string;
  sourceType: AutoSourceType;
  sourceId: string;
  date: string;
  description: string;
  storeId: string | null;
  storeName: string | null;
  lines: { accountCode: string; accountName: string; side: 'debit' | 'credit'; amount: number; memo?: string }[];
  debit: number;
  credit: number;
  balanced: boolean;
  alreadyPosted: boolean;
  warning: string | null;
}

export interface CreateResult {
  ok: number;
  skipped: number;
  failed: { key: string; reason: string }[];
}

/** RPC/DB由来のエラーコードを日本語メッセージへ変換 */
export function friendlyJournalError(message: string): string {
  if (message.includes('PERIOD_CLOSED')) return 'この期間は月次締め済みのため計上できません';
  if (message.includes('FORBIDDEN')) return 'この操作はオーナー・本社管理者・本社経理のみ実行できます';
  if (message.includes('UNBALANCED')) return '借方と貸方の金額が一致しません';
  if (message.includes('INSUFFICIENT_LINES')) return '仕訳の明細が不足しています';
  if (message.includes('ENTRY_NOT_DRAFT') || message.includes('ENTRY_NOT_FOUND')) return '仕訳の状態が更新されました。ページを再読み込みしてください';
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return '権限がありません（オーナー・本社管理者・本社経理のみ仕訳を作成できます）';
  }
  return message;
}

/** 組織の勘定科目一覧をコード/ID双方でMap化して取得 */
export async function loadAccounts(supabase: Supabase, organizationId: string): Promise<AccountMaps> {
  const { data } = await supabase
    .from('accounts')
    .select('id, code, name')
    .eq('organization_id', organizationId)
    .eq('status', 'active');
  const byCode = new Map<string, AccountRef>();
  const byId = new Map<string, AccountRef>();
  for (const a of data ?? []) {
    const ref: AccountRef = { id: a.id as string, code: a.code as string, name: a.name as string };
    byCode.set(ref.code, ref);
    byId.set(ref.id, ref);
  }
  return { byCode, byId };
}

/** 費目（expense_accounts）→ 勘定科目コードの解決。未マッピングは雑費(599)にフォールバックし警告を返す */
export async function loadExpenseAccountCodeMap(
  supabase: Supabase,
  organizationId: string,
  accounts: AccountMaps
): Promise<Map<string, { code: string; name: string; mapped: boolean }>> {
  const { data } = await supabase
    .from('expense_accounts')
    .select('id, name, account_id')
    .eq('organization_id', organizationId)
    .eq('status', 'active');
  const map = new Map<string, { code: string; name: string; mapped: boolean }>();
  for (const ea of data ?? []) {
    const accountId = ea.account_id as string | null;
    const mappedAccount = accountId ? accounts.byId.get(accountId) : undefined;
    map.set(ea.id as string, {
      code: mappedAccount?.code ?? STD.misc,
      name: ea.name as string,
      mapped: !!mappedAccount,
    });
  }
  return map;
}

/** JournalLineDraft[]をaccounts.idへ解決する。未導入の科目コードがあれば missing に積む */
export function resolveLines(lines: JournalLineDraft[], accounts: AccountMaps): { lines: ResolvedLine[]; missing: string[] } {
  const missing: string[] = [];
  const resolved: ResolvedLine[] = [];
  for (const l of lines) {
    const acc = accounts.byCode.get(l.accountCode);
    if (!acc) {
      missing.push(l.accountCode);
      continue;
    }
    resolved.push({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      side: l.side,
      amount: l.amount,
      taxTreatment: l.taxTreatment,
      memo: l.memo,
    });
  }
  return { lines: resolved, missing };
}

/** JournalLineDraft[]をプレビュー表示用に解決（勘定科目未導入でも科目名なしで表示できるようにする） */
export function toPreviewLines(lines: JournalLineDraft[], accounts: AccountMaps) {
  return lines.map((l) => ({
    accountCode: l.accountCode,
    accountName: accounts.byCode.get(l.accountCode)?.name ?? `未導入科目(${l.accountCode})`,
    side: l.side,
    amount: l.amount,
    memo: l.memo,
  }));
}

export function buildCandidateView(input: {
  sourceType: AutoSourceType;
  sourceId: string;
  date: string;
  description: string;
  storeId: string | null;
  storeName: string | null;
  lines: JournalLineDraft[];
  accounts: AccountMaps;
  alreadyPosted: boolean;
  warning?: string | null;
}): JournalCandidateView {
  const balance = validateJournalBalance(input.lines);
  return {
    key: `${input.sourceType}:${input.sourceId}`,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    date: input.date,
    description: input.description,
    storeId: input.storeId,
    storeName: input.storeName,
    lines: toPreviewLines(input.lines, input.accounts),
    debit: balance.debit,
    credit: balance.credit,
    balanced: balance.balanced,
    alreadyPosted: input.alreadyPosted,
    warning: input.warning ?? null,
  };
}

/** 指定 source_type の source_id のうち、既に仕訳が存在するものの集合を返す */
export async function loadExistingSourceIds(
  supabase: Supabase,
  organizationId: string,
  sourceType: JournalSourceType,
  sourceIds: string[]
): Promise<Set<string>> {
  if (sourceIds.length === 0) return new Set();
  const CHUNK = 300;
  const result = new Set<string>();
  for (let i = 0; i < sourceIds.length; i += CHUNK) {
    const chunk = sourceIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from('journal_entries')
      .select('source_id')
      .eq('organization_id', organizationId)
      .eq('source_type', sourceType)
      .in('source_id', chunk);
    for (const r of data ?? []) result.add(r.source_id as string);
  }
  return result;
}

/** 下書き仕訳をDBへ作成し、post指定時はRPCで確定する */
export async function insertJournalEntry(
  supabase: Supabase,
  params: {
    organizationId: string;
    storeId: string | null;
    entryDate: string;
    description: string;
    sourceType: JournalSourceType;
    sourceId: string;
    lines: ResolvedLine[];
    userId: string;
    post: boolean;
  }
): Promise<{ entryId: string; posted: boolean }> {
  const { data: entry, error } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: params.organizationId,
      store_id: params.storeId,
      entry_date: params.entryDate,
      description: params.description,
      source_type: params.sourceType,
      source_id: params.sourceId,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select('id')
    .single();
  if (error || !entry) throw new Error(friendlyJournalError(error?.message ?? '仕訳の作成に失敗しました'));

  const { error: lineErr } = await supabase.from('journal_entry_lines').insert(
    params.lines.map((l, i) => ({
      organization_id: params.organizationId,
      entry_id: entry.id as string,
      line_no: i + 1,
      account_id: l.accountId,
      side: l.side,
      amount: l.amount,
      tax_treatment: l.taxTreatment,
      store_id: params.storeId,
      memo: l.memo ?? null,
    }))
  );
  if (lineErr) {
    await supabase.from('journal_entries').delete().eq('id', entry.id as string);
    throw new Error(friendlyJournalError(lineErr.message));
  }

  if (params.post) {
    const { error: postErr } = await supabase.rpc('post_journal_entry', { p_entry_id: entry.id as string });
    if (postErr) throw new Error(friendlyJournalError(postErr.message));
    return { entryId: entry.id as string, posted: true };
  }
  return { entryId: entry.id as string, posted: false };
}

// -------------------------------------------------------------
// 売上（POS）: 営業日×店舗ごとに現金/キャッシュレス×標準/軽減税率を集計
// -------------------------------------------------------------

export interface DailySalesBucket {
  date: string;
  storeId: string;
  cashStandard: number;
  cashReduced: number;
  cashlessStandard: number;
  cashlessReduced: number;
}

/** payments を order_items のタグ率で按分し、営業日×店舗別の現金/キャッシュレス×税率区分バケットを作る */
export async function aggregateDailySales(
  supabase: Supabase,
  organizationId: string,
  storeIds: string[],
  from: string,
  to: string
): Promise<DailySalesBucket[]> {
  if (storeIds.length === 0) return [];
  const { data: payments } = await supabase
    .from('payments')
    .select('id, order_id, store_id, method, amount, business_date')
    .eq('organization_id', organizationId)
    .in('store_id', storeIds)
    .eq('status', 'completed')
    .gte('business_date', from)
    .lte('business_date', to)
    .limit(8000);
  const pays = payments ?? [];
  if (pays.length === 0) return [];

  const orderIds = [...new Set(pays.map((p) => p.order_id as string))];
  const totalsByOrder = new Map<string, { standard: number; reduced: number }>();
  const CHUNK = 300;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const { data: items } = await supabase
      .from('order_items')
      .select('order_id, tax_rate, line_total')
      .in('order_id', chunk)
      .eq('status', 'active');
    for (const it of items ?? []) {
      const orderId = it.order_id as string;
      const bucket = totalsByOrder.get(orderId) ?? { standard: 0, reduced: 0 };
      const rate = Number(it.tax_rate);
      if (rate > 0 && rate <= 9) bucket.reduced += it.line_total as number;
      else bucket.standard += it.line_total as number;
      totalsByOrder.set(orderId, bucket);
    }
  }

  const buckets = new Map<string, DailySalesBucket>();
  for (const p of pays) {
    const date = p.business_date as string;
    const storeId = p.store_id as string;
    const key = `${storeId}:${date}`;
    const bucket = buckets.get(key) ?? { date, storeId, cashStandard: 0, cashReduced: 0, cashlessStandard: 0, cashlessReduced: 0 };
    const amount = p.amount as number;
    const totals = totalsByOrder.get(p.order_id as string);
    let std = amount;
    let reduced = 0;
    if (totals && totals.standard + totals.reduced > 0) {
      const ratio = totals.standard / (totals.standard + totals.reduced);
      std = Math.round(amount * ratio);
      reduced = amount - std;
    }
    if (p.method === 'cash') {
      bucket.cashStandard += std;
      bucket.cashReduced += reduced;
    } else {
      bucket.cashlessStandard += std;
      bucket.cashlessReduced += reduced;
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => (a.date === b.date ? a.storeId.localeCompare(b.storeId) : a.date.localeCompare(b.date)));
}

export function salesJournalLines(bucket: DailySalesBucket): JournalLineDraft[] {
  return buildSalesJournal({
    cashSalesStandard: bucket.cashStandard,
    cashSalesReduced: bucket.cashReduced,
    cashlessSalesStandard: bucket.cashlessStandard,
    cashlessSalesReduced: bucket.cashlessReduced,
  });
}

// -------------------------------------------------------------
// 仕入（invoices）
// -------------------------------------------------------------

export const PURCHASE_JOURNAL_STATUSES = ['approved', 'scheduled', 'paid'] as const;

export interface PendingInvoiceRow {
  id: string;
  storeId: string | null;
  storeName: string | null;
  vendorName: string;
  issueDate: string | null;
  amount: number;
  documentId: string | null;
}

export function purchaseJournalLines(row: PendingInvoiceRow): JournalLineDraft[] {
  return buildPurchaseJournal({ amount: row.amount, vendorName: row.vendorName });
}

function storeNameOf(row: unknown): string | null {
  const s = row as { name?: string } | null;
  return s?.name ?? null;
}

/** 仕訳計上対象の請求書（status in approved/scheduled/paid）を取得。idsを渡すとその範囲に限定する */
export async function fetchPendingInvoices(supabase: Supabase, organizationId: string, ids?: string[]): Promise<PendingInvoiceRow[]> {
  let q = supabase
    .from('invoices')
    .select('id, store_id, vendor_name, issue_date, amount, document_id, stores(name)')
    .eq('organization_id', organizationId)
    .in('status', [...PURCHASE_JOURNAL_STATUSES]);
  if (ids && ids.length > 0) q = q.in('id', ids);
  const { data } = await q.order('issue_date', { ascending: false }).limit(500);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    storeId: r.store_id as string | null,
    storeName: storeNameOf(r.stores),
    vendorName: r.vendor_name as string,
    issueDate: r.issue_date as string | null,
    amount: r.amount as number,
    documentId: r.document_id as string | null,
  }));
}

// -------------------------------------------------------------
// 経費（expenses）
// -------------------------------------------------------------

export interface PendingExpenseRow {
  id: string;
  storeId: string;
  storeName: string | null;
  amount: number;
  paidVia: 'petty_cash' | 'register' | 'bank' | 'personal';
  vendorName: string | null;
  memo: string | null;
  businessDate: string;
  expenseAccountId: string | null;
}

export function expenseJournalLines(
  row: PendingExpenseRow,
  expenseAccountCodeMap: Map<string, { code: string; name: string; mapped: boolean }>
): { lines: JournalLineDraft[]; warning: string | null } {
  const mapping = row.expenseAccountId ? expenseAccountCodeMap.get(row.expenseAccountId) : undefined;
  const code = mapping?.code ?? STD.misc;
  const warning = !mapping || !mapping.mapped
    ? `費目「${mapping?.name ?? '未設定'}」に勘定科目が未設定のため雑費(599)で計上します`
    : null;
  const memo = row.vendorName?.trim() || row.memo?.trim() || undefined;
  return {
    lines: buildExpenseJournal({ amount: row.amount, expenseAccountCode: code, paidVia: row.paidVia, memo }),
    warning,
  };
}

/** 仕訳計上対象の経費（approval_status=approved・status=active）を取得。idsを渡すとその範囲に限定する */
export async function fetchPendingExpenses(supabase: Supabase, organizationId: string, ids?: string[]): Promise<PendingExpenseRow[]> {
  let q = supabase
    .from('expenses')
    .select('id, store_id, amount, paid_via, vendor_name, memo, business_date, expense_account_id, stores(name)')
    .eq('organization_id', organizationId)
    .eq('approval_status', 'approved')
    .eq('status', 'active');
  if (ids && ids.length > 0) q = q.in('id', ids);
  const { data } = await q.order('business_date', { ascending: false }).limit(500);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    storeId: r.store_id as string,
    storeName: storeNameOf(r.stores),
    amount: r.amount as number,
    paidVia: r.paid_via as PendingExpenseRow['paidVia'],
    vendorName: r.vendor_name as string | null,
    memo: r.memo as string | null,
    businessDate: r.business_date as string,
    expenseAccountId: r.expense_account_id as string | null,
  }));
}

// -------------------------------------------------------------
// 小口現金（cash_transactions petty_in / petty_out）
// -------------------------------------------------------------

export interface PendingPettyCashRow {
  id: string;
  storeId: string;
  storeName: string | null;
  kind: 'petty_in' | 'petty_out';
  amount: number;
  purpose: string | null;
  businessDate: string;
  expenseAccountId: string | null;
}

export function pettyCashJournalLines(
  row: PendingPettyCashRow,
  expenseAccountCodeMap: Map<string, { code: string; name: string; mapped: boolean }>
): { lines: JournalLineDraft[]; warning: string | null } {
  if (row.kind === 'petty_in') {
    return {
      lines: [
        { accountCode: STD.pettyCash, side: 'debit', amount: row.amount, taxTreatment: 'out_of_scope', memo: row.purpose ?? '小口現金入金' },
        { accountCode: STD.cash, side: 'credit', amount: row.amount, taxTreatment: 'out_of_scope', memo: '現金からの補充' },
      ],
      warning: null,
    };
  }
  const mapping = row.expenseAccountId ? expenseAccountCodeMap.get(row.expenseAccountId) : undefined;
  const code = mapping?.code ?? STD.misc;
  const warning = !mapping || !mapping.mapped
    ? `費目「${mapping?.name ?? '未設定'}」に勘定科目が未設定のため雑費(599)で計上します`
    : null;
  return {
    lines: buildExpenseJournal({ amount: row.amount, expenseAccountCode: code, paidVia: 'petty_cash', memo: row.purpose ?? undefined }),
    warning,
  };
}

/** 仕訳計上対象の小口現金（kind in petty_in/petty_out・approval_status=approved・status=active）を取得 */
export async function fetchPendingPettyCash(supabase: Supabase, organizationId: string, ids?: string[]): Promise<PendingPettyCashRow[]> {
  let q = supabase
    .from('cash_transactions')
    .select('id, store_id, kind, amount, purpose, business_date, expense_account_id, stores(name)')
    .eq('organization_id', organizationId)
    .in('kind', ['petty_in', 'petty_out'])
    .eq('approval_status', 'approved')
    .eq('status', 'active');
  if (ids && ids.length > 0) q = q.in('id', ids);
  const { data } = await q.order('business_date', { ascending: false }).limit(500);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    storeId: r.store_id as string,
    storeName: storeNameOf(r.stores),
    kind: r.kind as PendingPettyCashRow['kind'],
    amount: r.amount as number,
    purpose: r.purpose as string | null,
    businessDate: r.business_date as string,
    expenseAccountId: r.expense_account_id as string | null,
  }));
}

// -------------------------------------------------------------
// 給与（payroll_runs）
// -------------------------------------------------------------

export interface PendingPayrollRow {
  id: string;
  storeId: string | null;
  storeName: string | null;
  title: string;
  periodStart: string;
  periodEnd: string;
  grossTotal: number;
}

export function payrollJournalLines(row: PendingPayrollRow): JournalLineDraft[] {
  return buildPayrollJournal({ grossTotal: row.grossTotal, periodLabel: `${row.title} ${row.periodStart}〜${row.periodEnd}` });
}

/** 仕訳計上対象の給与確定（status=approved）を、payroll_itemsのgross_total合計込みで取得 */
export async function fetchPendingPayrollRuns(supabase: Supabase, organizationId: string, ids?: string[]): Promise<PendingPayrollRow[]> {
  let q = supabase
    .from('payroll_runs')
    .select('id, store_id, title, period_start, period_end, stores(name)')
    .eq('organization_id', organizationId)
    .eq('status', 'approved');
  if (ids && ids.length > 0) q = q.in('id', ids);
  const { data: runs } = await q.order('period_end', { ascending: false }).limit(200);
  const runRows = runs ?? [];
  if (runRows.length === 0) return [];

  const runIds = runRows.map((r) => r.id as string);
  const { data: items } = await supabase.from('payroll_items').select('payroll_run_id, gross_total').in('payroll_run_id', runIds);
  const grossByRun = new Map<string, number>();
  for (const it of items ?? []) {
    const rid = it.payroll_run_id as string;
    grossByRun.set(rid, (grossByRun.get(rid) ?? 0) + (it.gross_total as number));
  }

  return runRows.map((r) => ({
    id: r.id as string,
    storeId: r.store_id as string | null,
    storeName: storeNameOf(r.stores),
    title: r.title as string,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    grossTotal: grossByRun.get(r.id as string) ?? 0,
  }));
}
