import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { todayJst } from '@/lib/format';
import {
  aggregateTrialBalance,
  aggregateTrialBalanceWithOpening,
  buildOperatingStatement,
  buildBalanceSheet,
  type AccountCategory,
  type AccountInfo,
  type PostedLine,
  type TaxTreatment,
  type TrialBalanceRow,
  type TrialBalanceRowWithOpening,
  type OperatingStatement,
  type BalanceSheet,
} from '@/lib/accounting';
import {
  ACCOUNT_CATEGORY_ORDER,
  JOURNAL_STATUS_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  type AssetStatus,
  type DepreciationMethod,
  type JournalStatus,
  type SourceType,
  type SubType,
} from '@/components/accounting/labels';
import { computeOpeningBalance, buildLedgerRows, resolveCounterLabel, type LedgerEntryLine, type LedgerRow } from '@/components/accounting/ledger';
import type { JournalEntryRow, JournalLineRow } from '@/components/accounting/journal-panel';
import {
  aggregateDailyRefunds,
  aggregateDailySales,
  fetchPendingExpenses,
  fetchPendingInvoices,
  fetchPendingPayrollRuns,
  fetchPendingPettyCash,
  loadAccounts,
  loadExistingSourceIds,
} from '@/app/app/accounting/auto/engine';
import { loadReceivablePayableBalances } from '@/app/app/accounting/banks/balances';
import {
  addDays,
  defaultAutoPeriod,
  firstDayOfMonth,
  monthRange,
  monthsInRange,
  shiftMonth,
  withRunningBalance,
  LEDGER_TABS,
  LEDGER_TAB_SUBTYPE,
  type LedgerTab,
} from '@/lib/accounting-pages';

/**
 * 会計の各画面（Web の /app/accounting/*）の読み込み。Web の page.tsx と iPad ネイティブ（lib/native-modules/accounting.ts）で同じ
 * （2026-10-24 22:05 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）。
 * 権限（requirePermission('csv.export')・requireFeature('accounting')）は呼び出す側で確かめる。
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 会計の画面の読み込みに要る ctx（requireFeature の戻り値・アプリの API の ctx のどちらでも） */
export type AccountingCtx = Pick<SessionContext, 'isHq' | 'stores' | 'currentStore' | 'role'> & { organizationId: string };

/** 店舗の絞り込み（未指定なら：本社系は全店舗、店舗ユーザーは選択中の店舗） */
function resolveStoreFilter(ctx: AccountingCtx, store: string | undefined): string {
  return store || (ctx.isHq ? '' : (ctx.currentStore?.id ?? ''));
}

// -------------------------------------------------------------
// 仕訳（/app/accounting）
// -------------------------------------------------------------

export const JOURNAL_PAGE_SIZE = 50;

export interface JournalPageParams {
  from?: string;
  to?: string;
  status?: string;
  source_type?: string;
  source_id?: string;
  store?: string;
  page?: string;
}

export interface JournalAccountOption {
  id: string;
  code: string;
  name: string;
  defaultTaxTreatment: TaxTreatment;
}

export interface JournalPageData {
  today: string;
  from: string;
  to: string;
  status: JournalStatus | '';
  sourceType: SourceType | '';
  sourceId: string;
  storeId: string;
  page: number;
  accounts: JournalAccountOption[];
  rows: JournalEntryRow[];
  linesByEntry: Record<string, JournalLineRow[]>;
  count: number;
  rangeFrom: number;
  totalPages: number;
}

export async function loadJournalPage(supabase: Supabase, ctx: AccountingCtx, sp: JournalPageParams): Promise<JournalPageData> {
  const today = todayJst();
  const from = sp.from || firstDayOfMonth(today);
  const to = sp.to || today;
  const status = JOURNAL_STATUS_OPTIONS.includes(sp.status as JournalStatus) ? (sp.status as JournalStatus) : '';
  const sourceType = SOURCE_TYPE_OPTIONS.includes(sp.source_type as SourceType) ? (sp.source_type as SourceType) : '';
  const sourceId = sp.source_id || '';
  const storeId = resolveStoreFilter(ctx, sp.store);
  const page = Math.max(1, Number(sp.page) || 1);

  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name, default_tax_treatment')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order')
    .order('code');
  const accounts = (accountsData ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    defaultTaxTreatment: a.default_tax_treatment as TaxTreatment,
  }));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  let query = supabase
    .from('journal_entries')
    .select('id, entry_no, entry_date, description, status, source_type, source_id, void_reason, store_id, stores(name)', { count: 'exact' })
    .eq('organization_id', ctx.organizationId)
    .gte('entry_date', from)
    .lte('entry_date', to);
  if (status) query = query.eq('status', status);
  if (sourceType) query = query.eq('source_type', sourceType);
  if (sourceId) query = query.eq('source_id', sourceId);
  if (storeId) query = query.eq('store_id', storeId);
  query = query.order('entry_date', { ascending: false }).order('entry_no', { ascending: false });

  const rangeFrom = (page - 1) * JOURNAL_PAGE_SIZE;
  const { data: entriesData, count } = await query.range(rangeFrom, rangeFrom + JOURNAL_PAGE_SIZE - 1);
  const entries = entriesData ?? [];
  const entryIds = entries.map((e) => e.id as string);

  let linesByEntry: Record<string, JournalLineRow[]> = {};
  if (entryIds.length > 0) {
    const { data: linesData } = await supabase
      .from('journal_entry_lines')
      .select('entry_id, account_id, side, amount, tax_treatment, memo')
      .in('entry_id', entryIds)
      .order('line_no');
    linesByEntry = {};
    for (const l of linesData ?? []) {
      const acc = accountById.get(l.account_id as string);
      const list = linesByEntry[l.entry_id as string] ?? [];
      list.push({
        accountId: l.account_id as string,
        accountCode: acc?.code ?? '',
        accountName: acc?.name ?? '(削除済み科目)',
        side: l.side as 'debit' | 'credit',
        amount: l.amount as number,
        taxTreatment: l.tax_treatment as TaxTreatment,
        memo: l.memo as string | null,
      });
      linesByEntry[l.entry_id as string] = list;
    }
  }

  const rows: JournalEntryRow[] = entries.map((e) => {
    const lines = linesByEntry[e.id as string] ?? [];
    const debitTotal = lines.filter((l) => l.side === 'debit').reduce((sum, l) => sum + l.amount, 0);
    return {
      id: e.id as string,
      entryNo: e.entry_no as number,
      entryDate: e.entry_date as string,
      description: e.description as string,
      status: e.status as JournalStatus,
      sourceType: e.source_type as SourceType,
      sourceId: e.source_id as string | null,
      storeId: e.store_id as string | null,
      storeName: (e.stores as unknown as { name: string } | null)?.name ?? null,
      voidReason: e.void_reason as string | null,
      debitTotal,
    };
  });

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / JOURNAL_PAGE_SIZE));
  return { today, from, to, status, sourceType, sourceId, storeId, page, accounts, rows, linesByEntry, count: count ?? 0, rangeFrom, totalPages };
}

// -------------------------------------------------------------
// 帳簿（/app/accounting/ledger）
// -------------------------------------------------------------

export interface LedgerAccountOption {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
  subType: string | null;
}

export interface LedgerJournalEntry {
  id: string;
  entryNo: number;
  entryDate: string;
  description: string;
  lines: { accountCode: string; accountName: string; side: 'debit' | 'credit'; amount: number; taxTreatment: TaxTreatment; memo: string | null }[];
}

export interface LedgerPageData {
  tab: LedgerTab;
  from: string;
  to: string;
  storeId: string;
  /** CSV出力（/app/accounting/ledger/export）のクエリ */
  exportQuery: string;
  /** tab=journal のとき */
  journalEntries: LedgerJournalEntry[] | null;
  /** tab≠journal のとき */
  subType: SubType | undefined;
  candidateAccounts: LedgerAccountOption[];
  selectedAccountId: string | null;
  ledger: { account: LedgerAccountOption; opening: number; rows: LedgerRow[] } | null;
}

export async function loadLedgerPage(
  supabase: Supabase,
  ctx: AccountingCtx,
  sp: { tab?: string; from?: string; to?: string; store?: string; account?: string }
): Promise<LedgerPageData> {
  const tab: LedgerTab = LEDGER_TABS.some((t) => t.key === sp.tab) ? (sp.tab as LedgerTab) : 'journal';
  const today = todayJst();
  const from = sp.from || firstDayOfMonth(today);
  const to = sp.to || today;
  const storeId = resolveStoreFilter(ctx, sp.store);

  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name, category, sub_type')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order')
    .order('code');
  const accounts: LedgerAccountOption[] = (accountsData ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    category: a.category as AccountCategory,
    subType: a.sub_type as string | null,
  }));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const exportParams = new URLSearchParams({ type: tab, from, to });
  if (storeId) exportParams.set('store', storeId);

  const base = { tab, from, to, storeId };

  if (tab === 'journal') {
    let query = supabase
      .from('journal_entries')
      .select('id, entry_no, entry_date, description')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'posted')
      .gte('entry_date', from)
      .lte('entry_date', to);
    if (storeId) query = query.eq('store_id', storeId);
    const { data: entries } = await query.order('entry_date', { ascending: false }).order('entry_no', { ascending: false }).limit(1000);
    const list = entries ?? [];
    const entryIds = list.map((e) => e.id as string);

    let linesByEntry = new Map<string, LedgerJournalEntry['lines']>();
    if (entryIds.length > 0) {
      const { data: linesData } = await supabase
        .from('journal_entry_lines')
        .select('entry_id, account_id, side, amount, tax_treatment, memo')
        .in('entry_id', entryIds)
        .order('line_no');
      linesByEntry = new Map();
      for (const l of linesData ?? []) {
        const acc = accountById.get(l.account_id as string);
        const arr = linesByEntry.get(l.entry_id as string) ?? [];
        arr.push({
          accountCode: acc?.code ?? '',
          accountName: acc?.name ?? '(削除済み科目)',
          side: l.side as 'debit' | 'credit',
          amount: l.amount as number,
          taxTreatment: l.tax_treatment as TaxTreatment,
          memo: l.memo as string | null,
        });
        linesByEntry.set(l.entry_id as string, arr);
      }
    }

    const journalEntries: LedgerJournalEntry[] = list.map((e) => ({
      id: e.id as string,
      entryNo: e.entry_no as number,
      entryDate: e.entry_date as string,
      description: e.description as string,
      lines: linesByEntry.get(e.id as string) ?? [],
    }));

    return {
      ...base,
      exportQuery: exportParams.toString(),
      journalEntries,
      subType: undefined,
      candidateAccounts: [],
      selectedAccountId: null,
      ledger: null,
    };
  }

  const subType = LEDGER_TAB_SUBTYPE[tab];
  const candidateAccounts = subType ? accounts.filter((a) => a.subType === subType) : accounts;
  const selectedAccountId =
    sp.account && candidateAccounts.some((a) => a.id === sp.account) ? sp.account : (candidateAccounts[0]?.id ?? null);

  if (!selectedAccountId) {
    return { ...base, exportQuery: exportParams.toString(), journalEntries: null, subType, candidateAccounts, selectedAccountId, ledger: null };
  }

  exportParams.set('account', selectedAccountId);
  const account = accountById.get(selectedAccountId)!;

  const buildLineQuery = () => {
    let q = supabase
      .from('journal_entry_lines')
      .select(
        'id, entry_id, line_no, side, amount, memo, journal_entries!inner(entry_date, description, status, store_id, source_type, source_id, stores(name))'
      )
      .eq('account_id', selectedAccountId)
      .eq('organization_id', ctx.organizationId)
      .eq('journal_entries.status', 'posted');
    if (storeId) q = q.eq('journal_entries.store_id', storeId);
    return q;
  };

  const [{ data: beforeLines }, { data: periodLinesRaw }] = await Promise.all([
    buildLineQuery().lt('journal_entries.entry_date', from),
    buildLineQuery()
      .gte('journal_entries.entry_date', from)
      .lte('journal_entries.entry_date', to)
      .order('entry_date', { foreignTable: 'journal_entries', ascending: true })
      .order('line_no', { ascending: true }),
  ]);

  const opening = computeOpeningBalance(
    (beforeLines ?? []).map((l) => ({ side: l.side as 'debit' | 'credit', amount: l.amount as number })),
    account.category
  );

  const periodEntryIds = [...new Set((periodLinesRaw ?? []).map((l) => l.entry_id as string))];
  let counterNamesByEntry = new Map<string, string[]>();
  if (periodEntryIds.length > 0) {
    const { data: allLines } = await supabase.from('journal_entry_lines').select('entry_id, account_id').in('entry_id', periodEntryIds);
    const byEntry = new Map<string, string[]>();
    for (const l of allLines ?? []) {
      if ((l.account_id as string) === selectedAccountId) continue;
      const acc = accountById.get(l.account_id as string);
      const arr = byEntry.get(l.entry_id as string) ?? [];
      if (acc) arr.push(acc.name);
      byEntry.set(l.entry_id as string, arr);
    }
    counterNamesByEntry = byEntry;
  }

  const periodLines: LedgerEntryLine[] = (periodLinesRaw ?? []).map((l) => {
    const je = l.journal_entries as unknown as {
      entry_date: string;
      description: string;
      source_type: SourceType;
      source_id: string | null;
      stores: { name: string } | null;
    };
    return {
      entryId: l.entry_id as string,
      entryDate: je.entry_date,
      description: je.description,
      side: l.side as 'debit' | 'credit',
      amount: l.amount as number,
      memo: l.memo as string | null,
      storeName: je.stores?.name ?? null,
      sourceType: je.source_type,
      sourceId: je.source_id,
    };
  });

  const rows = buildLedgerRows(periodLines, account.category, opening, (entryId) =>
    resolveCounterLabel(counterNamesByEntry.get(entryId) ?? [])
  );

  return {
    ...base,
    exportQuery: exportParams.toString(),
    journalEntries: null,
    subType,
    candidateAccounts,
    selectedAccountId,
    ledger: { account, opening, rows },
  };
}

// -------------------------------------------------------------
// 財務レポート（/app/accounting/statements）
// -------------------------------------------------------------

const BS_CATEGORIES = new Set(['asset', 'liability', 'equity']);

export interface StatementsPageData {
  from: string;
  to: string;
  storeId: string;
  storeName: string | null;
  tbOpening: TrialBalanceRowWithOpening[];
  groupedTb: { category: AccountCategory; rows: TrialBalanceRowWithOpening[] }[];
  opStatement: OperatingStatement;
  opStatementPrevMonth: OperatingStatement;
  opStatementLastYear: OperatingStatement;
  months: string[];
  showMonthlyBreakdown: boolean;
  monthlyStatements: OperatingStatement[];
  prevMonthYm: string;
  lastYearYm: string;
  bs: BalanceSheet;
  debitGrandTotal: number;
  creditGrandTotal: number;
  trialBalanced: boolean;
  cashBankBalance: number;
  receivableBalance: number;
  payableBalance: number;
  /** CSV出力（/app/accounting/statements/export）のクエリ */
  exportQuery: string;
}

export async function loadStatementsPage(
  supabase: Supabase,
  ctx: AccountingCtx,
  sp: { from?: string; to?: string; store?: string }
): Promise<StatementsPageData> {
  const today = todayJst();
  const from = sp.from || firstDayOfMonth(today);
  const to = sp.to || today;
  const storeId = resolveStoreFilter(ctx, sp.store);
  const storeName = storeId ? (ctx.stores.find((s) => s.id === storeId)?.name ?? null) : null;

  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name, category, sub_type')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order')
    .order('code');
  const accountInfos: AccountInfo[] = (accountsData ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    category: a.category as AccountInfo['category'],
  }));
  const subTypeById = new Map((accountsData ?? []).map((a) => [a.id as string, a.sub_type as string | null]));

  /** posted・店舗絞込・期間指定で仕訳明細を取得する（このページ全体で使い回す） */
  const fetchPostedLines = async (rangeFrom: string, rangeTo: string): Promise<PostedLine[]> => {
    let q = supabase
      .from('journal_entry_lines')
      .select('account_id, side, amount, journal_entries!inner(entry_date, status, store_id)')
      .eq('organization_id', ctx.organizationId)
      .eq('journal_entries.status', 'posted')
      .gte('journal_entries.entry_date', rangeFrom)
      .lte('journal_entries.entry_date', rangeTo);
    if (storeId) q = q.eq('journal_entries.store_id', storeId);
    const { data } = await q.limit(20000);
    return (data ?? []).map((l) => ({
      accountId: l.account_id as string,
      side: l.side as 'debit' | 'credit',
      amount: l.amount as number,
    }));
  };
  const fetchOperatingStatement = async (rangeFrom: string, rangeTo: string): Promise<OperatingStatement> =>
    buildOperatingStatement(aggregateTrialBalance(await fetchPostedLines(rangeFrom, rangeTo), accountInfos));

  // 期首残高付き試算表: 期間開始前の全確定仕訳（期首）と期間内の確定仕訳（当期）を別々に集計する
  const baseMonth = from.slice(0, 7);
  const prevMonthYm = shiftMonth(baseMonth, -1);
  const lastYearYm = shiftMonth(baseMonth, -12);
  const prevMonthRange = monthRange(prevMonthYm);
  const lastYearRange = monthRange(lastYearYm);
  const months = monthsInRange(from, to);
  const showMonthlyBreakdown = months.length >= 2 && months.length <= 12;

  const [openingPostedLines, periodPostedLines, opStatementPrevMonth, opStatementLastYear, monthlyStatements] = await Promise.all([
    fetchPostedLines('1900-01-01', addDays(from, -1)),
    fetchPostedLines(from, to),
    fetchOperatingStatement(prevMonthRange.from, prevMonthRange.to),
    fetchOperatingStatement(lastYearRange.from, lastYearRange.to),
    showMonthlyBreakdown
      ? Promise.all(months.map((ym) => fetchOperatingStatement(monthRange(ym).from, monthRange(ym).to)))
      : Promise.resolve([] as OperatingStatement[]),
  ]);

  const tbOpening = aggregateTrialBalanceWithOpening(openingPostedLines, periodPostedLines, accountInfos);

  // P/L（段階損益）は当期の期中増減（期首残高を含まない）で計算する
  const tbForPL: TrialBalanceRow[] = tbOpening.map((r) => ({ account: r.account, debitTotal: r.debitTotal, creditTotal: r.creditTotal, balance: r.balance }));
  const opStatement = buildOperatingStatement(tbForPL);

  // B/S は資産・負債・純資産のみ期末（期首＋期中）の累計残高を使い、当期純利益の算出に使う収益・費用は期中のみで計算する
  const tbForBS: TrialBalanceRow[] = tbOpening.map((r) => ({
    account: r.account,
    debitTotal: r.debitTotal,
    creditTotal: r.creditTotal,
    balance: BS_CATEGORIES.has(r.account.category) ? r.closingBalance : r.balance,
  }));
  const bs = buildBalanceSheet(tbForBS);

  const debitGrandTotal = tbOpening.reduce((sum, r) => sum + r.debitTotal, 0);
  const creditGrandTotal = tbOpening.reduce((sum, r) => sum + r.creditTotal, 0);
  const trialBalanced = debitGrandTotal === creditGrandTotal;

  const cashBankBalance = tbOpening
    .filter((r) => ['cash', 'bank'].includes(subTypeById.get(r.account.id) ?? ''))
    .reduce((s, r) => s + r.closingBalance, 0);
  const receivableBalance = tbOpening.filter((r) => subTypeById.get(r.account.id) === 'receivable').reduce((s, r) => s + r.closingBalance, 0);
  const payableBalance = tbOpening.filter((r) => subTypeById.get(r.account.id) === 'payable').reduce((s, r) => s + r.closingBalance, 0);

  const groupedTb = ACCOUNT_CATEGORY_ORDER.map((category) => ({
    category,
    rows: tbOpening.filter((r) => r.account.category === category),
  })).filter((g) => g.rows.length > 0);

  const exportParams = new URLSearchParams({ from, to });
  if (storeId) exportParams.set('store', storeId);

  return {
    from,
    to,
    storeId,
    storeName,
    tbOpening,
    groupedTb,
    opStatement,
    opStatementPrevMonth,
    opStatementLastYear,
    months,
    showMonthlyBreakdown,
    monthlyStatements,
    prevMonthYm,
    lastYearYm,
    bs,
    debitGrandTotal,
    creditGrandTotal,
    trialBalanced,
    cashBankBalance,
    receivableBalance,
    payableBalance,
    exportQuery: exportParams.toString(),
  };
}

// -------------------------------------------------------------
// 銀行口座（/app/accounting/banks・/app/accounting/banks/[id]）
// -------------------------------------------------------------

export interface BankAccountOptionRow {
  id: string;
  code: string;
  name: string;
}

export interface BankAccountListRow {
  id: string;
  bankName: string;
  branchName: string | null;
  accountType: string;
  accountLast4: string | null;
  holderName: string | null;
  storeName: string | null;
  account: { code: string; name: string } | null;
}

export interface BankAccountsPageData {
  /** 勘定科目が1つでも導入されているか（無ければ標準科目の導入を案内する） */
  accountsInstalled: boolean;
  accountOptions: BankAccountOptionRow[];
  bankAccounts: BankAccountListRow[];
}

/** sub_type='bank'の全科目（複数口座で別科目を使う運用にも対応）。無ければ普通預金(110) */
async function loadBankLinkOptions(supabase: Supabase, organizationId: string, fallback: BankAccountOptionRow[]): Promise<BankAccountOptionRow[]> {
  const { data: subTypeBankAccounts } = await supabase
    .from('accounts')
    .select('id, code, name')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .eq('sub_type', 'bank')
    .order('code');
  return (subTypeBankAccounts ?? []).length > 0
    ? (subTypeBankAccounts ?? []).map((a) => ({ id: a.id as string, code: a.code as string, name: a.name as string }))
    : fallback;
}

export async function loadBankAccountsPage(supabase: Supabase, ctx: AccountingCtx): Promise<BankAccountsPageData> {
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const bankAccountOptions = [...accounts.byCode.values()]
    .filter((a) => a.code === '110')
    .map((a) => ({ id: a.id, code: a.code, name: a.name }));
  const accountOptions = await loadBankLinkOptions(supabase, ctx.organizationId, bankAccountOptions);

  const { data: bankAccounts } = await supabase
    .from('bank_accounts')
    .select('id, bank_name, branch_name, account_type, account_last4, holder_name, store_id, stores(name), accounts(code, name)')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  return {
    accountsInstalled: accounts.byCode.size > 0,
    accountOptions,
    bankAccounts: (bankAccounts ?? []).map((b) => ({
      id: b.id as string,
      bankName: b.bank_name as string,
      branchName: b.branch_name as string | null,
      accountType: b.account_type as string,
      accountLast4: b.account_last4 as string | null,
      holderName: b.holder_name as string | null,
      storeName: (b.stores as unknown as { name: string } | null)?.name ?? null,
      account: b.accounts as unknown as { code: string; name: string } | null,
    })),
  };
}

export interface BankTxDisplayRow {
  id: string;
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
  runningBalance: number;
  journalEntryId: string | null;
}

export interface BankDetailAccountOption {
  id: string;
  code: string;
  name: string;
  subType?: string | null;
}

export interface BankAccountDetailData {
  bankAccount: {
    id: string;
    bankName: string;
    branchName: string | null;
    accountType: 'ordinary' | 'checking' | 'savings';
    accountLast4: string | null;
    holderName: string | null;
    storeId: string | null;
    accountId: string | null;
    storeName: string | null;
    linkedAccount: { code: string; name: string } | null;
  };
  /** 登録順（古い順）で残高を計算した取引 */
  rows: BankTxDisplayRow[];
  /** 新しい取引が上（表示用） */
  displayRows: BankTxDisplayRow[];
  balance: number;
  accountOptions: BankDetailAccountOption[];
  editAccountOptions: BankAccountOptionRow[];
  receivableTotal: number;
  payableTotal: number;
}

/** 口座が無い（他社・削除済み）ときは null */
export async function loadBankAccountDetail(supabase: Supabase, ctx: AccountingCtx, id: string): Promise<BankAccountDetailData | null> {
  const { data: bankAccount } = await supabase
    .from('bank_accounts')
    .select('id, bank_name, branch_name, account_type, account_last4, holder_name, store_id, account_id, stores(name), accounts(code, name)')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .maybeSingle();
  if (!bankAccount) return null;

  const { data: txData } = await supabase
    .from('bank_transactions')
    .select('id, transacted_on, description, deposit, withdrawal, journal_entry_id')
    .eq('bank_account_id', id)
    .order('transacted_on', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(2000);

  const rows: BankTxDisplayRow[] = withRunningBalance(
    (txData ?? []).map((t) => ({
      id: t.id as string,
      date: t.transacted_on as string,
      description: t.description as string,
      deposit: t.deposit as number,
      withdrawal: t.withdrawal as number,
      journalEntryId: t.journal_entry_id as string | null,
    }))
  );
  const balance = rows.length > 0 ? rows[rows.length - 1].runningBalance : 0;
  const displayRows = [...rows].reverse(); // 新しい取引が上に来るように表示（残高は登録順で計算済み）

  const { data: accountsData } = await supabase
    .from('accounts')
    .select('id, code, name, sub_type')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('code');
  const accountOptions: BankDetailAccountOption[] = (accountsData ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    subType: a.sub_type as string | null,
  }));
  const bankAccountOptions: BankAccountOptionRow[] = accountOptions.filter((a) => a.code === '110');
  const editAccountOptions = await loadBankLinkOptions(supabase, ctx.organizationId, bankAccountOptions);

  const { receivableTotal, payableTotal } = await loadReceivablePayableBalances(supabase, ctx.organizationId);

  return {
    bankAccount: {
      id: bankAccount.id as string,
      bankName: bankAccount.bank_name as string,
      branchName: bankAccount.branch_name as string | null,
      accountType: bankAccount.account_type as 'ordinary' | 'checking' | 'savings',
      accountLast4: bankAccount.account_last4 as string | null,
      holderName: bankAccount.holder_name as string | null,
      storeId: bankAccount.store_id as string | null,
      accountId: bankAccount.account_id as string | null,
      storeName: (bankAccount.stores as unknown as { name: string } | null)?.name ?? null,
      linkedAccount: bankAccount.accounts as unknown as { code: string; name: string } | null,
    },
    rows,
    displayRows,
    balance,
    accountOptions,
    editAccountOptions,
    receivableTotal,
    payableTotal,
  };
}

// -------------------------------------------------------------
// 自動仕訳（/app/accounting/auto）
// -------------------------------------------------------------

export interface AutoPendingSummary {
  count: number;
  total: number;
}

export interface AutoJournalPageData {
  from: string;
  to: string;
  accountsInstalled: boolean;
  pending: {
    pos_sales: AutoPendingSummary;
    pos_refund: AutoPendingSummary;
    purchase: AutoPendingSummary;
    expense: AutoPendingSummary;
    petty_cash: AutoPendingSummary;
    payroll: AutoPendingSummary;
  };
  mappingRows: { id: string; name: string; accountId: string | null }[];
  /** 費用科目（500番台） */
  accountOptions: { id: string; code: string; name: string }[];
}

export async function loadAutoJournalPage(supabase: Supabase, ctx: AccountingCtx, sp: { from?: string; to?: string }): Promise<AutoJournalPageData> {
  const def = defaultAutoPeriod();
  const from = sp.from || def.from;
  const to = sp.to || def.to;
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const accountsInstalled = accounts.byCode.size > 0;

  // ---- サマリー集計（各カードの対象件数・合計額） ----
  const [salesBuckets, refundBuckets, invoices, expenses, pettyCash, payrollRuns] = await Promise.all([
    aggregateDailySales(supabase, ctx.organizationId, storeIds, from, to),
    aggregateDailyRefunds(supabase, ctx.organizationId, storeIds, from, to),
    fetchPendingInvoices(supabase, ctx.organizationId),
    fetchPendingExpenses(supabase, ctx.organizationId),
    fetchPendingPettyCash(supabase, ctx.organizationId),
    fetchPendingPayrollRuns(supabase, ctx.organizationId),
  ]);

  const salesSourceIds = salesBuckets.map((b) => `${b.storeId}:${b.date}`);
  const refundSourceIds = refundBuckets.map((b) => `${b.storeId}:${b.date}`);
  const [existingSales, existingRefund, existingPurchase, existingExpense, existingPetty, existingPayroll] = await Promise.all([
    loadExistingSourceIds(supabase, ctx.organizationId, 'pos_sales', salesSourceIds),
    loadExistingSourceIds(supabase, ctx.organizationId, 'pos_refund', refundSourceIds),
    loadExistingSourceIds(supabase, ctx.organizationId, 'purchase', invoices.map((r) => r.id)),
    loadExistingSourceIds(supabase, ctx.organizationId, 'expense', expenses.map((r) => r.id)),
    loadExistingSourceIds(supabase, ctx.organizationId, 'petty_cash', pettyCash.map((r) => r.id)),
    loadExistingSourceIds(supabase, ctx.organizationId, 'payroll', payrollRuns.map((r) => r.id)),
  ]);

  const pendingSalesBuckets = salesBuckets.filter((b) => !existingSales.has(`${b.storeId}:${b.date}`));
  const salesTotal = pendingSalesBuckets.reduce((a, b) => a + b.cashStandard + b.cashReduced + b.cashlessStandard + b.cashlessReduced, 0);

  const pendingRefundBuckets = refundBuckets.filter((b) => !existingRefund.has(`${b.storeId}:${b.date}`));
  const refundTotal = pendingRefundBuckets.reduce((a, b) => a + b.cashStandard + b.cashReduced + b.cashlessStandard + b.cashlessReduced, 0);

  const pendingInvoices = invoices.filter((r) => !existingPurchase.has(r.id));
  const purchaseTotal = pendingInvoices.reduce((a, r) => a + r.amount, 0);

  const pendingExpenses = expenses.filter((r) => !existingExpense.has(r.id));
  const expenseTotal = pendingExpenses.reduce((a, r) => a + r.amount, 0);

  const pendingPetty = pettyCash.filter((r) => !existingPetty.has(r.id));
  const pettyTotal = pendingPetty.reduce((a, r) => a + r.amount, 0);

  const pendingPayroll = payrollRuns.filter((r) => !existingPayroll.has(r.id) && r.grossTotal > 0);
  const payrollTotal = pendingPayroll.reduce((a, r) => a + r.grossTotal, 0);

  // ---- 費目マッピング用データ ----
  const { data: expenseAccountsData } = await supabase
    .from('expense_accounts')
    .select('id, name, account_id')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order');
  const mappingRows = (expenseAccountsData ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    accountId: r.account_id as string | null,
  }));
  const accountOptions = [...accounts.byCode.values()]
    .filter((a) => a.code.startsWith('5')) // 費用科目（500番台）
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    from,
    to,
    accountsInstalled,
    pending: {
      pos_sales: { count: pendingSalesBuckets.length, total: salesTotal },
      pos_refund: { count: pendingRefundBuckets.length, total: refundTotal },
      purchase: { count: pendingInvoices.length, total: purchaseTotal },
      expense: { count: pendingExpenses.length, total: expenseTotal },
      petty_cash: { count: pendingPetty.length, total: pettyTotal },
      payroll: { count: pendingPayroll.length, total: payrollTotal },
    },
    mappingRows,
    accountOptions,
  };
}

// -------------------------------------------------------------
// 固定資産（/app/accounting/assets）
// -------------------------------------------------------------

export interface FixedAssetRow {
  id: string;
  name: string;
  acquiredOn: string;
  acquisitionCost: number;
  usefulLifeYears: number | null;
  depreciationMethod: DepreciationMethod;
  storeId: string | null;
  storeName: string | null;
  status: AssetStatus;
  disposedOn: string | null;
  note: string | null;
}

export async function loadFixedAssetsPage(supabase: Supabase, ctx: AccountingCtx): Promise<FixedAssetRow[]> {
  const { data } = await supabase
    .from('fixed_assets')
    .select('id, name, acquired_on, acquisition_cost, useful_life_years, depreciation_method, store_id, status, disposed_on, note, stores(name)')
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted')
    .order('acquired_on', { ascending: false });

  return (data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    acquiredOn: a.acquired_on as string,
    acquisitionCost: a.acquisition_cost as number,
    usefulLifeYears: a.useful_life_years as number | null,
    depreciationMethod: a.depreciation_method as DepreciationMethod,
    storeId: a.store_id as string | null,
    storeName: (a.stores as unknown as { name: string } | null)?.name ?? null,
    status: a.status as AssetStatus,
    disposedOn: a.disposed_on as string | null,
    note: a.note as string | null,
  }));
}
