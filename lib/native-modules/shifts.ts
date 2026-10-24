import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { can, type PermissionAction } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import {
  CONSECUTIVE_DAYS_WARNING_THRESHOLD,
  LABOR_COST_RATIO_WARNING_THRESHOLD,
  WEEKLY_MINUTES_WARNING_THRESHOLD,
  loadShiftsWeek,
} from '@/lib/shifts-server';
import { NATIVE_SHIFT_ACTION_TYPES, parseNativeShiftAction, type NativeShiftAction } from '@/lib/native-shifts';
import {
  deleteShift,
  deleteShiftRequirement,
  publishWeek,
  rejectShiftChange,
  requestShift,
  requestShiftChange,
  saveShiftRequirement,
  upsertShift,
} from '@/app/app/shifts/actions';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * シフト（/app/shifts）の iPad ネイティブ（GET part=shifts&week= ／ POST shiftUpsert・shiftDelete・shiftPublish・shiftRequest・
 * shiftChangeRequest・shiftRejectChange・shiftReqAdd・shiftReqDelete）。
 * 中身・操作は Web と同じ（lib/shifts-server.ts・app/app/shifts/actions.ts）。2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 *
 * 見える人・できることは Web と同じ：
 *   ページ … 機能「勤怠・シフト」（attendance）が有効な人（requireFeature('attendance')）
 *   シフトの作成・編集・削除・公開・変更申請の却下・必要人数 … shifts.manage
 *   自分のシフト希望 … 本人（Server Action が本人の行かを見る）
 *   変更申請 … attendance.punch（Server Action も見る）
 *   必要人数の一覧・他店舗スタッフの選択肢 … shifts.manage のときだけ返す（Web も店長系にしか出さない）
 */

const DISABLED = { status: 403, body: { ok: false, error: '勤怠・シフトの機能は使えません' } } satisfies NativeModuleResult;

function member(ctx: SessionContext): (SessionContext & { organizationId: string }) | null {
  return ctx.organizationId ? (ctx as SessionContext & { organizationId: string }) : null;
}

const hhmm = (t: string) => t.slice(0, 5);

export const shiftsGet: NativeModuleGet = async ({ ctx, store, url }) => {
  const m = member(ctx);
  if (!m) return { status: 401, body: { ok: false, error: 'ログインしてください' } };
  if (ctx.disabledFeatures.has('attendance')) return DISABLED;
  const d = await loadShiftsWeek(m, await createClient(), store, url.searchParams.get('week'));
  const shifts = Object.entries(d.shiftsByKey).flatMap(([key, list]) => {
    const i = key.indexOf('_');
    const profileId = key.slice(0, i);
    const date = key.slice(i + 1);
    return list.map((s) => ({
      id: s.id,
      profileId,
      date,
      startTime: hhmm(s.startTime),
      endTime: hhmm(s.endTime),
      kind: s.kind,
      status: s.status,
      note: s.note,
    }));
  });
  return {
    body: {
      ok: true,
      store,
      selfId: ctx.userId,
      canManage: d.canManage,
      todayWeekStart: d.todayWeekStart,
      weekStart: d.weekStart,
      weekEnd: d.weekEnd,
      rangeLabel: d.rangeLabel,
      weekDates: d.weekDates,
      staff: d.staff.map((s) => ({ id: s.id, name: s.name, isHelp: s.isHelp === true })),
      shifts,
      orgStaffOptions: d.canManage ? d.orgStaffOptions : [],
      laborRows: d.laborRows.map((r) => ({ name: r.name, isHelp: r.isHelp === true, minutes: r.minutes, cost: r.cost })),
      totalCost: d.totalCost,
      forecastRows: d.forecastRows,
      shortages: d.shortages,
      consecutiveWarnings: d.consecutiveWarnings,
      weeklyHourWarnings: d.weeklyHourWarnings,
      outOfHoursWarnings: d.outOfHoursWarnings,
      requirements: d.canManage
        ? d.requirements.map((r) => ({ id: r.id, dayOfWeek: r.day_of_week, timeFrom: hhmm(r.time_from), timeTo: hhmm(r.time_to), requiredCount: r.required_count }))
        : [],
      thresholds: {
        laborRatio: LABOR_COST_RATIO_WARNING_THRESHOLD,
        consecutiveDays: CONSECUTIVE_DAYS_WARNING_THRESHOLD,
        weeklyHours: Math.floor(WEEKLY_MINUTES_WARNING_THRESHOLD / 60),
      },
    },
  };
};

/** 操作ごとの権限（null＝ログインしたメンバーなら。中の Server Action も同じものを見る） */
const PERMISSION: Record<NativeShiftAction['type'], PermissionAction | null> = {
  shiftUpsert: 'shifts.manage',
  shiftDelete: 'shifts.manage',
  shiftPublish: 'shifts.manage',
  shiftRequest: null,
  shiftChangeRequest: 'attendance.punch',
  shiftRejectChange: 'shifts.manage',
  shiftReqAdd: 'shifts.manage',
  shiftReqDelete: 'shifts.manage',
};

function run(a: NativeShiftAction, storeId: string): Promise<{ ok: boolean; message: string }> {
  switch (a.type) {
    case 'shiftUpsert':
      return upsertShift({ id: a.id, storeId, profileId: a.profileId, date: a.date, startTime: a.startTime, endTime: a.endTime, kind: a.kind });
    case 'shiftDelete':
      return deleteShift(a.id);
    case 'shiftPublish':
      return publishWeek(storeId, a.weekStart, a.weekEnd);
    case 'shiftRequest':
      return requestShift({ id: a.id, storeId, date: a.date, startTime: a.startTime, endTime: a.endTime });
    case 'shiftChangeRequest':
      return requestShiftChange({ shiftId: a.shiftId, dayOff: a.dayOff, desiredStart: a.desiredStart, desiredEnd: a.desiredEnd, reason: a.reason });
    case 'shiftRejectChange':
      return rejectShiftChange(a.shiftId);
    case 'shiftReqAdd':
      return saveShiftRequirement({ storeId, dayOfWeek: a.dayOfWeek, timeFrom: a.timeFrom, timeTo: a.timeTo, requiredCount: a.requiredCount });
    case 'shiftReqDelete':
      return deleteShiftRequirement(a.id);
  }
}

const shiftPost: NativeModulePost = async ({ ctx, store, raw }) => {
  if (!member(ctx)) return { status: 401, body: { ok: false, error: 'ログインしてください' } };
  if (ctx.disabledFeatures.has('attendance')) return DISABLED;
  const parsed = parseNativeShiftAction(raw);
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
  const need = PERMISSION[parsed.action.type];
  if (need && !can(ctx.role, need)) return { status: 403, body: { ok: false, error: '権限がありません' } };
  const r = await run(parsed.action, store.id);
  return r.ok ? { body: { ok: true, message: r.message } } : { body: { ok: false, error: r.message } };
};

/** registry.ts の NATIVE_MODULE_POST に広げる（type → handler） */
export const SHIFT_POSTS: Record<string, NativeModulePost> = Object.fromEntries(NATIVE_SHIFT_ACTION_TYPES.map((t) => [t, shiftPost]));
