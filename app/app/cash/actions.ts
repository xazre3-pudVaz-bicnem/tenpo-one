'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission, requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveApprovalRule, checkApproval, type ApprovalRuleLike } from '@/lib/approvals';
import type { Role } from '@/lib/permissions';
import { captureServerError } from '@/lib/observability-server';
import { actionFail, actionOk, type ActionResult } from '@/lib/action-error';
import { enqueueRegisterReportPrint } from '@/lib/register-report-loader';
import type { CloseRegisterResult, DenominationJson } from '@/lib/register-report';

/** 店舗日次締め（close_store_day）を実行できるロール。DB側 close_store_day のapp_role_inと一致させること。 */
const STORE_DAY_CLOSE_ROLES: Role[] = ['org_owner', 'hq_admin', 'area_manager', 'store_manager', 'assistant_manager'];
/** 店舗日次締めの再オープン（reopen_store_day）を実行できるロール。DB側と一致させること。 */
const STORE_DAY_REOPEN_ROLES: Role[] = ['org_owner', 'hq_admin', 'area_manager'];

/**
 * レジ開局・レジ締めRPCのエラーコードを現場の言葉にする。
 * SESSION_ALREADY_OPEN は「画面では未開局なのに開局できない」＝前営業日から開きっぱなし、
 * という分かりにくい状況で出るため、次に何をすればよいかまで書く。
 */
function translateRegisterError(message: string): string {
  if (message.includes('SESSION_ALREADY_OPEN')) {
    return 'このレジは既に開局しています。前営業日から開いたままの可能性があります。レジクローズ画面の「開局中のレジ」を締めてから、もう一度開局してください。';
  }
  if (message.includes('SESSION_NOT_FOUND')) return '対象のレジセッションが見つかりません';
  if (message.includes('SESSION_NOT_OPEN')) return 'このレジは既に締められています';
  if (message.includes('STORE_NOT_FOUND')) return '店舗が見つかりません';
  if (message.includes('FORBIDDEN')) return 'レジ操作の権限がありません';
  return message;
}

function assertPositiveInt(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}は1円以上の整数で入力してください`);
  }
}

/** 組織の承認ルール（target='petty_cash'）をApprovalRuleLike形式で取得 */
async function loadPettyCashApprovalRules(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string
): Promise<ApprovalRuleLike[]> {
  const { data } = await supabase
    .from('approval_rules')
    .select('target, min_amount, max_amount, approver_role, allow_self_approve')
    .eq('organization_id', organizationId)
    .eq('target', 'petty_cash');
  return (data ?? []).map((r) => ({
    target: r.target as ApprovalRuleLike['target'],
    minAmount: r.min_amount as number,
    maxAmount: r.max_amount as number | null,
    approverRole: r.approver_role as ApprovalRuleLike['approverRole'],
    allowSelfApprove: r.allow_self_approve as boolean,
  }));
}

/**
 * 金種別枚数の引数（p_opening_denominations / p_counted_denominations）を DB 側がまだ知らない
 * （migration 00062 未適用でコードだけ先に出た）ときの PostgREST エラーか。
 * その場合は金種を付けずに旧シグネチャで呼び直す（開局・締め自体は止めない）。
 */
function isUnknownDenominationsArg(message: string): boolean {
  return /denominations/.test(message) && /function|PGRST202|schema cache/i.test(message);
}

/** 金種別枚数（jsonb 保存用）の形式チェック。金種キーは 1〜10000、枚数は0以上の整数 */
function validDenominations(raw: DenominationJson | null | undefined): boolean {
  if (raw == null) return true;
  if (typeof raw !== 'object') return false;
  return Object.entries(raw).every(
    ([k, v]) => /^\d+$/.test(k) && Number.isInteger(v) && v >= 0 && v <= 1_000_000
  );
}

/**
 * レジ開局（open_register_session RPC）。
 * 釣銭準備金は金種別に数えた枚数（denominations）の合計で、枚数も一緒に保存する
 * （毎日の開局時に「いくら入っているか」を必ず数える運用。締めの精算レシートと突き合わせられる）。
 */
export async function openRegister(
  storeId: string,
  registerId: string,
  openingFloat: number,
  denominations: DenominationJson | null = null
): Promise<ActionResult> {
  // 失敗を throw ではなく戻り値で返す（throw すると本番でメッセージが伏せられ、
  // 画面には「Minified React error #441」しか出ない。lib/action-error.ts 参照）。
  const ctx = await requirePermission('register.operate');
  if (!ctx.stores.some((s) => s.id === storeId)) {
    return actionFail('対象店舗にアクセス権がありません');
  }
  if (!Number.isInteger(openingFloat) || openingFloat < 0) {
    return actionFail('釣銭準備金は0以上の整数で入力してください');
  }
  if (!validDenominations(denominations)) return actionFail('金種別の枚数が正しくありません');
  const supabase = await createClient();
  let { error } = await supabase.rpc('open_register_session', {
    p_store_id: storeId,
    p_register_id: registerId,
    p_opening_float: openingFloat,
    p_opening_denominations: denominations ?? undefined,
  });
  if (error && denominations && isUnknownDenominationsArg(error.message)) {
    ({ error } = await supabase.rpc('open_register_session', {
      p_store_id: storeId,
      p_register_id: registerId,
      p_opening_float: openingFloat,
    }));
  }
  if (error) return actionFail(translateRegisterError(error.message));
  revalidatePath('/app/cash');
  revalidatePath('/app/pos');
  return actionOk();
}

/** 開局中セッションへの中間入出金（deposit/withdrawal） */
export async function addCashTransaction(input: {
  storeId: string;
  registerSessionId: string;
  kind: 'deposit' | 'withdrawal';
  amount: number;
  purpose: string;
}) {
  const ctx = await requirePermission('register.operate');
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    throw new Error('対象店舗にアクセス権がありません');
  }
  assertPositiveInt(input.amount, '金額');
  if (!input.purpose.trim()) throw new Error('用途を入力してください');

  const supabase = await createClient();
  const { error } = await supabase.from('cash_transactions').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    register_session_id: input.registerSessionId,
    kind: input.kind,
    amount: input.amount,
    purpose: input.purpose.trim(),
    approval_status: 'approved',
    approved_by: ctx.userId,
    approved_at: new Date().toISOString(),
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/app/cash');
}

/**
 * レジ締め（close_register_session RPC。理論現金・差異はDB側で計算）。
 * 締めが成功したら、その営業日のレジ精算レシート（売上・支払別・精算・入出金・業務履歴）を
 * レシートプリンターから自動で出す。印刷だけ失敗しても締めは取り消さない（printWarning で知らせる）。
 */
export async function closeRegister(
  sessionId: string,
  countedCash: number,
  differenceReason: string | null,
  denominations: DenominationJson | null = null
): Promise<CloseRegisterResult> {
  const ctx = await requirePermission('register.operate');
  if (!Number.isInteger(countedCash) || countedCash < 0) {
    return actionFail('実残高は0以上の整数で入力してください');
  }
  if (!validDenominations(denominations)) return actionFail('金種別の枚数が正しくありません');
  const supabase = await createClient();
  const { data: session } = await supabase
    .from('register_sessions')
    .select('id, store_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session || !ctx.stores.some((s) => s.id === session.store_id)) {
    return actionFail('対象のレジセッションが見つかりません');
  }
  let { error } = await supabase.rpc('close_register_session', {
    p_session_id: sessionId,
    p_counted_cash: countedCash,
    p_difference_reason: differenceReason,
    p_counted_denominations: denominations ?? undefined,
  });
  if (error && denominations && isUnknownDenominationsArg(error.message)) {
    ({ error } = await supabase.rpc('close_register_session', {
      p_session_id: sessionId,
      p_counted_cash: countedCash,
      p_difference_reason: differenceReason,
    }));
  }
  if (error) return actionFail(translateRegisterError(error.message));

  let printWarning: string | null = null;
  try {
    const printed = await enqueueRegisterReportPrint(supabase, sessionId, ctx.userId);
    if (!printed.ok) printWarning = printed.error ?? 'レジ精算レシートを印刷できませんでした';
  } catch (err) {
    await captureServerError(err, {
      route: 'cash.close_register.print',
      organizationId: ctx.organizationId,
      storeId: session.store_id,
      userId: ctx.userId,
    });
    printWarning = 'レジ精算レシートを印刷できませんでした（締めは完了しています。「精算レシートを再印刷」で出せます）';
  }
  revalidatePath('/app/cash');
  revalidatePath('/app/pos');
  return { ok: true, printWarning };
}

/**
 * レジ精算レシートの再印刷（締め済み・開局中どちらでも可。開局中は「途中集計」として出る）。
 * 紙詰まり・プリンター未接続で出なかったときと、本部が控えを取りたいとき用。
 */
export async function reprintRegisterReport(sessionId: string): Promise<ActionResult> {
  const ctx = await requirePermission('register.operate');
  const supabase = await createClient();
  const { data: session } = await supabase
    .from('register_sessions')
    .select('id, store_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session || !ctx.stores.some((s) => s.id === session.store_id)) {
    return actionFail('対象のレジセッションが見つかりません');
  }
  const printed = await enqueueRegisterReportPrint(supabase, sessionId, ctx.userId);
  if (!printed.ok) return actionFail(printed.error ?? 'レジ精算レシートを印刷できませんでした');
  return actionOk();
}

/**
 * 小口現金の入出金・立替・精算登録（承認待ちで作成）。
 * register_session_id は常にnull（レジ台帳とは別台帳。POSの現金売上=saleはここでは扱わない）。
 * petty_advance（立替）は現金が動かない記録のため、残高計算からは除外される（labels.ts の IN_KINDS/OUT_KINDS 参照）。
 */
export async function addPettyCash(input: {
  storeId: string;
  kind: 'petty_in' | 'petty_out' | 'petty_advance' | 'petty_settlement';
  amount: number;
  purpose: string;
  expenseAccountId: string | null;
}) {
  const ctx = await requirePermission('cash.write');
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    throw new Error('対象店舗にアクセス権がありません');
  }
  assertPositiveInt(input.amount, '金額');
  if (!input.purpose.trim()) throw new Error('用途を入力してください');

  const supabase = await createClient();
  const { error } = await supabase.from('cash_transactions').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    register_session_id: null,
    kind: input.kind,
    amount: input.amount,
    purpose: input.purpose.trim(),
    expense_account_id: input.expenseAccountId,
    approval_status: 'pending',
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/app/cash');
}

/** 小口現金の承認 */
export async function approvePettyCash(id: string) {
  const ctx = await requirePermission('cash.approve');
  const supabase = await createClient();
  const { data: tx } = await supabase
    .from('cash_transactions')
    .select('organization_id, store_id, approval_status, amount, created_by')
    .eq('id', id)
    .single();
  if (!tx) throw new Error('対象の入出金が見つかりません');
  if (tx.approval_status !== 'pending') throw new Error('承認待ちの入出金のみ承認できます');

  const rules = await loadPettyCashApprovalRules(supabase, tx.organization_id);
  const rule = resolveApprovalRule(rules, 'petty_cash', tx.amount);
  const check = checkApproval(rule, ctx.role, tx.created_by === ctx.userId);
  if (!check.allowed) {
    if (check.reason === 'insufficient_role') throw new Error(`この金額は${check.requiredRoleLabel}の承認が必要です`);
    throw new Error('自分の登録した入出金は承認できません（設定で変更可能）');
  }

  const { error } = await supabase
    .from('cash_transactions')
    .update({ approval_status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: tx.organization_id,
    p_store: tx.store_id,
    p_action: 'cash_transaction.approve',
    p_target_table: 'cash_transactions',
    p_target_id: id,
    p_before: { approval_status: 'pending' },
    p_after: { approval_status: 'approved' },
    p_note: null,
  });
  revalidatePath('/app/cash');
}

/** 小口現金の差戻し（理由必須） */
export async function rejectPettyCash(id: string, reason: string) {
  const ctx = await requirePermission('cash.approve');
  if (!reason.trim()) throw new Error('差戻し理由を入力してください');

  const supabase = await createClient();
  const { data: tx } = await supabase
    .from('cash_transactions')
    .select('organization_id, store_id, approval_status, amount, created_by')
    .eq('id', id)
    .single();
  if (!tx) throw new Error('対象の入出金が見つかりません');
  if (tx.approval_status !== 'pending') throw new Error('承認待ちの入出金のみ差戻しできます');

  const rules = await loadPettyCashApprovalRules(supabase, tx.organization_id);
  const rule = resolveApprovalRule(rules, 'petty_cash', tx.amount);
  const check = checkApproval(rule, ctx.role, tx.created_by === ctx.userId);
  if (!check.allowed) {
    if (check.reason === 'insufficient_role') throw new Error(`この金額は${check.requiredRoleLabel}の承認が必要です`);
    throw new Error('自分の登録した入出金は差戻しできません（設定で変更可能）');
  }

  const { error } = await supabase
    .from('cash_transactions')
    .update({ approval_status: 'rejected', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: tx.organization_id,
    p_store: tx.store_id,
    p_action: 'cash_transaction.reject',
    p_target_table: 'cash_transactions',
    p_target_id: id,
    p_before: { approval_status: 'pending' },
    p_after: { approval_status: 'rejected' },
    p_note: reason.trim(),
  });
  revalidatePath('/app/cash');
}

/** 締め承認（closed/reopened → approved） */
export async function approveClosing(id: string) {
  const ctx = await requirePermission('register.approve');
  const supabase = await createClient();
  const { data: closing } = await supabase
    .from('daily_closings')
    .select('organization_id, store_id, status')
    .eq('id', id)
    .single();
  if (!closing) throw new Error('締めデータが見つかりません');
  if (!['closed', 'reopened'].includes(closing.status)) {
    throw new Error('承認できる状態ではありません');
  }

  const { error } = await supabase
    .from('daily_closings')
    .update({ status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: closing.organization_id,
    p_store: closing.store_id,
    p_action: 'daily_closing.approve',
    p_target_table: 'daily_closings',
    p_target_id: id,
    p_before: { status: closing.status },
    p_after: { status: 'approved' },
    p_note: null,
  });
  revalidatePath('/app/cash');
}

/** 締め後修正（approved → reopened。数値は変更しない。理由必須） */
export async function reopenClosing(id: string, reason: string) {
  const ctx = await requirePermission('register.approve');
  if (!reason.trim()) throw new Error('修正理由を入力してください');

  const supabase = await createClient();
  const { data: closing } = await supabase
    .from('daily_closings')
    .select('organization_id, store_id, status, note')
    .eq('id', id)
    .single();
  if (!closing) throw new Error('締めデータが見つかりません');
  if (closing.status !== 'approved') throw new Error('承認済みの締めのみ修正できます');

  const noteEntry = `[締め後修正 ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}] ${reason.trim()}`;
  const nextNote = closing.note ? `${closing.note}\n${noteEntry}` : noteEntry;

  const { error } = await supabase
    .from('daily_closings')
    .update({ status: 'reopened', note: nextNote, updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: closing.organization_id,
    p_store: closing.store_id,
    p_action: 'daily_closing.reopen',
    p_target_table: 'daily_closings',
    p_target_id: id,
    p_before: { status: 'approved' },
    p_after: { status: 'reopened' },
    p_note: reason.trim(),
  });
  revalidatePath('/app/cash');
}

// ---------------------------------------------------------------
// 小口現金の開始残高
// ---------------------------------------------------------------

/** 小口現金の開始残高を変更（店舗設定）。理論残高の起点となるため監査ログに記録する */
export async function updatePettyOpeningBalance(storeId: string, amount: number) {
  const ctx = await requirePermission('cash.approve');
  if (!ctx.stores.some((s) => s.id === storeId)) {
    throw new Error('対象店舗にアクセス権がありません');
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('開始残高は0以上の整数で入力してください');
  }
  const supabase = await createClient();
  const { data: settings, error } = await supabase
    .from('store_settings')
    .select('id, organization_id, petty_opening_balance')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!settings) throw new Error('店舗設定が見つかりません');

  const { error: updErr } = await supabase
    .from('store_settings')
    .update({ petty_opening_balance: amount, updated_by: ctx.userId })
    .eq('id', settings.id);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'store_settings.petty_opening_balance',
    p_target_table: 'store_settings',
    p_target_id: settings.id,
    p_before: { petty_opening_balance: settings.petty_opening_balance },
    p_after: { petty_opening_balance: amount },
    p_note: null,
  });
  revalidatePath('/app/cash');
}

// ---------------------------------------------------------------
// 小口現金の実査（petty_cash_counts）
// ---------------------------------------------------------------

/**
 * 実残高のカウントを記録（同日再カウント時は upsert）。
 * 差異は自動計算して保存し、再カウント時は承認状態を「記録済み」に戻す（要再承認）。
 */
export async function recordPettyCashCount(input: {
  storeId: string;
  countDate: string;
  expectedAmount: number;
  countedAmount: number;
  note: string | null;
}) {
  const ctx = await requirePermission('cash.write');
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    throw new Error('対象店舗にアクセス権がありません');
  }
  if (!input.countDate) throw new Error('実査日を入力してください');
  if (!Number.isInteger(input.countedAmount) || input.countedAmount < 0) {
    throw new Error('実残高は0以上の整数で入力してください');
  }
  const supabase = await createClient();
  const difference = input.countedAmount - input.expectedAmount;

  const { data: row, error } = await supabase
    .from('petty_cash_counts')
    .upsert(
      {
        organization_id: ctx.organizationId,
        store_id: input.storeId,
        count_date: input.countDate,
        expected_amount: input.expectedAmount,
        counted_amount: input.countedAmount,
        difference,
        note: input.note?.trim() || null,
        status: 'recorded',
        approved_by: null,
        approved_at: null,
        updated_by: ctx.userId,
        created_by: ctx.userId,
      },
      { onConflict: 'store_id,count_date' }
    )
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'petty_cash_count.record',
    p_target_table: 'petty_cash_counts',
    p_target_id: row.id,
    p_before: null,
    p_after: { expected_amount: input.expectedAmount, counted_amount: input.countedAmount, difference },
    p_note: input.note ?? null,
  });
  revalidatePath('/app/cash');
}

/** 小口現金実査の承認 */
export async function approvePettyCashCount(id: string) {
  const ctx = await requirePermission('cash.approve');
  const supabase = await createClient();
  const { data: count } = await supabase
    .from('petty_cash_counts')
    .select('organization_id, store_id, status')
    .eq('id', id)
    .single();
  if (!count) throw new Error('実査記録が見つかりません');
  if (count.status !== 'recorded') throw new Error('記録済みの実査のみ承認できます');

  const { error } = await supabase
    .from('petty_cash_counts')
    .update({ status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString(), updated_by: ctx.userId })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: count.organization_id,
    p_store: count.store_id,
    p_action: 'petty_cash_count.approve',
    p_target_table: 'petty_cash_counts',
    p_target_id: id,
    p_before: { status: 'recorded' },
    p_after: { status: 'approved' },
    p_note: null,
  });
  revalidatePath('/app/cash');
}

// ---------------------------------------------------------------
// 店舗日次締め（2段階目・v0.4.3）
// ---------------------------------------------------------------

/** close_store_dayのraise exceptionメッセージを日本語化する */
function translateCloseStoreDayError(message: string): string {
  const openMatch = message.match(/OPEN_SESSIONS_REMAIN:\s*(\d+)/);
  if (openMatch) return `未締めのレジが${openMatch[1]}台あります。すべてのレジを締めてから実行してください。`;
  if (message.includes('NO_CLOSED_SESSIONS')) {
    return '本日締めたレジが1台もありません。先に「このレジを開局」→ 現金を数えて「レジ締め」を行ってから、店舗日次締めを実行してください。';
  }
  if (message.includes('STORE_NOT_FOUND')) return '店舗が見つかりません';
  if (message.includes('FORBIDDEN')) return '店舗日次締めの実行権限がありません';
  return message;
}

/** 店舗日次締め（close_store_day RPC）。全レジのセッションを集約してdaily_closingsを確定する */
export async function closeStoreDay(storeId: string, businessDate: string): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!STORE_DAY_CLOSE_ROLES.includes(ctx.role)) {
    return actionFail('店舗日次締めの実行権限がありません');
  }
  if (!ctx.stores.some((s) => s.id === storeId)) {
    return actionFail('対象店舗にアクセス権がありません');
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('close_store_day', {
    p_store_id: storeId,
    p_business_date: businessDate,
  });
  if (error) {
    // 想定内の拒否（未締めレジが残っている等）も含めて記録は残すが、画面には日本語で返す
    await captureServerError(new Error(error.message), {
      route: 'cash.close_store_day',
      organizationId: ctx.organizationId,
      storeId,
      userId: ctx.userId,
    });
    return actionFail(translateCloseStoreDayError(error.message));
  }
  revalidatePath('/app/cash');
  return actionOk();
}

/** close_store_dayの再オープン（reopen_store_day RPC）。理由必須・org_owner/hq_admin/area_managerのみ */
export async function reopenStoreDay(
  storeId: string,
  businessDate: string,
  reason: string
): Promise<ActionResult> {
  const ctx = await requireMember();
  if (!STORE_DAY_REOPEN_ROLES.includes(ctx.role)) {
    return actionFail('店舗日次締めの再オープンは契約企業オーナー・本社管理者・エリアマネージャーのみ実行できます');
  }
  if (!ctx.stores.some((s) => s.id === storeId)) {
    return actionFail('対象店舗にアクセス権がありません');
  }
  if (!reason.trim()) return actionFail('再オープン理由を入力してください');

  const supabase = await createClient();
  const { error } = await supabase.rpc('reopen_store_day', {
    p_store_id: storeId,
    p_business_date: businessDate,
    p_reason: reason.trim(),
  });
  if (error) {
    if (error.message.includes('REASON_REQUIRED')) return actionFail('再オープン理由を入力してください');
    if (error.message.includes('CLOSING_NOT_FOUND')) return actionFail('対象の締めデータが見つかりません');
    if (error.message.includes('FORBIDDEN')) return actionFail('店舗日次締めの再オープン権限がありません');
    return actionFail(error.message);
  }
  revalidatePath('/app/cash');
  return actionOk();
}
