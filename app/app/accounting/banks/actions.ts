'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { friendlyJournalError, insertJournalEntry, loadAccounts, resolveLines } from '../auto/engine';
import type { JournalLineDraft } from '@/lib/accounting';

const LIST_PATH = '/app/accounting/banks';

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 対象の銀行口座が組織に属することを確認する（他組織のIDを指定されても操作できないようにする） */
async function assertBankAccount(supabase: Supabase, organizationId: string, bankAccountId: string) {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('id, account_id, store_id')
    .eq('id', bankAccountId)
    .eq('organization_id', organizationId)
    .single();
  if (error || !data) throw new Error('銀行口座が見つかりません');
  return data as { id: string; account_id: string | null; store_id: string | null };
}

// -------------------------------------------------------------
// 銀行口座 CRUD
// -------------------------------------------------------------

export interface BankAccountInput {
  storeId: string | null;
  bankName: string;
  branchName: string | null;
  accountType: 'ordinary' | 'checking' | 'savings';
  accountLast4: string | null;
  holderName: string | null;
  accountId: string | null;
}

function validateBankAccountInput(input: BankAccountInput) {
  if (!input.bankName.trim()) throw new Error('銀行名を入力してください');
  if (input.accountLast4 && !/^\d{1,4}$/.test(input.accountLast4)) {
    throw new Error('口座番号は末尾4桁までの数字で入力してください');
  }
}

export async function createBankAccount(input: BankAccountInput) {
  const ctx = await requirePermission('csv.export');
  validateBankAccountInput(input);
  if (input.storeId && !ctx.stores.some((s) => s.id === input.storeId)) {
    throw new Error('対象店舗にアクセス権がありません');
  }
  const supabase = await createClient();
  const { error } = await supabase.from('bank_accounts').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    bank_name: input.bankName.trim(),
    branch_name: input.branchName?.trim() || null,
    account_type: input.accountType,
    account_last4: input.accountLast4 || null,
    holder_name: input.holderName?.trim() || null,
    account_id: input.accountId,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(friendlyJournalError(error.message));
  revalidatePath(LIST_PATH);
}

export async function updateBankAccount(bankAccountId: string, input: BankAccountInput) {
  const ctx = await requirePermission('csv.export');
  validateBankAccountInput(input);
  if (input.storeId && !ctx.stores.some((s) => s.id === input.storeId)) {
    throw new Error('対象店舗にアクセス権がありません');
  }
  const supabase = await createClient();
  await assertBankAccount(supabase, ctx.organizationId, bankAccountId);
  const { error } = await supabase
    .from('bank_accounts')
    .update({
      store_id: input.storeId,
      bank_name: input.bankName.trim(),
      branch_name: input.branchName?.trim() || null,
      account_type: input.accountType,
      account_last4: input.accountLast4 || null,
      holder_name: input.holderName?.trim() || null,
      account_id: input.accountId,
      updated_by: ctx.userId,
    })
    .eq('id', bankAccountId);
  if (error) throw new Error(friendlyJournalError(error.message));
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${bankAccountId}`);
}

export async function deleteBankAccount(bankAccountId: string) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  await assertBankAccount(supabase, ctx.organizationId, bankAccountId);
  const { error } = await supabase
    .from('bank_accounts')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', bankAccountId);
  if (error) throw new Error(friendlyJournalError(error.message));
  revalidatePath(LIST_PATH);
}

// -------------------------------------------------------------
// 取引の手入力
// -------------------------------------------------------------

export async function addManualBankTransaction(
  bankAccountId: string,
  input: { date: string; description: string; deposit: number; withdrawal: number }
) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  await assertBankAccount(supabase, ctx.organizationId, bankAccountId);
  if (!input.date) throw new Error('日付を入力してください');
  if (!input.description.trim()) throw new Error('摘要を入力してください');
  const deposit = Math.max(0, Math.round(input.deposit || 0));
  const withdrawal = Math.max(0, Math.round(input.withdrawal || 0));
  if (deposit === 0 && withdrawal === 0) throw new Error('入金または出金のいずれかを入力してください');
  if (deposit > 0 && withdrawal > 0) throw new Error('入金・出金は同時に入力できません（1行1方向）');

  const { error } = await supabase.from('bank_transactions').insert({
    organization_id: ctx.organizationId,
    bank_account_id: bankAccountId,
    transacted_on: input.date,
    description: input.description.trim(),
    deposit,
    withdrawal,
    created_by: ctx.userId,
  });
  if (error) throw new Error(friendlyJournalError(error.message));
  revalidatePath(`${LIST_PATH}/${bankAccountId}`);
}

// -------------------------------------------------------------
// CSV取込
// -------------------------------------------------------------

export interface BankCsvRow {
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
}

function rowHashInput(r: BankCsvRow): string {
  return `${r.date}|${r.description}|${r.deposit}|${r.withdrawal}`;
}

/** プレビュー用: 各行のハッシュと重複有無（bank_transactions.import_hash との照合）を返す */
export async function checkBankCsvDuplicates(bankAccountId: string, rows: BankCsvRow[]): Promise<boolean[]> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  await assertBankAccount(supabase, ctx.organizationId, bankAccountId);
  if (rows.length === 0) return [];
  const hashes = await Promise.all(rows.map((r) => sha256Hex(rowHashInput(r))));
  const { data } = await supabase
    .from('bank_transactions')
    .select('import_hash')
    .eq('bank_account_id', bankAccountId)
    .in('import_hash', hashes);
  const existing = new Set((data ?? []).map((d) => d.import_hash as string));
  return hashes.map((h) => existing.has(h));
}

/** CSV取込の確定。重複（同一date+desc+amountのimport_hash）は自動スキップする */
export async function importBankTransactionsCsv(
  bankAccountId: string,
  rows: BankCsvRow[]
): Promise<{ inserted: number; skipped: number }> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  await assertBankAccount(supabase, ctx.organizationId, bankAccountId);
  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  const hashes = await Promise.all(rows.map((r) => sha256Hex(rowHashInput(r))));
  const { data: existingRows } = await supabase
    .from('bank_transactions')
    .select('import_hash')
    .eq('bank_account_id', bankAccountId)
    .in('import_hash', hashes);
  const existing = new Set((existingRows ?? []).map((d) => d.import_hash as string));

  const toInsert = rows
    .map((r, i) => ({ row: r, hash: hashes[i] }))
    .filter(({ hash }) => !existing.has(hash));

  if (toInsert.length === 0) return { inserted: 0, skipped: rows.length };

  const { error } = await supabase.from('bank_transactions').insert(
    toInsert.map(({ row, hash }) => ({
      organization_id: ctx.organizationId,
      bank_account_id: bankAccountId,
      transacted_on: row.date,
      description: row.description,
      deposit: row.deposit,
      withdrawal: row.withdrawal,
      import_hash: hash,
      created_by: ctx.userId,
    }))
  );
  if (error) throw new Error(friendlyJournalError(error.message));
  revalidatePath(`${LIST_PATH}/${bankAccountId}`);
  return { inserted: toInsert.length, skipped: rows.length - toInsert.length };
}

// -------------------------------------------------------------
// 取引からの仕訳候補作成
// -------------------------------------------------------------

export interface BankJournalItem {
  transactionId: string;
  accountId: string;
}

/**
 * bank_transactions から仕訳を一括作成する。
 * 入金: 借方=預金科目 / 貸方=ユーザー指定科目（既定: 売掛金回収=130）
 * 出金: 借方=ユーザー指定科目（既定: 雑費=599） / 貸方=預金科目
 */
export async function createJournalFromBankTransactions(
  bankAccountId: string,
  items: BankJournalItem[],
  post: boolean
): Promise<{ ok: number; skipped: number; failed: { key: string; reason: string }[] }> {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();
  const bankAccount = await assertBankAccount(supabase, ctx.organizationId, bankAccountId);
  if (!bankAccount.account_id) {
    throw new Error('この銀行口座に対応する勘定科目が設定されていません。口座設定から対応科目を選択してください');
  }
  const accounts = await loadAccounts(supabase, ctx.organizationId);
  const bankAccountRef = accounts.byId.get(bankAccount.account_id);
  if (!bankAccountRef) throw new Error('対応する勘定科目が見つかりません');

  const txIds = items.map((i) => i.transactionId);
  const { data: txRows } = await supabase
    .from('bank_transactions')
    .select('id, transacted_on, description, deposit, withdrawal, journal_entry_id')
    .eq('bank_account_id', bankAccountId)
    .in('id', txIds);
  const txById = new Map((txRows ?? []).map((t) => [t.id as string, t]));

  const result = { ok: 0, skipped: 0, failed: [] as { key: string; reason: string }[] };
  for (const item of items) {
    const key = item.transactionId;
    try {
      const tx = txById.get(item.transactionId);
      if (!tx) {
        result.failed.push({ key, reason: '取引が見つかりません' });
        continue;
      }
      if (tx.journal_entry_id) {
        result.skipped += 1;
        continue;
      }
      const counterpart = accounts.byId.get(item.accountId);
      if (!counterpart) {
        result.failed.push({ key, reason: '勘定科目を選択してください' });
        continue;
      }
      const deposit = tx.deposit as number;
      const withdrawal = tx.withdrawal as number;
      const amount = deposit > 0 ? deposit : withdrawal;
      const draftLines: JournalLineDraft[] =
        deposit > 0
          ? [
              { accountCode: bankAccountRef.code, side: 'debit', amount, taxTreatment: 'out_of_scope', memo: tx.description as string },
              { accountCode: counterpart.code, side: 'credit', amount, taxTreatment: 'out_of_scope', memo: tx.description as string },
            ]
          : [
              { accountCode: counterpart.code, side: 'debit', amount, taxTreatment: 'out_of_scope', memo: tx.description as string },
              { accountCode: bankAccountRef.code, side: 'credit', amount, taxTreatment: 'out_of_scope', memo: tx.description as string },
            ];
      const { lines, missing } = resolveLines(draftLines, accounts);
      if (missing.length > 0) {
        result.failed.push({ key, reason: `勘定科目が未導入です（${missing.join('、')}）` });
        continue;
      }
      const { entryId } = await insertJournalEntry(supabase, {
        organizationId: ctx.organizationId,
        storeId: bankAccount.store_id,
        entryDate: tx.transacted_on as string,
        description: `${tx.description as string}（銀行取引）`,
        sourceType: 'bank',
        sourceId: tx.id as string,
        lines,
        userId: ctx.userId,
        post,
      });
      await supabase.from('bank_transactions').update({ journal_entry_id: entryId }).eq('id', tx.id as string);
      result.ok += 1;
    } catch (err) {
      result.failed.push({ key, reason: err instanceof Error ? err.message : '仕訳の作成に失敗しました' });
    }
  }
  revalidatePath(`${LIST_PATH}/${bankAccountId}`);
  return result;
}
