import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { formatDate, todayJst } from '@/lib/format';
import { loadLeaveAdmin, loadMyLeave } from '@/lib/leave-server';
import {
  addYearsIso,
  daysLabel,
  expiringGrants,
  fractionLabel,
  isLeaveId,
  leaveBalances,
  leaveRequestView,
  leaveTab,
  leaveTotals,
  parseLeaveGrant,
  parseLeavePolicy,
  parseLeaveRequest,
} from '@/lib/native-leave';
import { canReviewRequests } from '@/app/app/attendance/shared';
import {
  approveLeaveRequest,
  createLeaveGrant,
  createLeaveRequest,
  rejectLeaveRequest,
  updateLeavePolicy,
  withdrawLeaveRequest,
} from '@/app/app/leave/actions';
import type { SessionContext } from '@/lib/auth';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * 有給休暇の iPad ネイティブ（GET part=leave ／ POST leave…）。
 * 中身・操作は Web の /app/leave と同じ（読み込み lib/leave-server.ts、操作 app/app/leave/actions.ts）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 *   GET part=leave&tab=mine   … 自分の有給（残日数・申請・取下げ・付与履歴・取得履歴）
 *   GET part=leave&tab=admin  … 管理（attendance.approve：付与の登録・承認待ち・失効間近・スタッフ別残日数・有給付与ルール）
 * 権限は Web と同じ（付与は attendance.approve、承認・却下は店長以上、ルールは org.settings。Server Action の中でももう一度見る）
 */

const FEATURE_OFF: NativeModuleResult = { status: 403, body: { ok: false, error: '有給休暇は使えません' } };
const FORBIDDEN: NativeModuleResult = { status: 403, body: { ok: false, error: 'この操作を行う権限がありません' } };
const bad = (error: string): NativeModuleResult => ({ status: 400, body: { ok: false, error } });

const reply = (r: { ok: boolean; message: string; warning?: boolean }): NativeModuleResult => ({
  body: { ok: r.ok, message: r.message, warning: r.warning === true, ...(r.ok ? {} : { error: r.message }) },
});

const featureOff = (ctx: SessionContext) => ctx.disabledFeatures?.has('attendance') === true;

// ---------------------------------------------------------------
// GET
// ---------------------------------------------------------------

export const leaveGet: NativeModuleGet = async ({ ctx, url }) => {
  if (featureOff(ctx) || !ctx.organizationId) return FEATURE_OFF;
  const organizationId = ctx.organizationId;
  const isApprover = can(ctx.role, 'attendance.approve');
  const canSetPolicy = can(ctx.role, 'org.settings');
  const canReview = canReviewRequests(ctx.role);
  const tab = leaveTab(url.searchParams.get('tab'), isApprover);
  const today = todayJst();
  const supabase = await createClient();
  const base = { ok: true, tab, displayName: ctx.displayName, isApprover, canReview, canSetPolicy, today };

  if (tab === 'mine') {
    const { grantRows, takenRows, requestRows } = await loadMyLeave(supabase, { organizationId, profileId: ctx.userId });
    return {
      body: {
        ...base,
        summary: leaveTotals(grantRows, takenRows, today),
        requests: requestRows.map(leaveRequestView),
        grants: grantRows.map((g) => ({
          id: g.id,
          grantedLabel: formatDate(g.granted_on),
          daysLabel: daysLabel(g.days),
          expiresLabel: formatDate(g.expires_on),
          reasonLabel: g.reason === 'adjustment' ? '調整' : '年次付与',
          expired: g.expires_on < today,
        })),
        taken: takenRows.map((e) => ({
          id: e.id,
          dateLabel: formatDate(e.work_date),
          fractionLabel: fractionLabel(e.leave_fraction),
          note: e.note || '',
        })),
      },
    };
  }

  const { staffOptions, grantRows, takenRows, orgPolicy, pendingRequests } = await loadLeaveAdmin(
    supabase,
    { organizationId, isHq: ctx.isHq, stores: ctx.stores },
    { canSetPolicy }
  );
  const nameByProfile = new Map(staffOptions.map((s) => [s.id, s.name]));
  // Web と同じ既定（ルールが無ければ 2 年）。iPad が読めるように数にそろえる
  const defaultExpiryYears = Number(orgPolicy.expiry_years ?? 2) > 0 ? Number(orgPolicy.expiry_years ?? 2) : 2;
  return {
    body: {
      ...base,
      staffOptions,
      defaultExpiryYears,
      // 付与ダイアログの初期値（Web の grant-dialog と同じ：10日・今日・今日+既定の年数）
      grantDefaults: { days: 10, grantedOn: today, expiresOn: addYearsIso(today, defaultExpiryYears) },
      pending: pendingRequests.map((r) => ({
        id: r.id,
        staffName: nameByProfile.get(r.profile_id) ?? '—',
        dateLabel: formatDate(r.leave_date),
        fractionLabel: fractionLabel(r.fraction),
        reason: r.reason || '',
      })),
      expiringSoon: expiringGrants(grantRows, today).map((g) => ({
        id: g.id,
        staffName: nameByProfile.get(g.profile_id) ?? '—',
        daysLabel: daysLabel(g.days),
        expiresLabel: formatDate(g.expires_on),
      })),
      balances: leaveBalances(staffOptions, grantRows, takenRows, today),
      policy: canSetPolicy ? { expiryYears: defaultExpiryYears, memo: orgPolicy.memo ?? '' } : null,
    },
  };
};

// ---------------------------------------------------------------
// POST
// ---------------------------------------------------------------

/** 有給の申請（本人） */
export const leaveRequestPost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  const p = parseLeaveRequest(raw);
  return p.ok ? reply(await createLeaveRequest(p.value)) : bad(p.error);
};

/** 申請の取下げ（本人・承認待ちのときだけ） */
export const leaveWithdrawPost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  return isLeaveId(raw.requestId) ? reply(await withdrawLeaveRequest(raw.requestId)) : bad('内容が正しくありません');
};

/** 申請の承認（店長以上。勤怠に有給として入る） */
export const leaveApprovePost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!canReviewRequests(ctx.role)) return FORBIDDEN;
  return isLeaveId(raw.requestId) ? reply(await approveLeaveRequest(raw.requestId)) : bad('内容が正しくありません');
};

/** 申請の却下（店長以上・理由が要る） */
export const leaveRejectPost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!canReviewRequests(ctx.role)) return FORBIDDEN;
  if (!isLeaveId(raw.requestId)) return bad('内容が正しくありません');
  return reply(await rejectLeaveRequest(raw.requestId, typeof raw.reason === 'string' ? raw.reason : ''));
};

/** 付与の登録（attendance.approve） */
export const leaveGrantPost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!can(ctx.role, 'attendance.approve')) return FORBIDDEN;
  const p = parseLeaveGrant(raw);
  return p.ok ? reply(await createLeaveGrant(p.value)) : bad(p.error);
};

/** 会社の有給付与ルール（org.settings） */
export const leavePolicyPost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!can(ctx.role, 'org.settings')) return FORBIDDEN;
  const p = parseLeavePolicy(raw);
  return p.ok ? reply(await updateLeavePolicy(p.value)) : bad(p.error);
};
