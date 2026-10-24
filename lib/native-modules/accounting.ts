import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime, todayJst, yen } from '@/lib/format';
import { TAX_TREATMENT_LABELS, type TaxTreatment, type TrialBalanceRow } from '@/lib/accounting';
import {
  ACCOUNT_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
  DEPRECIATION_METHOD_LABELS,
  DEPRECIATION_METHOD_OPTIONS,
  JOURNAL_STATUS_LABELS,
  JOURNAL_STATUS_OPTIONS,
  PERIOD_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPE_OPTIONS,
  SOURCE_TYPE_TONES,
  SUB_TYPE_LABELS,
  type DepreciationMethod,
} from '@/components/accounting/labels';
import { canReopenPeriod, canWriteAccounting } from '@/components/accounting/roles';
import { ORIGIN_LINK_LABELS, resolveSourceOriginHref } from '@/components/accounting/journal-source-link';
import { MAX_IMPORT_ROWS, parseCsv } from '@/components/import/csv-parser';
import { guessBankCsvMapping, isBankCsvMappingComplete, parseBankCsvRow, type BankCsvColumnMapping, type BankCsvParsedRow } from '@/lib/bank-csv';
import {
  addDays,
  autoSourceDefs,
  defaultAutoPeriod,
  monthLabelJa,
  monthRange,
  BANK_ACCOUNT_TYPE_LABELS,
  LEDGER_TABS,
  STATEMENT_STAGE_ROWS,
} from '@/lib/accounting-pages';
import {
  loadAutoJournalPage,
  loadBankAccountDetail,
  loadBankAccountsPage,
  loadFixedAssetsPage,
  loadJournalPage,
  loadLedgerPage,
  loadStatementsPage,
  JOURNAL_PAGE_SIZE,
  type AccountingCtx,
} from '@/lib/accounting-pages-server';
import {
  closeMonth,
  createCorrectionEntry,
  createDraftEntry,
  deleteDraftEntry,
  getPeriodStatus,
  postEntry,
  reopenMonth,
  updateDraftEntry,
  voidEntry,
  type JournalEntryInput,
} from '@/app/app/accounting/actions';
import { getPeriodAuditHistory, listPeriodOverview } from '@/app/app/accounting/auto/period-actions';
import {
  addManualBankTransaction,
  checkBankCsvDuplicates,
  createBankAccount,
  createJournalFromBankTransactions,
  deleteBankAccount,
  importBankTransactionsCsv,
  updateBankAccount,
  type BankAccountInput,
  type BankCsvImportRow,
} from '@/app/app/accounting/banks/actions';
import {
  createExpenseJournalEntries,
  createPayrollJournalEntries,
  createPettyCashJournalEntries,
  createPurchaseJournalEntries,
  createRefundJournalEntriesBySourceIds,
  createSalesJournalEntriesBySourceIds,
  installStandardAccounts,
  previewExpenseJournal,
  previewPayrollJournal,
  previewPettyCashJournal,
  previewPurchaseJournal,
  previewRefundJournal,
  previewSalesJournal,
  saveExpenseAccountMapping,
} from '@/app/app/accounting/auto/actions';
import { changeFixedAssetStatus, deleteFixedAsset, saveFixedAsset } from '@/app/app/accounting/assets/actions';
import type { AutoSourceType, CreateResult, JournalCandidateView } from '@/app/app/accounting/auto/engine';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * 会計（/app/accounting・帳簿・財務レポート・銀行口座・自動仕訳・固定資産）の iPad ネイティブ。
 * GET part=accounting&view=journal|periods|ledger|statements|banks|bank|auto|autoCandidates|assets（Web と同じ絞り込みのクエリ）
 * POST acc*（下の ACCOUNTING_POST）。読み込みは lib/accounting-pages-server.ts、操作は Web と同じ server action をそのまま呼ぶ
 * （仕訳の作り方・締め・銀行の取込の中身は変えない）。2026-10-24 22:05 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 */

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const TAX_KEYS = Object.keys(TAX_TREATMENT_LABELS) as TaxTreatment[];
const AUTO_SOURCES: AutoSourceType[] = ['pos_sales', 'pos_refund', 'purchase', 'expense', 'petty_cash', 'payroll'];

function deny(error: string, status = 403): NativeModuleResult {
  return { status, body: { ok: false, error } };
}

function fail(error: unknown, fallback: string): NativeModuleResult {
  return deny(error instanceof Error && error.message ? error.message : fallback, 400);
}

/** Web の会計の画面と同じ入口（機能が有効・csv.export の権限） */
function guard(ctx: SessionContext): NativeModuleResult | null {
  if (ctx.disabledFeatures?.has('accounting')) return deny('会計は使えません');
  if (!ctx.organizationId || !can(ctx.role, 'csv.export')) return deny('会計を見る権限がありません');
  return null;
}

function accCtx(ctx: SessionContext): AccountingCtx {
  return { organizationId: ctx.organizationId as string, isHq: ctx.isHq, stores: ctx.stores, currentStore: ctx.currentStore, role: ctx.role };
}

/** 円（整数）にそろえる（iPad は Int で読む） */
const int = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** 元取引へのリンク（Web の 元取引 の列と同じ） */
function origin(sourceType: Parameters<typeof resolveSourceOriginHref>[0] | undefined, sourceId: string | null | undefined) {
  const href = sourceType ? resolveSourceOriginHref(sourceType, sourceId ?? null) : null;
  return { originHref: href, originLabel: href && sourceType ? (ORIGIN_LINK_LABELS[sourceType] ?? '元取引を見る') : null };
}

const plRow = (r: TrialBalanceRow) => ({ id: r.account.id, code: r.account.code, name: r.account.name, balance: int(r.balance) });

// -------------------------------------------------------------
// GET
// -------------------------------------------------------------

async function previewCandidates(source: AutoSourceType, from: string, to: string): Promise<JournalCandidateView[]> {
  switch (source) {
    case 'pos_sales':
      return previewSalesJournal(from, to);
    case 'pos_refund':
      return previewRefundJournal(from, to);
    case 'purchase':
      return previewPurchaseJournal();
    case 'expense':
      return previewExpenseJournal();
    case 'petty_cash':
      return previewPettyCashJournal();
    case 'payroll':
      return previewPayrollJournal();
  }
}

export const accountingGet: NativeModuleGet = async ({ ctx, url }) => {
  const denied = guard(ctx);
  if (denied) return denied;
  const a = accCtx(ctx);
  const q = (k: string): string | undefined => url.searchParams.get(k) ?? undefined;
  const view = q('view') || 'journal';
  const stores = ctx.stores.map((s) => ({ id: s.id, name: s.name }));
  const common = {
    ok: true,
    view,
    stores,
    isHq: ctx.isHq,
    canWrite: canWriteAccounting(ctx.role),
    canReopen: canReopenPeriod(ctx.role),
    today: todayJst(),
  };

  try {
    const supabase = await createClient();
    switch (view) {
      case 'journal': {
        const d = await loadJournalPage(supabase, a, {
          from: q('from'),
          to: q('to'),
          status: q('status'),
          source_type: q('source_type'),
          source_id: q('source_id'),
          store: q('store'),
          page: q('page'),
        });
        const exportQuery = new URLSearchParams({ from: d.from, to: d.to, status: d.status, source_type: d.sourceType, source_id: d.sourceId, store: d.storeId });
        return {
          body: {
            ...common,
            filters: { from: d.from, to: d.to, status: d.status, sourceType: d.sourceType, sourceId: d.sourceId, storeId: d.storeId, page: d.page },
            statusOptions: JOURNAL_STATUS_OPTIONS.map((v) => ({ value: v, label: JOURNAL_STATUS_LABELS[v] })),
            sourceTypeOptions: SOURCE_TYPE_OPTIONS.map((v) => ({ value: v, label: SOURCE_TYPE_LABELS[v] })),
            taxOptions: TAX_KEYS.map((v) => ({ value: v, label: TAX_TREATMENT_LABELS[v] })),
            accounts: d.accounts,
            entries: d.rows.map((r) => ({
              id: r.id,
              entryNo: int(r.entryNo),
              entryDate: r.entryDate,
              description: r.description,
              status: r.status,
              statusLabel: JOURNAL_STATUS_LABELS[r.status] ?? r.status,
              sourceType: r.sourceType,
              sourceLabel: SOURCE_TYPE_LABELS[r.sourceType] ?? r.sourceType,
              sourceId: r.sourceId,
              storeId: r.storeId,
              storeName: r.storeName,
              voidReason: r.voidReason,
              debitTotal: int(r.debitTotal),
              ...origin(r.sourceType, r.sourceId),
              lines: (d.linesByEntry[r.id] ?? []).map((l) => ({
                accountId: l.accountId,
                accountCode: l.accountCode,
                accountName: l.accountName,
                side: l.side,
                amount: int(l.amount),
                taxTreatment: l.taxTreatment,
                taxLabel: TAX_TREATMENT_LABELS[l.taxTreatment] ?? l.taxTreatment,
                memo: l.memo,
              })),
            })),
            count: d.count,
            pageSize: JOURNAL_PAGE_SIZE,
            totalPages: d.totalPages,
            rangeFrom: d.rangeFrom,
            exportPath: `/app/accounting/export?${exportQuery.toString()}`,
          },
        };
      }

      case 'periods': {
        // 月次締め（Web の PeriodClosePanel。会計の書込ができる人だけ）
        if (!canWriteAccounting(ctx.role)) return deny('この操作を行う権限がありません');
        const initialMonth = common.today.slice(0, 7);
        const m = q('month') ?? '';
        const month = MONTH.test(m) ? m : initialMonth;
        const [status, overview, history] = await Promise.all([
          getPeriodStatus(month),
          listPeriodOverview(initialMonth, 12),
          getPeriodAuditHistory(month),
        ]);
        const selected = overview.find((r) => r.month === month) ?? null;
        // 直近の締め解除がその後の締めより新しい＝解除されたまま未再締めの状態（Web と同じ判定）
        const justReopened =
          status.status === 'open' &&
          !!selected?.reopenedAt &&
          (!selected.closedAt || new Date(selected.reopenedAt) > new Date(selected.closedAt));
        return {
          body: {
            ...common,
            month,
            monthLabel: monthLabelJa(month),
            status: status.status,
            statusLabel: PERIOD_STATUS_LABELS[status.status],
            draftCount: status.draftCount,
            justReopened,
            draftFilter: { from: `${month}-01`, to: monthRange(month).to },
            overview: overview.map((r) => ({
              month: r.month,
              label: monthLabelJa(r.month),
              status: r.status,
              statusLabel: PERIOD_STATUS_LABELS[r.status],
              draftCount: r.draftCount,
              closedAtLabel: r.closedAt ? formatDateTime(r.closedAt) : null,
              closedByName: r.closedByName,
              reopenedAtLabel: r.reopenedAt ? formatDateTime(r.reopenedAt) : null,
              reopenedByName: r.reopenedByName,
            })),
            history: history.map((h) => ({
              id: h.id,
              isClose: h.action === 'accounting.period_close',
              label: h.action === 'accounting.period_close' ? '締め' : '締め解除',
              createdAtLabel: formatDateTime(h.createdAt),
              actorName: h.actorName,
              reason: h.reason,
            })),
          },
        };
      }

      case 'ledger': {
        const d = await loadLedgerPage(supabase, a, { tab: q('tab'), from: q('from'), to: q('to'), store: q('store'), account: q('account') });
        return {
          body: {
            ...common,
            filters: { tab: d.tab, from: d.from, to: d.to, storeId: d.storeId, accountId: d.selectedAccountId },
            tabs: LEDGER_TABS,
            candidateAccounts: d.candidateAccounts.map((c) => ({ id: c.id, code: c.code, name: c.name })),
            empty:
              d.journalEntries || d.ledger
                ? null
                : {
                    title: d.subType ? `${SUB_TYPE_LABELS[d.subType]}の科目が登録されていません` : '科目が登録されていません',
                    description: '「設定」→「勘定科目」で補助区分を設定した科目を登録してください',
                  },
            journal: d.journalEntries
              ? d.journalEntries.map((e) => ({
                  id: e.id,
                  entryNo: int(e.entryNo),
                  entryDate: e.entryDate,
                  description: e.description,
                  debitTotal: int(e.lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0)),
                  lines: e.lines.map((l) => ({
                    accountCode: l.accountCode,
                    accountName: l.accountName,
                    side: l.side,
                    amount: int(l.amount),
                    taxLabel: TAX_TREATMENT_LABELS[l.taxTreatment] ?? l.taxTreatment,
                    memo: l.memo,
                  })),
                }))
              : null,
            ledger: d.ledger
              ? {
                  accountId: d.ledger.account.id,
                  accountCode: d.ledger.account.code,
                  accountName: d.ledger.account.name,
                  opening: int(d.ledger.opening),
                  rows: d.ledger.rows.map((r, i) => ({
                    id: `${r.entryId}:${i}`,
                    date: r.date,
                    description: r.description,
                    counter: r.counter,
                    debit: int(r.debit),
                    credit: int(r.credit),
                    balance: int(r.balance),
                    storeName: r.storeName ?? null,
                    ...origin(r.sourceType, r.sourceId),
                  })),
                }
              : null,
            exportPath: `/app/accounting/ledger/export?${d.exportQuery}`,
          },
        };
      }

      case 'statements': {
        const d = await loadStatementsPage(supabase, a, { from: q('from'), to: q('to'), store: q('store') });
        const op = d.opStatement;
        const liabilityEquityTotal = d.bs.liabilityTotal + d.bs.equityTotal + d.bs.netIncome;
        return {
          body: {
            ...common,
            filters: { from: d.from, to: d.to, storeId: d.storeId },
            storeName: d.storeName,
            kpi: { cashBank: int(d.cashBankBalance), receivable: int(d.receivableBalance), payable: int(d.payableBalance), netIncome: int(op.operatingIncome) },
            trialBalanced: d.trialBalanced,
            debitGrandTotal: int(d.debitGrandTotal),
            creditGrandTotal: int(d.creditGrandTotal),
            trial: d.groupedTb.map((g) => ({
              category: g.category,
              label: ACCOUNT_CATEGORY_LABELS[g.category],
              rows: g.rows.map((r) => ({
                id: r.account.id,
                code: r.account.code,
                name: r.account.name,
                opening: int(r.openingBalance),
                debit: int(r.debitTotal),
                credit: int(r.creditTotal),
                closing: int(r.closingBalance),
              })),
              subtotal: {
                opening: int(g.rows.reduce((s, r) => s + r.openingBalance, 0)),
                debit: int(g.rows.reduce((s, r) => s + r.debitTotal, 0)),
                credit: int(g.rows.reduce((s, r) => s + r.creditTotal, 0)),
                closing: int(g.rows.reduce((s, r) => s + r.closingBalance, 0)),
              },
            })),
            pl: {
              revenueTotal: int(op.revenueTotal),
              revenues: op.revenues.map(plRow),
              cogsTotal: int(op.cogsTotal),
              cogs: op.cogs.map(plRow),
              grossProfit: int(op.grossProfit),
              laborTotal: int(op.laborTotal),
              labor: op.labor.map(plRow),
              opexTotal: int(op.opexTotal),
              opex: op.opex.map(plRow),
              operatingIncome: int(op.operatingIncome),
            },
            compare: {
              prevMonth: d.prevMonthYm,
              lastYear: d.lastYearYm,
              rows: STATEMENT_STAGE_ROWS.map((s) => ({
                label: s.label,
                emphasize: s.emphasize === true,
                current: int(s.get(op)),
                prev: int(s.get(d.opStatementPrevMonth)),
                lastYear: int(s.get(d.opStatementLastYear)),
              })),
            },
            monthly: d.showMonthlyBreakdown
              ? {
                  months: d.months,
                  rows: STATEMENT_STAGE_ROWS.map((s) => ({ label: s.label, emphasize: s.emphasize === true, values: d.monthlyStatements.map((m) => int(s.get(m))) })),
                }
              : null,
            monthsOverLimit: d.months.length > 12,
            bs: {
              balanced: d.bs.balanced,
              assetTotal: int(d.bs.assetTotal),
              liabilityTotal: int(d.bs.liabilityTotal),
              equityTotal: int(d.bs.equityTotal),
              netIncome: int(d.bs.netIncome),
              liabilityEquityTotal: int(liabilityEquityTotal),
              diff: int(d.bs.assetTotal - liabilityEquityTotal),
              assets: d.bs.assets.map(plRow),
              liabilities: d.bs.liabilities.map(plRow),
              equity: d.bs.equity.map(plRow),
            },
            openingTo: addDays(d.from, -1),
            exportPath: `/app/accounting/statements/export?${d.exportQuery}`,
          },
        };
      }

      case 'banks': {
        const d = await loadBankAccountsPage(supabase, a);
        return {
          body: {
            ...common,
            accountsInstalled: d.accountsInstalled,
            accountOptions: d.accountOptions,
            formStores: ctx.isHq ? stores : [],
            banks: d.bankAccounts.map((b) => ({
              id: b.id,
              bankName: b.bankName,
              branchName: b.branchName,
              accountType: b.accountType,
              accountTypeLabel: BANK_ACCOUNT_TYPE_LABELS[b.accountType] ?? b.accountType,
              accountLast4: b.accountLast4,
              holderName: b.holderName,
              storeName: b.storeName,
              accountCode: b.account?.code ?? null,
              accountName: b.account?.name ?? null,
            })),
          },
        };
      }

      case 'bank': {
        const id = q('id') ?? '';
        if (!UUID.test(id)) return deny('銀行口座が見つかりません', 404);
        const d = await loadBankAccountDetail(supabase, a, id);
        if (!d) return deny('銀行口座が見つかりません', 404);
        const b = d.bankAccount;
        return {
          body: {
            ...common,
            bank: {
              id: b.id,
              bankName: b.bankName,
              branchName: b.branchName,
              accountType: b.accountType,
              accountTypeLabel: BANK_ACCOUNT_TYPE_LABELS[b.accountType] ?? b.accountType,
              accountLast4: b.accountLast4,
              holderName: b.holderName,
              storeId: b.storeId,
              storeName: b.storeName,
              accountId: b.accountId,
              accountCode: b.linkedAccount?.code ?? null,
              accountName: b.linkedAccount?.name ?? null,
            },
            balance: int(d.balance),
            receivableTotal: int(d.receivableTotal),
            payableTotal: int(d.payableTotal),
            txs: d.displayRows.map((t) => ({
              id: t.id,
              date: t.date,
              description: t.description,
              deposit: int(t.deposit),
              withdrawal: int(t.withdrawal),
              runningBalance: int(t.runningBalance),
              journalEntryId: t.journalEntryId,
            })),
            accountOptions: d.accountOptions.map((o) => ({ id: o.id, code: o.code, name: o.name, subType: o.subType ?? null })),
            editAccountOptions: d.editAccountOptions.map((o) => ({ id: o.id, code: o.code, name: o.name })),
            formStores: ctx.isHq ? stores : [],
            maxImportRows: MAX_IMPORT_ROWS,
          },
        };
      }

      case 'auto': {
        const d = await loadAutoJournalPage(supabase, a, { from: q('from'), to: q('to') });
        const defs = autoSourceDefs(d.from, d.to);
        const shortLabel: Record<AutoSourceType, string> = {
          pos_sales: '売上',
          pos_refund: '返金',
          purchase: '仕入',
          expense: '経費',
          petty_cash: '小口現金',
          payroll: '給与',
        };
        return {
          body: {
            ...common,
            filters: { from: d.from, to: d.to },
            accountsInstalled: d.accountsInstalled,
            sources: defs.map((s) => ({
              sourceType: s.sourceType,
              title: s.title,
              hint: s.hint,
              negative: !!SOURCE_TYPE_TONES[s.sourceType],
              pendingCount: d.pending[s.sourceType].count,
              pendingTotal: int(d.pending[s.sourceType].total),
            })),
            totalsNote: `合計参考: ${defs.map((s) => `${shortLabel[s.sourceType]} ${yen(int(d.pending[s.sourceType].total))}`).join(' ・ ')}`,
            mappingRows: d.mappingRows,
            mappingAccountOptions: d.accountOptions.map((o) => ({ id: o.id, code: o.code, name: o.name })),
          },
        };
      }

      case 'autoCandidates': {
        const source = q('source') as AutoSourceType | undefined;
        if (!source || !AUTO_SOURCES.includes(source)) return deny('区分が正しくありません', 400);
        const def = defaultAutoPeriod();
        const list = await previewCandidates(source, q('from') || def.from, q('to') || def.to);
        return {
          body: {
            ...common,
            source,
            candidates: list.map((c) => ({
              key: c.key,
              sourceId: c.sourceId,
              date: c.date,
              description: c.description,
              storeName: c.storeName,
              lines: c.lines.map((l, i) => ({ id: i, side: l.side, accountName: l.accountName, amount: int(l.amount) })),
              debit: int(c.debit),
              balanced: c.balanced,
              alreadyPosted: c.alreadyPosted,
              warning: c.warning,
            })),
          },
        };
      }

      case 'assets': {
        const rows = await loadFixedAssetsPage(supabase, a);
        return {
          body: {
            ...common,
            methods: DEPRECIATION_METHOD_OPTIONS.map((v) => ({ value: v, label: DEPRECIATION_METHOD_LABELS[v] })),
            rows: rows.map((r) => ({
              id: r.id,
              name: r.name,
              acquiredOn: r.acquiredOn,
              acquisitionCost: int(r.acquisitionCost),
              usefulLifeYears: r.usefulLifeYears == null ? null : int(r.usefulLifeYears),
              depreciationMethod: r.depreciationMethod,
              methodLabel: DEPRECIATION_METHOD_LABELS[r.depreciationMethod] ?? r.depreciationMethod,
              storeId: r.storeId,
              storeName: r.storeName,
              status: r.status,
              statusLabel: ASSET_STATUS_LABELS[r.status] ?? r.status,
              disposedOn: r.disposedOn,
              note: r.note,
            })),
          },
        };
      }

      default:
        return deny('画面が正しくありません', 400);
    }
  } catch (e) {
    return { status: 500, body: { ok: false, error: e instanceof Error && e.message ? e.message : '読み込めませんでした' } };
  }
};

// -------------------------------------------------------------
// POST（どれも Web と同じ server action をそのまま呼ぶ。権限はその中でも確かめる）
// -------------------------------------------------------------

/** 入口の確認をしてから本体を呼ぶ */
function post(fn: (raw: Record<string, unknown>, ctx: SessionContext) => Promise<NativeModuleResult>): NativeModulePost {
  return async ({ ctx, raw }) => {
    const denied = guard(ctx);
    if (denied) return denied;
    return fn(raw, ctx);
  };
}

/** { error?: string } を返す action の結果 */
function done(r: { error?: string; id?: string }): NativeModuleResult {
  if (r.error) return deny(r.error, 400);
  return { body: { ok: true, ...(r.id ? { id: r.id } : {}) } };
}

/** 一括作成の結果（Web の toast と同じ「作成 n件 / スキップ n件 / 失敗 n件」用） */
function created(r: CreateResult): NativeModuleResult {
  return { body: { ok: true, result: { created: r.ok, skipped: r.skipped, failed: r.failed } } };
}

const needId = (raw: Record<string, unknown>, key = 'id'): string | null => {
  const v = str(raw[key]);
  return UUID.test(v) ? v : null;
};

/** 仕訳の下書き（新規・編集。Web の JournalEntryDialog と同じ入力） */
const accJournalSave = post(async (raw) => {
  const id = str(raw.id);
  if (id && !UUID.test(id)) return deny('内容が正しくありません', 400);
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  const input: JournalEntryInput = {
    entryDate: DATE.test(str(raw.entryDate)) ? str(raw.entryDate) : '',
    description: str(raw.description).trim(),
    storeId: strOrNull(raw.storeId),
    lines: lines.map((l) => {
      const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
      const tax = str(o.taxTreatment) as TaxTreatment;
      const amount = num(o.amount);
      return {
        accountId: str(o.accountId),
        side: o.side === 'credit' ? ('credit' as const) : ('debit' as const),
        amount: Number.isFinite(amount) ? Math.round(amount) : 0,
        taxTreatment: TAX_KEYS.includes(tax) ? tax : 'out_of_scope',
        memo: str(o.memo).trim() || null,
      };
    }),
  };
  return done(id ? await updateDraftEntry(id, input) : await createDraftEntry(input));
});

const accJournalDelete = post(async (raw) => {
  const id = needId(raw);
  return id ? done(await deleteDraftEntry(id)) : deny('内容が正しくありません', 400);
});

const accJournalPost = post(async (raw) => {
  const id = needId(raw);
  return id ? done(await postEntry(id)) : deny('内容が正しくありません', 400);
});

const accJournalVoid = post(async (raw) => {
  const id = needId(raw);
  return id ? done(await voidEntry(id, str(raw.reason))) : deny('内容が正しくありません', 400);
});

const accJournalCorrect = post(async (raw) => {
  const id = needId(raw);
  return id ? done(await createCorrectionEntry(id)) : deny('内容が正しくありません', 400);
});

const accPeriodClose = post(async (raw) => {
  const month = str(raw.month);
  return MONTH.test(month) ? done(await closeMonth(month)) : deny('月が正しくありません', 400);
});

const accPeriodReopen = post(async (raw) => {
  const month = str(raw.month);
  return MONTH.test(month) ? done(await reopenMonth(month, str(raw.reason))) : deny('月が正しくありません', 400);
});

/** 銀行口座の登録・編集（Web の BankAccountForm と同じ入力） */
const accBankSave = post(async (raw) => {
  const id = str(raw.id);
  if (id && !UUID.test(id)) return deny('内容が正しくありません', 400);
  const type = str(raw.accountType);
  const input: BankAccountInput = {
    storeId: strOrNull(raw.storeId),
    bankName: str(raw.bankName),
    branchName: strOrNull(raw.branchName),
    accountType: type === 'checking' || type === 'savings' ? type : 'ordinary',
    accountLast4: str(raw.accountLast4).replace(/\D/g, '').slice(0, 4) || null,
    holderName: strOrNull(raw.holderName),
    accountId: strOrNull(raw.accountId),
  };
  try {
    if (id) await updateBankAccount(id, input);
    else await createBankAccount(input);
    return { body: { ok: true } };
  } catch (e) {
    return fail(e, '保存に失敗しました');
  }
});

const accBankDelete = post(async (raw) => {
  const id = needId(raw);
  if (!id) return deny('内容が正しくありません', 400);
  try {
    await deleteBankAccount(id);
    return { body: { ok: true } };
  } catch (e) {
    return fail(e, '削除に失敗しました');
  }
});

/** 取引の手入力（Web の BankManualTxForm） */
const accBankTxAdd = post(async (raw) => {
  const id = needId(raw, 'bankAccountId');
  if (!id) return deny('内容が正しくありません', 400);
  try {
    await addManualBankTransaction(id, {
      date: DATE.test(str(raw.date)) ? str(raw.date) : '',
      description: str(raw.description).trim(),
      deposit: int(raw.deposit),
      withdrawal: int(raw.withdrawal),
    });
    return { body: { ok: true } };
  } catch (e) {
    return fail(e, '登録に失敗しました');
  }
});

/** 取引から仕訳（Web の BankTxTable の「下書き作成」「作成して確定」） */
const accBankJournal = post(async (raw) => {
  const id = needId(raw, 'bankAccountId');
  if (!id) return deny('内容が正しくありません', 400);
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((i) => (i && typeof i === 'object' ? (i as Record<string, unknown>) : {}))
    .map((i) => ({ transactionId: str(i.transactionId), accountId: str(i.accountId) }))
    .filter((i) => UUID.test(i.transactionId) && !!i.accountId);
  if (items.length === 0) return deny('勘定科目を選択した取引をチェックしてください', 400);
  try {
    return created(await createJournalFromBankTransactions(id, items, raw.post === true));
  } catch (e) {
    return fail(e, '仕訳の作成に失敗しました');
  }
});

/** CSV の列番号（列の数の範囲だけ） */
function mappingFrom(raw: unknown, headerCount: number): BankCsvColumnMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const col = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < headerCount ? v : null);
  return { date: col(o.date), description: col(o.description), deposit: col(o.deposit), withdrawal: col(o.withdrawal) };
}

/**
 * CSV取込の確認（Web の BankCsvImport の「列の対応付け」「確認」と同じ。iPad で選んだファイルの中身をここで読む）。
 * mapping が無ければ列名から推定する。対応付けが揃っていれば各行を読み、重複も確かめる
 */
const accBankCsvPreview = post(async (raw) => {
  const id = needId(raw, 'bankAccountId');
  if (!id) return deny('内容が正しくありません', 400);
  let text = str(raw.csv);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = parseCsv(text);
  if (rows.length === 0) return deny('空のファイルです', 400);
  const [headerRow, ...body] = rows;
  const nonEmpty = body.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return deny('データ行がありません（ヘッダー行のみのファイルです）', 400);
  if (nonEmpty.length > MAX_IMPORT_ROWS) {
    return deny(`一度に取込できるのは${MAX_IMPORT_ROWS}行までです（このファイルは${nonEmpty.length}行）`, 400);
  }
  const mapping = mappingFrom(raw.mapping, headerRow.length) ?? guessBankCsvMapping(headerRow);
  const complete = isBankCsvMappingComplete(mapping);
  const headers = headerRow.map((h, i) => h || `（${i + 1}列目）`);
  if (!complete) return { body: { ok: true, headers, mapping, complete, rowCount: nonEmpty.length, rows: [] } };

  const parsed = nonEmpty.map((cells, i) => ({ rowNumber: i + 1, ...parseBankCsvRow(cells, mapping) }));
  const valid = parsed.filter((r): r is { rowNumber: number; parsed: BankCsvParsedRow; error: null } => r.parsed !== null);
  let flags: Awaited<ReturnType<typeof checkBankCsvDuplicates>> = [];
  try {
    flags = valid.length > 0 ? await checkBankCsvDuplicates(id, valid.map((r) => r.parsed)) : [];
  } catch (e) {
    return fail(e, '重複確認に失敗しました');
  }
  const flagByRow = new Map(valid.map((r, i) => [r.rowNumber, flags[i]]));
  return {
    body: {
      ok: true,
      headers,
      mapping,
      complete,
      rowCount: nonEmpty.length,
      rows: parsed.map((r) => {
        const f = flagByRow.get(r.rowNumber);
        return {
          rowNumber: r.rowNumber,
          date: r.parsed?.date ?? null,
          description: r.parsed?.description ?? null,
          deposit: r.parsed?.deposit ?? 0,
          withdrawal: r.parsed?.withdrawal ?? 0,
          error: r.error,
          exactDuplicate: f?.exactDuplicate ?? false,
          suspiciousDuplicate: f?.suspiciousDuplicate ?? false,
          suspiciousDescriptions: f?.suspiciousDescriptions ?? [],
        };
      }),
    },
  };
});

/** CSV取込の確定（Web と同じ。完全重複はサーバー側でも自動スキップ） */
const accBankCsvImport = post(async (raw) => {
  const id = needId(raw, 'bankAccountId');
  if (!id) return deny('内容が正しくありません', 400);
  const rows: BankCsvImportRow[] = (Array.isArray(raw.rows) ? raw.rows : [])
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .filter((r) => DATE.test(str(r.date)) && str(r.description).trim() !== '')
    .map((r) => ({
      date: str(r.date),
      description: str(r.description).trim(),
      deposit: Math.max(0, int(r.deposit)),
      withdrawal: Math.max(0, int(r.withdrawal)),
      category: r.category === 'suspicious' ? ('suspicious' as const) : ('new' as const),
    }))
    .filter((r) => (r.deposit > 0) !== (r.withdrawal > 0));
  if (rows.length === 0) return deny('取り込める行がありません', 400);
  try {
    const summary = await importBankTransactionsCsv(id, rows);
    return { body: { ok: true, summary } };
  } catch (e) {
    return fail(e, '取込に失敗しました');
  }
});

/** 自動仕訳の作成（Web の AutoSourceCard の「下書き作成」「作成して確定」） */
const accAutoCreate = post(async (raw) => {
  const source = str(raw.source) as AutoSourceType;
  if (!AUTO_SOURCES.includes(source)) return deny('区分が正しくありません', 400);
  const keys = (Array.isArray(raw.keys) ? raw.keys : []).filter((k): k is string => typeof k === 'string' && k.length > 0);
  if (keys.length === 0) return deny('作成する仕訳を選択してください', 400);
  const postIt = raw.post === true;
  try {
    switch (source) {
      case 'pos_sales':
        return created(await createSalesJournalEntriesBySourceIds(keys, postIt));
      case 'pos_refund':
        return created(await createRefundJournalEntriesBySourceIds(keys, postIt));
      case 'purchase':
        return created(await createPurchaseJournalEntries(keys, postIt));
      case 'expense':
        return created(await createExpenseJournalEntries(keys, postIt));
      case 'petty_cash':
        return created(await createPettyCashJournalEntries(keys, postIt));
      case 'payroll':
        return created(await createPayrollJournalEntries(keys, postIt));
    }
  } catch (e) {
    return fail(e, '仕訳の作成に失敗しました');
  }
  return deny('区分が正しくありません', 400);
});

/** 費目 → 勘定科目（Web の AutoMappingSection） */
const accExpenseMapping = post(async (raw) => {
  const id = needId(raw, 'expenseAccountId');
  if (!id) return deny('内容が正しくありません', 400);
  try {
    await saveExpenseAccountMapping(id, strOrNull(raw.accountId));
    return { body: { ok: true } };
  } catch (e) {
    return fail(e, '保存に失敗しました');
  }
});

/** 標準の勘定科目を導入（Web の InstallAccountsBanner。冪等） */
const accInstallAccounts = post(async () => {
  try {
    await installStandardAccounts();
    return { body: { ok: true } };
  } catch (e) {
    return fail(e, '導入に失敗しました');
  }
});

/** 固定資産の登録・編集（Web の FixedAssetsPanel） */
const accAssetSave = post(async (raw) => {
  const id = str(raw.id);
  if (id && !UUID.test(id)) return deny('内容が正しくありません', 400);
  const method = str(raw.depreciationMethod) as DepreciationMethod;
  const life = num(raw.usefulLifeYears);
  return done(
    await saveFixedAsset({
      id: id || undefined,
      name: str(raw.name),
      acquiredOn: DATE.test(str(raw.acquiredOn)) ? str(raw.acquiredOn) : '',
      acquisitionCost: num(raw.acquisitionCost),
      usefulLifeYears: Number.isFinite(life) ? life : null,
      depreciationMethod: DEPRECIATION_METHOD_OPTIONS.includes(method) ? method : 'straight_line',
      storeId: strOrNull(raw.storeId),
      note: strOrNull(raw.note),
    })
  );
});

const accAssetStatus = post(async (raw) => {
  const id = needId(raw);
  const status = str(raw.status);
  if (!id || (status !== 'in_use' && status !== 'disposed' && status !== 'sold')) return deny('内容が正しくありません', 400);
  const disposedOn = DATE.test(str(raw.disposedOn)) ? str(raw.disposedOn) : null;
  return done(await changeFixedAssetStatus(id, status, disposedOn));
});

const accAssetDelete = post(async (raw) => {
  const id = needId(raw);
  return id ? done(await deleteFixedAsset(id)) : deny('内容が正しくありません', 400);
});

/** POST の type → handler（registry.ts に 1 行で入れる） */
export const ACCOUNTING_POST: Record<string, NativeModulePost> = {
  accJournalSave,
  accJournalDelete,
  accJournalPost,
  accJournalVoid,
  accJournalCorrect,
  accPeriodClose,
  accPeriodReopen,
  accBankSave,
  accBankDelete,
  accBankTxAdd,
  accBankJournal,
  accBankCsvPreview,
  accBankCsvImport,
  accAutoCreate,
  accExpenseMapping,
  accInstallAccounts,
  accAssetSave,
  accAssetStatus,
  accAssetDelete,
};
