import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { loadAttendanceList, loadCorrectionRequests, loadPunchState } from '@/lib/attendance-server';
import {
  attendanceRowView,
  attendanceTab,
  correctionRequestView,
  isAttendanceId,
  isLockedDate,
  monthLabel,
  monthOrCurrent,
  parseCorrection,
  parseEntryTypeChange,
  parseManualEntry,
  parsePin,
  parsePunchEvent,
  punchView,
  staffIdParam,
  BAD,
  ENTRY_TYPES,
  PUNCH_EVENTS,
} from '@/lib/native-attendance';
import { canReviewRequests } from '@/app/app/attendance/shared';
import { addManualEntry, approveRequest, changeEntryType, punch, punchByPin, rejectRequest, requestCorrection } from '@/app/app/attendance/actions';
import type { SessionContext } from '@/lib/auth';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * 勤怠の iPad ネイティブ（GET part=attendance ／ POST attendance…）。
 * 中身・操作は Web の /app/attendance と同じ（読み込み lib/attendance-server.ts、操作 app/app/attendance/actions.ts）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 *   GET part=attendance&tab=punch                         … 打刻（自分の勤務中・休憩中・本日のシフト・他店舗の出勤）
 *   GET part=attendance&tab=list&month=YYYY-MM&staffId=…  … 勤怠一覧（打刻履歴・ロック。承認する人はスタッフ全員・絞り込み）
 *   GET part=attendance&tab=requests                      … 承認待ちの修正申請（attendance.approve）
 * 権限は Web と同じ（attendance.punch／attendance.approve／修正申請の承認は店長以上。Server Action の中でももう一度見る）
 */

const FEATURE_OFF: NativeModuleResult = { status: 403, body: { ok: false, error: '勤怠は使えません' } };
const FORBIDDEN: NativeModuleResult = { status: 403, body: { ok: false, error: 'この操作を行う権限がありません' } };
const bad = (error: string): NativeModuleResult => ({ status: 400, body: { ok: false, error } });

/** Server Action の返事（{ ok, message, warning }）を iPad の返事に */
const reply = (r: { ok: boolean; message: string; warning?: boolean }): NativeModuleResult => ({
  body: { ok: r.ok, message: r.message, warning: r.warning === true, ...(r.ok ? {} : { error: r.message }) },
});

const featureOff = (ctx: SessionContext) => ctx.disabledFeatures?.has('attendance') === true;

// ---------------------------------------------------------------
// GET
// ---------------------------------------------------------------

export const attendanceGet: NativeModuleGet = async ({ ctx, store, url }) => {
  if (featureOff(ctx) || !ctx.organizationId) return FEATURE_OFF;
  const isApprover = can(ctx.role, 'attendance.approve');
  const canReview = canReviewRequests(ctx.role);
  const tab = attendanceTab(url.searchParams.get('tab'), isApprover);
  const today = todayJst();
  const supabase = await createClient();
  const base = {
    ok: true,
    tab,
    store,
    displayName: ctx.displayName,
    isApprover,
    canReview,
    canPunch: can(ctx.role, 'attendance.punch'),
    // レジ端末のアカウント（企業番号＋レジ用パスワードの iPad）は人ではないので、iPad は共用端末（PIN）で開く
    isRegisterDevice: ctx.isRegisterDevice === true,
    today,
    entryTypes: ENTRY_TYPES,
    punchEvents: PUNCH_EVENTS,
  };

  if (tab === 'punch') {
    const s = await loadPunchState(supabase, { storeId: store.id, profileId: ctx.userId });
    return { body: { ...base, punch: punchView(s) } };
  }

  if (tab === 'list') {
    const month = monthOrCurrent(url.searchParams.get('month'), today);
    const staffId = isApprover ? staffIdParam(url.searchParams.get('staffId')) : '';
    const data = await loadAttendanceList(supabase, {
      storeId: store.id,
      organizationId: ctx.organizationId,
      selfId: ctx.userId,
      isApprover,
      month,
      staffId,
    });
    const nameById = new Map(data.staffOptions.map((s) => [s.id, s.name]));
    const showStaff = isApprover && data.targetProfileIds.length > 1;
    return {
      body: {
        ...base,
        month,
        monthLabel: monthLabel(month),
        staffId,
        staffOptions: isApprover ? data.staffOptions : [],
        showStaff,
        rows: data.rows.map((row) =>
          attendanceRowView(row, {
            today,
            staffName: nameById.get(row.profile_id) ?? null,
            locked: isLockedDate(data.lockedRanges, row.work_date),
            events: data.eventsByEntry.get(row.id) ?? [],
          })
        ),
      },
    };
  }

  // requests（attendanceTab が attendance.approve のときだけ返す）
  const requests = await loadCorrectionRequests(supabase, store.id);
  return { body: { ...base, requests: requests.map(correctionRequestView) } };
};

// ---------------------------------------------------------------
// POST
// ---------------------------------------------------------------

/** 本人の打刻（出勤・休憩開始・休憩終了・退勤） */
export const attendancePunchPost: NativeModulePost = async ({ ctx, store, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!can(ctx.role, 'attendance.punch')) return FORBIDDEN;
  const eventType = parsePunchEvent(raw.eventType);
  return eventType ? reply(await punch(store.id, eventType)) : bad(BAD);
};

/** 共用端末モード：PIN でスタッフを決めて打刻 */
export const attendancePunchPinPost: NativeModulePost = async ({ ctx, store, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!can(ctx.role, 'attendance.punch')) return FORBIDDEN;
  const eventType = parsePunchEvent(raw.eventType);
  if (!eventType) return bad(BAD);
  const pin = parsePin(raw.pin);
  return pin.ok ? reply(await punchByPin(store.id, pin.value, eventType)) : bad(pin.error);
};

/** 修正申請（本人、または attendance.approve が代わりに） */
export const attendanceCorrectionPost: NativeModulePost = async ({ ctx, store, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  const p = parseCorrection(raw, store.id);
  return p.ok ? reply(await requestCorrection(p.value)) : bad(p.error);
};

/** 修正申請の承認（店長以上） */
export const attendanceApprovePost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!canReviewRequests(ctx.role)) return FORBIDDEN;
  return isAttendanceId(raw.requestId) ? reply(await approveRequest(raw.requestId)) : bad(BAD);
};

/** 修正申請の却下（店長以上・理由が要る） */
export const attendanceRejectPost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!canReviewRequests(ctx.role)) return FORBIDDEN;
  if (!isAttendanceId(raw.requestId)) return bad(BAD);
  const reason = typeof raw.reason === 'string' ? raw.reason : '';
  return reply(await rejectRequest(raw.requestId, reason));
};

/** 勤怠区分の変更（attendance.approve） */
export const attendanceEntryTypePost: NativeModulePost = async ({ ctx, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!can(ctx.role, 'attendance.approve')) return FORBIDDEN;
  const p = parseEntryTypeChange(raw);
  return p.ok ? reply(await changeEntryType(p.value)) : bad(p.error);
};

/** 打刻なしの勤怠（有給・欠勤）を手動で追加（attendance.approve） */
export const attendanceManualEntryPost: NativeModulePost = async ({ ctx, store, raw }) => {
  if (featureOff(ctx)) return FEATURE_OFF;
  if (!can(ctx.role, 'attendance.approve')) return FORBIDDEN;
  const p = parseManualEntry(raw, store.id);
  return p.ok ? reply(await addManualEntry(p.value)) : bad(p.error);
};
