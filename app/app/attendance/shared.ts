/**
 * 勤怠関連の共有ヘルパー（'use server' 指定なし・サーバー専用の通常モジュール）。
 * app/app/attendance/actions.ts と app/app/leave/actions.ts の双方から利用する。
 * 'use server' ファイルへ置くとエクスポートが全て公開Server Actionになってしまうため、
 * クライアントから直接呼ばれるべきでないロジックはこちらに集約する。
 */
import type { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/permissions';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 有給申請・勤怠修正申請の承認/却下を行えるロール。
 * migration 00022 の att_corr_admin_update / leave_req_admin_update RLS
 * （['org_owner','hq_admin','area_manager','store_manager']。assistant_manager は含まない）と
 * 揃える。attendance.approve 権限（assistant_manager を含む）とは意図的に異なる点に注意。
 */
export const REQUEST_ADMIN_ROLES: Role[] = ['org_owner', 'hq_admin', 'area_manager', 'store_manager'];

export function canReviewRequests(role: Role | null | undefined): boolean {
  return !!role && REQUEST_ADMIN_ROLES.includes(role);
}

/**
 * 締め後ロック: 指定店舗・指定日が確定済み(confirmed)/承認済み(approved)の給与計算(payroll_runs)の
 * 対象期間に含まれるかを判定する。payroll_runs.store_id が null の run は「全社」対象のため、
 * その run の期間も対象に含める。戻り値は該当する run（最も優先度の高いもの）。
 */
export async function findLockingPayrollRun(
  supabase: SupabaseServerClient,
  organizationId: string,
  storeId: string,
  workDate: string
): Promise<{ id: string; title: string; status: string } | null> {
  const { data } = await supabase
    .from('payroll_runs')
    .select('id, title, status')
    .eq('organization_id', organizationId)
    .in('status', ['confirmed', 'approved'])
    .lte('period_start', workDate)
    .gte('period_end', workDate)
    .or(`store_id.is.null,store_id.eq.${storeId}`)
    .order('status', { ascending: false }) // approved を優先して案内する
    .limit(1);
  return data?.[0] ?? null;
}

export async function isPayrollLocked(
  supabase: SupabaseServerClient,
  organizationId: string,
  storeId: string,
  workDate: string
): Promise<boolean> {
  const run = await findLockingPayrollRun(supabase, organizationId, storeId, workDate);
  return !!run;
}

export const PAYROLL_LOCKED_MESSAGE = 'この期間は給与計算が確定済みのためロックされています';

/** JST の日付+時刻文字列を ISO(UTC) に変換する */
export function jstToIso(workDate: string, hhmm: string): string {
  return new Date(`${workDate}T${hhmm}:00+09:00`).toISOString();
}

export interface InsertLeaveTimeEntryInput {
  organizationId: string;
  storeId: string;
  profileId: string;
  workDate: string;
  /** 全休=1 / 半休=0.5 */
  leaveFraction: 1 | 0.5;
  note: string;
  approvedBy: string;
}

/**
 * 有給取得を time_entries に反映する共通ロジック。
 * addManualEntry（勤怠の手動追加・有給/欠勤）と有給申請の承認処理から共用する。
 * clock_in_at/clock_out_at は null のまま entry_type='paid_leave' で status='approved' 登録する。
 */
export async function insertLeaveTimeEntry(
  supabase: SupabaseServerClient,
  input: InsertLeaveTimeEntryInput
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      organization_id: input.organizationId,
      store_id: input.storeId,
      profile_id: input.profileId,
      work_date: input.workDate,
      clock_in_at: null,
      clock_out_at: null,
      break_minutes: 0,
      entry_type: 'paid_leave',
      leave_fraction: input.leaveFraction,
      status: 'approved',
      source: 'manual',
      note: input.note,
      approved_by: input.approvedBy,
      approved_at: new Date().toISOString(),
      created_by: input.approvedBy,
    })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? '勤怠記録の作成に失敗しました' };
  return { id: data.id };
}

/** 有給残数（有効な付与合計 − 取得合計）を計算する。承認前の警告表示・申請時の目安表示に使う。 */
export async function calcLeaveRemaining(
  supabase: SupabaseServerClient,
  organizationId: string,
  profileId: string,
  today: string
): Promise<number> {
  const [{ data: grants }, { data: takenEntries }] = await Promise.all([
    supabase.from('leave_grants').select('days, expires_on').eq('organization_id', organizationId).eq('profile_id', profileId),
    supabase
      .from('time_entries')
      .select('leave_fraction')
      .eq('organization_id', organizationId)
      .eq('profile_id', profileId)
      .eq('entry_type', 'paid_leave')
      .in('status', ['approved', 'closed']),
  ]);
  const activeGranted = (grants ?? []).filter((g) => g.expires_on >= today).reduce((a, g) => a + Number(g.days), 0);
  const taken = (takenEntries ?? []).reduce((a, e) => a + Number(e.leave_fraction ?? 1), 0);
  return activeGranted - taken;
}

/** DB例外メッセージ（PostgreSQLの RAISE EXCEPTION）を日本語UIメッセージへ変換する */
export function mapDbErrorMessage(message: string | undefined | null, fallback: string): string {
  if (!message) return fallback;
  if (message.includes('PAYROLL_RUN_LOCKED')) return '確定済みの給与計算に関わるデータは変更できません';
  if (message.includes('duplicate key') && message.includes('leave_requests')) return 'この日はすでに有給申請が存在します';
  if (message.includes('duplicate key')) return '同じ内容がすでに登録されています';
  return fallback;
}
