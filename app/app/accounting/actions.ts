'use server';

import { revalidatePath } from 'next/cache';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { validateJournalBalance, type TaxTreatment } from '@/lib/accounting';
import { canWriteAccounting, canReopenPeriod } from '@/components/accounting/roles';
import { mapAccountingError } from '@/components/accounting/labels';

export interface ActionResult {
  error?: string;
}

const LIST_PATH = '/app/accounting';
const LEDGER_PATH = '/app/accounting/ledger';
const STATEMENTS_PATH = '/app/accounting/statements';

function revalidateAccounting() {
  revalidatePath(LIST_PATH);
  revalidatePath(LEDGER_PATH);
  revalidatePath(STATEMENTS_PATH);
}

export interface JournalLineInput {
  accountId: string;
  side: 'debit' | 'credit';
  amount: number;
  taxTreatment: TaxTreatment;
  memo: string | null;
}

export interface JournalEntryInput {
  entryDate: string;
  description: string;
  storeId: string | null;
  lines: JournalLineInput[];
}

async function requireAccountingWrite() {
  const ctx = await requireFeature('accounting');
  if (!canWriteAccounting(ctx.role)) throw new Error('この操作を行う権限がありません');
  return ctx;
}

function validateEntryInput(input: JournalEntryInput): string | null {
  if (!input.entryDate) return '日付を入力してください';
  if (!input.description.trim()) return '摘要を入力してください';
  const validLines = input.lines.filter((l) => l.accountId && l.amount > 0);
  if (validLines.length < 2) return '明細は2行以上入力してください';
  const balance = validateJournalBalance(validLines);
  if (!balance.balanced) return `借方合計（${balance.debit}）と貸方合計（${balance.credit}）が一致していません`;
  return null;
}

async function insertLines(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  entryId: string,
  storeId: string | null,
  lines: JournalLineInput[]
): Promise<string | null> {
  const validLines = lines.filter((l) => l.accountId && l.amount > 0);
  const { error } = await supabase.from('journal_entry_lines').insert(
    validLines.map((l, idx) => ({
      organization_id: organizationId,
      entry_id: entryId,
      line_no: idx + 1,
      account_id: l.accountId,
      side: l.side,
      amount: Math.round(l.amount),
      tax_treatment: l.taxTreatment,
      store_id: storeId,
      memo: l.memo,
    }))
  );
  return error ? error.message : null;
}

/** 下書き仕訳の作成（借方=貸方が一致している場合のみ呼び出し側で許可する） */
export async function createDraftEntry(input: JournalEntryInput): Promise<{ id?: string; error?: string }> {
  const ctx = await requireAccountingWrite();
  const validationError = validateEntryInput(input);
  if (validationError) return { error: validationError };
  if (input.storeId && !ctx.stores.some((s) => s.id === input.storeId)) {
    return { error: '対象店舗にアクセス権がありません' };
  }

  const supabase = await createClient();
  const { data: entry, error } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      entry_date: input.entryDate,
      description: input.description.trim(),
      status: 'draft',
      source_type: 'manual',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !entry) return { error: `仕訳の作成に失敗しました: ${error?.message ?? ''}` };

  const lineError = await insertLines(supabase, ctx.organizationId, entry.id as string, input.storeId, input.lines);
  if (lineError) return { error: `明細の作成に失敗しました: ${lineError}` };

  revalidateAccounting();
  return { id: entry.id as string };
}

/** 下書き仕訳の更新（draft のみ。明細は一旦削除して入れ直す） */
export async function updateDraftEntry(entryId: string, input: JournalEntryInput): Promise<ActionResult> {
  const ctx = await requireAccountingWrite();
  const validationError = validateEntryInput(input);
  if (validationError) return { error: validationError };
  if (input.storeId && !ctx.stores.some((s) => s.id === input.storeId)) {
    return { error: '対象店舗にアクセス権がありません' };
  }

  const supabase = await createClient();
  const { data: entry } = await supabase
    .from('journal_entries')
    .select('status')
    .eq('id', entryId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (!entry) return { error: '仕訳が見つかりません' };
  if (entry.status !== 'draft') return { error: 'この仕訳はすでに確定・取消されています' };

  const { error: updErr } = await supabase
    .from('journal_entries')
    .update({
      entry_date: input.entryDate,
      description: input.description.trim(),
      store_id: input.storeId,
      updated_by: ctx.userId,
    })
    .eq('id', entryId);
  if (updErr) return { error: `仕訳の更新に失敗しました: ${updErr.message}` };

  const { error: delErr } = await supabase.from('journal_entry_lines').delete().eq('entry_id', entryId);
  if (delErr) return { error: `明細の更新に失敗しました: ${delErr.message}` };

  const lineError = await insertLines(supabase, ctx.organizationId, entryId, input.storeId, input.lines);
  if (lineError) return { error: `明細の更新に失敗しました: ${lineError}` };

  revalidateAccounting();
  return {};
}

/** 下書き仕訳の削除（draft のみ。明細は cascade で削除される） */
export async function deleteDraftEntry(entryId: string): Promise<ActionResult> {
  const ctx = await requireAccountingWrite();
  const supabase = await createClient();
  const { data: entry } = await supabase
    .from('journal_entries')
    .select('status')
    .eq('id', entryId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (!entry) return { error: '仕訳が見つかりません' };
  if (entry.status !== 'draft') return { error: 'この仕訳はすでに確定・取消されています' };

  const { error } = await supabase.from('journal_entries').delete().eq('id', entryId);
  if (error) return { error: `仕訳の削除に失敗しました: ${error.message}` };

  revalidateAccounting();
  return {};
}

/** 仕訳の確定（rpc post_journal_entry。借方=貸方の再検証・締め済み期間の拒否はDB側） */
export async function postEntry(entryId: string): Promise<ActionResult> {
  await requireAccountingWrite();
  const supabase = await createClient();
  const { error } = await supabase.rpc('post_journal_entry', { p_entry_id: entryId });
  if (error) return { error: mapAccountingError(error.message) };
  revalidateAccounting();
  return {};
}

/** 確定済み仕訳の取消（理由必須。rpc void_journal_entry） */
export async function voidEntry(entryId: string, reason: string): Promise<ActionResult> {
  await requireAccountingWrite();
  if (!reason.trim()) return { error: '理由を入力してください' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('void_journal_entry', { p_entry_id: entryId, p_reason: reason.trim() });
  if (error) return { error: mapAccountingError(error.message) };
  revalidateAccounting();
  return {};
}

/** 修正仕訳の作成: 元仕訳（posted）の明細を貸借反転してコピーし、correction_of を設定した新規 draft を作る */
export async function createCorrectionEntry(entryId: string): Promise<{ id?: string; error?: string }> {
  const ctx = await requireAccountingWrite();
  const supabase = await createClient();
  const { data: original } = await supabase
    .from('journal_entries')
    .select('id, entry_date, description, store_id, status')
    .eq('id', entryId)
    .eq('organization_id', ctx.organizationId)
    .single();
  if (!original) return { error: '元の仕訳が見つかりません' };
  if (original.status !== 'posted') return { error: '確定済みの仕訳のみ修正仕訳を作成できます' };

  const { data: lines } = await supabase
    .from('journal_entry_lines')
    .select('account_id, side, amount, tax_treatment, memo')
    .eq('entry_id', entryId)
    .order('line_no');
  if (!lines || lines.length === 0) return { error: '元の仕訳に明細がありません' };

  const { data: entry, error } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: ctx.organizationId,
      store_id: original.store_id,
      entry_date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
      description: `修正: ${original.description}`,
      status: 'draft',
      source_type: 'correction',
      correction_of: entryId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !entry) return { error: `修正仕訳の作成に失敗しました: ${error?.message ?? ''}` };

  const reversed = lines.map((l) => ({
    accountId: l.account_id as string,
    side: (l.side === 'debit' ? 'credit' : 'debit') as 'debit' | 'credit',
    amount: l.amount as number,
    taxTreatment: l.tax_treatment as TaxTreatment,
    memo: l.memo as string | null,
  }));
  const lineError = await insertLines(supabase, ctx.organizationId, entry.id as string, original.store_id, reversed);
  if (lineError) return { error: `修正仕訳の明細作成に失敗しました: ${lineError}` };

  revalidateAccounting();
  return { id: entry.id as string };
}

export interface PeriodStatusResult {
  status: 'open' | 'closed';
  draftCount: number;
  error?: string;
}

/** 指定月の締め状態と、その月に残っている下書き仕訳数を取得する */
export async function getPeriodStatus(month: string): Promise<PeriodStatusResult> {
  const ctx = await requireFeature('accounting');
  const supabase = await createClient();
  const monthStart = `${month}-01`;

  const [{ data: period }, { count }] = await Promise.all([
    supabase
      .from('accounting_periods')
      .select('status')
      .eq('organization_id', ctx.organizationId)
      .eq('month', monthStart)
      .maybeSingle(),
    supabase
      .from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'draft')
      .gte('entry_date', monthStart)
      .lt('entry_date', nextMonth(monthStart)),
  ]);

  return { status: (period?.status as 'open' | 'closed' | undefined) ?? 'open', draftCount: count ?? 0 };
}

function nextMonth(monthStart: string): string {
  const d = new Date(`${monthStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/** 月次締め（rpc close_accounting_period）。下書きが残っている場合は件数付きで案内する */
export async function closeMonth(month: string): Promise<ActionResult> {
  const ctx = await requireAccountingWrite();
  const supabase = await createClient();
  const { error } = await supabase.rpc('close_accounting_period', { p_org: ctx.organizationId, p_month: `${month}-01` });
  if (error) {
    if (error.message.includes('DRAFT_ENTRIES_REMAIN')) {
      const { draftCount } = await getPeriodStatus(month);
      return { error: `下書き仕訳が${draftCount}件残っています` };
    }
    return { error: mapAccountingError(error.message) };
  }
  revalidateAccounting();
  return {};
}

/** 締め解除（org_owner/hq_admin のみ・理由必須。rpc reopen_accounting_period） */
export async function reopenMonth(month: string, reason: string): Promise<ActionResult> {
  const ctx = await requireFeature('accounting');
  if (!canReopenPeriod(ctx.role)) return { error: 'この操作を行う権限がありません' };
  if (!reason.trim()) return { error: '理由を入力してください' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('reopen_accounting_period', {
    p_org: ctx.organizationId,
    p_month: `${month}-01`,
    p_reason: reason.trim(),
  });
  if (error) return { error: mapAccountingError(error.message) };
  revalidateAccounting();
  return {};
}
