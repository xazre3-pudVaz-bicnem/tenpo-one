'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import {
  aggregateDailySales,
  buildCandidateView,
  expenseJournalLines,
  fetchPendingExpenses,
  fetchPendingInvoices,
  fetchPendingPayrollRuns,
  fetchPendingPettyCash,
  friendlyJournalError,
  insertJournalEntry,
  loadAccounts,
  loadExistingSourceIds,
  loadExpenseAccountCodeMap,
  payrollJournalLines,
  pettyCashJournalLines,
  purchaseJournalLines,
  resolveLines,
  salesJournalLines,
  type CreateResult,
  type JournalCandidateView,
} from './engine';

const PATH = '/app/accounting/auto';

/** アクセス可能店舗の絞り込み（未指定なら選択中店舗、無ければ所属店舗すべて） */
function resolveStoreIds(ctx: { stores: { id: string }[] }, currentStoreId: string | null, requested?: string[]): string[] {
  if (requested && requested.length > 0) {
    const allowed = new Set(ctx.stores.map((s) => s.id));
    const filtered = requested.filter((id) => allowed.has(id));
    if (filtered.length !== requested.length) throw new Error('対象店舗にアクセス権がありません');
    return filtered;
  }
  if (currentStoreId) return [currentStoreId];
  return ctx.stores.map((s) => s.id);
}

// -------------------------------------------------------------
// 売上
// -------------------------------------------------------------

export async function previewSalesJournal(from: string, to: string, storeIds?: string[]): Promise<JournalCandidateView[]> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const targetStoreIds = resolveStoreIds(ctx, ctx.currentStore?.id ?? null, storeIds);
  const storeNameById = new Map(ctx.stores.map((s) => [s.id, s.name]));

  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const buckets = await aggregateDailySales(supabase, ctx.organizationId, targetStoreIds, from, to);
  const sourceIds = buckets.map((b) => `${b.storeId}:${b.date}`);
  const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'pos_sales', sourceIds);

  return buckets.map((b) => {
    const sourceId = `${b.storeId}:${b.date}`;
    return buildCandidateView({
      sourceType: 'pos_sales',
      sourceId,
      date: b.date,
      description: `${b.date} 売上（POS・${storeNameById.get(b.storeId) ?? ''}）`,
      storeId: b.storeId,
      storeName: storeNameById.get(b.storeId) ?? null,
      lines: salesJournalLines(b),
      accounts,
      alreadyPosted: existing.has(sourceId),
    });
  });
}

export async function createSalesJournalEntries(
  keys: { storeId: string; date: string }[],
  post: boolean
): Promise<CreateResult> {
  const ctx = await requirePermission('csv.export');
  if (!keys.every((k) => ctx.stores.some((s) => s.id === k.storeId))) {
    throw new Error('対象店舗にアクセス権がありません');
  }
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const storeIds = [...new Set(keys.map((k) => k.storeId))];
  const dates = keys.map((k) => k.date);
  const from = dates.reduce((a, b) => (a < b ? a : b));
  const to = dates.reduce((a, b) => (a > b ? a : b));
  const buckets = await aggregateDailySales(supabase, ctx.organizationId, storeIds, from, to);
  const bucketByKey = new Map(buckets.map((b) => [`${b.storeId}:${b.date}`, b]));
  const storeNameById = new Map(ctx.stores.map((s) => [s.id, s.name]));

  const result: CreateResult = { ok: 0, skipped: 0, failed: [] };
  for (const k of keys) {
    const key = `${k.storeId}:${k.date}`;
    try {
      const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'pos_sales', [key]);
      if (existing.has(key)) {
        result.skipped += 1;
        continue;
      }
      const bucket = bucketByKey.get(key);
      if (!bucket) {
        result.failed.push({ key, reason: '対象の売上データが見つかりません' });
        continue;
      }
      const draftLines = salesJournalLines(bucket);
      const { lines, missing } = resolveLines(draftLines, accounts);
      if (missing.length > 0) {
        result.failed.push({ key, reason: `勘定科目が未導入です（${missing.join('、')}）。標準科目を導入してください` });
        continue;
      }
      await insertJournalEntry(supabase, {
        organizationId: ctx.organizationId,
        storeId: k.storeId,
        entryDate: k.date,
        description: `${k.date} 売上（POS・${storeNameById.get(k.storeId) ?? ''}）`,
        sourceType: 'pos_sales',
        sourceId: key,
        lines,
        userId: ctx.userId,
        post,
      });
      result.ok += 1;
    } catch (err) {
      result.failed.push({ key, reason: err instanceof Error ? err.message : '仕訳の作成に失敗しました' });
    }
  }
  revalidatePath(PATH);
  return result;
}

/** source_id（`{storeId}:{date}`形式）のリストから売上仕訳を作成する薄いアダプタ（UIからの汎用呼び出し用） */
export async function createSalesJournalEntriesBySourceIds(sourceIds: string[], post: boolean): Promise<CreateResult> {
  const keys = sourceIds.map((id) => {
    const sep = id.indexOf(':');
    return { storeId: id.slice(0, sep), date: id.slice(sep + 1) };
  });
  return createSalesJournalEntries(keys, post);
}

// -------------------------------------------------------------
// 仕入
// -------------------------------------------------------------

export async function previewPurchaseJournal(): Promise<JournalCandidateView[]> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const rows = await fetchPendingInvoices(supabase, ctx.organizationId);
  const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'purchase', rows.map((r) => r.id));
  return rows
    .filter((r) => !existing.has(r.id))
    .map((r) =>
      buildCandidateView({
        sourceType: 'purchase',
        sourceId: r.id,
        date: r.issueDate ?? '—',
        description: `仕入（${r.vendorName}）`,
        storeId: r.storeId,
        storeName: r.storeName,
        lines: purchaseJournalLines(r),
        accounts,
        alreadyPosted: false,
      })
    );
}

export async function createPurchaseJournalEntries(invoiceIds: string[], post: boolean): Promise<CreateResult> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const rows = await fetchPendingInvoices(supabase, ctx.organizationId, invoiceIds);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'purchase', invoiceIds);

  const result: CreateResult = { ok: 0, skipped: 0, failed: [] };
  for (const id of invoiceIds) {
    try {
      if (existing.has(id)) {
        result.skipped += 1;
        continue;
      }
      const row = rowById.get(id);
      if (!row) {
        result.failed.push({ key: id, reason: '請求書が見つかりません（対象外の状態の可能性があります）' });
        continue;
      }
      const draftLines = purchaseJournalLines(row);
      const { lines, missing } = resolveLines(draftLines, accounts);
      if (missing.length > 0) {
        result.failed.push({ key: id, reason: `勘定科目が未導入です（${missing.join('、')}）` });
        continue;
      }
      const { entryId } = await insertJournalEntry(supabase, {
        organizationId: ctx.organizationId,
        storeId: row.storeId,
        entryDate: row.issueDate ?? todayJst(),
        description: `仕入（${row.vendorName}）`,
        sourceType: 'purchase',
        sourceId: id,
        lines,
        userId: ctx.userId,
        post,
      });
      if (row.documentId) {
        await supabase.from('documents').update({ journal_entry_id: entryId, updated_by: ctx.userId }).eq('id', row.documentId);
      }
      result.ok += 1;
    } catch (err) {
      result.failed.push({ key: id, reason: err instanceof Error ? err.message : '仕訳の作成に失敗しました' });
    }
  }
  revalidatePath(PATH);
  return result;
}

// -------------------------------------------------------------
// 経費
// -------------------------------------------------------------

export async function previewExpenseJournal(): Promise<JournalCandidateView[]> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const mapping = await loadExpenseAccountCodeMap(supabase, ctx.organizationId, accounts);
  const rows = await fetchPendingExpenses(supabase, ctx.organizationId);
  const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'expense', rows.map((r) => r.id));
  return rows
    .filter((r) => !existing.has(r.id))
    .map((r) => {
      const { lines, warning } = expenseJournalLines(r, mapping);
      return buildCandidateView({
        sourceType: 'expense',
        sourceId: r.id,
        date: r.businessDate,
        description: `経費（${r.vendorName ?? r.memo ?? '経費'}）`,
        storeId: r.storeId,
        storeName: r.storeName,
        lines,
        accounts,
        alreadyPosted: false,
        warning,
      });
    });
}

export async function createExpenseJournalEntries(expenseIds: string[], post: boolean): Promise<CreateResult> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const mapping = await loadExpenseAccountCodeMap(supabase, ctx.organizationId, accounts);
  const rows = await fetchPendingExpenses(supabase, ctx.organizationId, expenseIds);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'expense', expenseIds);

  const result: CreateResult = { ok: 0, skipped: 0, failed: [] };
  for (const id of expenseIds) {
    try {
      if (existing.has(id)) {
        result.skipped += 1;
        continue;
      }
      const row = rowById.get(id);
      if (!row) {
        result.failed.push({ key: id, reason: '経費が見つかりません（承認待ちの可能性があります）' });
        continue;
      }
      const { lines: draftLines } = expenseJournalLines(row, mapping);
      const { lines, missing } = resolveLines(draftLines, accounts);
      if (missing.length > 0) {
        result.failed.push({ key: id, reason: `勘定科目が未導入です（${missing.join('、')}）` });
        continue;
      }
      await insertJournalEntry(supabase, {
        organizationId: ctx.organizationId,
        storeId: row.storeId,
        entryDate: row.businessDate,
        description: `経費（${row.vendorName ?? row.memo ?? '経費'}）`,
        sourceType: 'expense',
        sourceId: id,
        lines,
        userId: ctx.userId,
        post,
      });
      result.ok += 1;
    } catch (err) {
      result.failed.push({ key: id, reason: err instanceof Error ? err.message : '仕訳の作成に失敗しました' });
    }
  }
  revalidatePath(PATH);
  return result;
}

// -------------------------------------------------------------
// 小口現金
// -------------------------------------------------------------

export async function previewPettyCashJournal(): Promise<JournalCandidateView[]> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const mapping = await loadExpenseAccountCodeMap(supabase, ctx.organizationId, accounts);
  const rows = await fetchPendingPettyCash(supabase, ctx.organizationId);
  const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'petty_cash', rows.map((r) => r.id));
  return rows
    .filter((r) => !existing.has(r.id))
    .map((r) => {
      const { lines, warning } = pettyCashJournalLines(r, mapping);
      return buildCandidateView({
        sourceType: 'petty_cash',
        sourceId: r.id,
        date: r.businessDate,
        description: r.purpose ?? (r.kind === 'petty_in' ? '小口現金入金' : '小口現金出金'),
        storeId: r.storeId,
        storeName: r.storeName,
        lines,
        accounts,
        alreadyPosted: false,
        warning,
      });
    });
}

export async function createPettyCashJournalEntries(cashTxIds: string[], post: boolean): Promise<CreateResult> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const mapping = await loadExpenseAccountCodeMap(supabase, ctx.organizationId, accounts);
  const rows = await fetchPendingPettyCash(supabase, ctx.organizationId, cashTxIds);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'petty_cash', cashTxIds);

  const result: CreateResult = { ok: 0, skipped: 0, failed: [] };
  for (const id of cashTxIds) {
    try {
      if (existing.has(id)) {
        result.skipped += 1;
        continue;
      }
      const row = rowById.get(id);
      if (!row) {
        result.failed.push({ key: id, reason: '小口現金の記録が見つかりません（承認待ちの可能性があります）' });
        continue;
      }
      const { lines: draftLines } = pettyCashJournalLines(row, mapping);
      const { lines, missing } = resolveLines(draftLines, accounts);
      if (missing.length > 0) {
        result.failed.push({ key: id, reason: `勘定科目が未導入です（${missing.join('、')}）` });
        continue;
      }
      await insertJournalEntry(supabase, {
        organizationId: ctx.organizationId,
        storeId: row.storeId,
        entryDate: row.businessDate,
        description: row.purpose ?? (row.kind === 'petty_in' ? '小口現金入金' : '小口現金出金'),
        sourceType: 'petty_cash',
        sourceId: id,
        lines,
        userId: ctx.userId,
        post,
      });
      result.ok += 1;
    } catch (err) {
      result.failed.push({ key: id, reason: err instanceof Error ? err.message : '仕訳の作成に失敗しました' });
    }
  }
  revalidatePath(PATH);
  return result;
}

// -------------------------------------------------------------
// 給与
// -------------------------------------------------------------

export async function previewPayrollJournal(): Promise<JournalCandidateView[]> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const rows = await fetchPendingPayrollRuns(supabase, ctx.organizationId);
  const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'payroll', rows.map((r) => r.id));
  return rows
    .filter((r) => !existing.has(r.id) && r.grossTotal > 0)
    .map((r) =>
      buildCandidateView({
        sourceType: 'payroll',
        sourceId: r.id,
        date: r.periodEnd,
        description: `給与（${r.title}）`,
        storeId: r.storeId,
        storeName: r.storeName,
        lines: payrollJournalLines(r),
        accounts,
        alreadyPosted: false,
      })
    );
}

export async function createPayrollJournalEntries(payrollRunIds: string[], post: boolean): Promise<CreateResult> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const rows = await fetchPendingPayrollRuns(supabase, ctx.organizationId, payrollRunIds);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const existing = await loadExistingSourceIds(supabase, ctx.organizationId, 'payroll', payrollRunIds);

  const result: CreateResult = { ok: 0, skipped: 0, failed: [] };
  for (const id of payrollRunIds) {
    try {
      if (existing.has(id)) {
        result.skipped += 1;
        continue;
      }
      const row = rowById.get(id);
      if (!row || row.grossTotal <= 0) {
        result.failed.push({ key: id, reason: '給与の確定額が見つかりません' });
        continue;
      }
      const draftLines = payrollJournalLines(row);
      const { lines, missing } = resolveLines(draftLines, accounts);
      if (missing.length > 0) {
        result.failed.push({ key: id, reason: `勘定科目が未導入です（${missing.join('、')}）` });
        continue;
      }
      await insertJournalEntry(supabase, {
        organizationId: ctx.organizationId,
        storeId: row.storeId,
        entryDate: row.periodEnd,
        description: `給与（${row.title}）`,
        sourceType: 'payroll',
        sourceId: id,
        lines,
        userId: ctx.userId,
        post,
      });
      result.ok += 1;
    } catch (err) {
      result.failed.push({ key: id, reason: err instanceof Error ? err.message : '仕訳の作成に失敗しました' });
    }
  }
  revalidatePath(PATH);
  return result;
}

// -------------------------------------------------------------
// 費目マッピング・初期設定
// -------------------------------------------------------------

export async function saveExpenseAccountMapping(expenseAccountId: string, accountId: string | null) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { error } = await supabase
    .from('expense_accounts')
    .update({ account_id: accountId, updated_by: ctx.userId })
    .eq('id', expenseAccountId)
    .eq('organization_id', ctx.organizationId);
  if (error) throw new Error(friendlyJournalError(error.message));
  revalidatePath(PATH);
}

/** 標準勘定科目テンプレートの導入（未導入の組織向け・冪等） */
export async function installStandardAccounts() {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const { error } = await supabase.rpc('install_standard_accounts', { p_org: ctx.organizationId });
  if (error) throw new Error(friendlyJournalError(error.message));
  revalidatePath(PATH);
  revalidatePath('/app/accounting/banks');
}
