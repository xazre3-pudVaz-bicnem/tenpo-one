import { summarizeEntry } from '@/lib/payroll';
import { formatDateTime, formatMinutes, formatTime, weekdayJa } from '@/lib/format';
import type { CorrectionInput, EntryType, ManualEntryInput, PunchEventType } from '@/app/app/attendance/actions';

/**
 * 勤怠（/app/attendance）の iPad ネイティブ（GET part=attendance ／ POST attendance…）の決まりごと。
 * 読み込みは lib/attendance-server.ts（Web と同じ）、操作は Web と同じ Server Action（app/app/attendance/actions.ts）。
 * ここは純粋な検証と、Web の画面と同じ文言の組み立てだけ（tests/native-attendance.test.ts）。2026-10-24 Ronnie「全部ネイティブ」
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const BAD = '内容が正しくありません';

export const isAttendanceId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v);

/** 勤怠区分（Web の entry-type-dialog と同じ並び・同じことば） */
export const ENTRY_TYPES: { value: EntryType; label: string }[] = [
  { value: 'normal', label: '通常' },
  { value: 'late', label: '遅刻' },
  { value: 'early_leave', label: '早退' },
  { value: 'absent', label: '欠勤' },
  { value: 'paid_leave', label: '有給' },
  { value: 'holiday_work', label: '休日出勤' },
];
export const ENTRY_TYPE_LABEL: Record<string, string> = Object.fromEntries(ENTRY_TYPES.map((t) => [t.value, t.label]));

/** 打刻の種類（Web の EVENT_LABELS と同じ） */
export const PUNCH_EVENTS: { value: PunchEventType; label: string }[] = [
  { value: 'clock_in', label: '出勤' },
  { value: 'break_start', label: '休憩開始' },
  { value: 'break_end', label: '休憩終了' },
  { value: 'clock_out', label: '退勤' },
];
export const PUNCH_EVENT_LABEL: Record<string, string> = Object.fromEntries(PUNCH_EVENTS.map((e) => [e.value, e.label]));

/** 打刻した端末（Web の attendance-row の SOURCE_LABEL と同じ） */
export const SOURCE_LABEL: Record<string, string> = {
  personal: '個人端末',
  shared_terminal: '共用端末（PIN）',
  manual: '手動登録',
};

// ---------------------------------------------------------------
// GET の道（?tab=punch|list|requests&month=YYYY-MM&staffId=<id>）
// ---------------------------------------------------------------

export type AttendanceTab = 'punch' | 'list' | 'requests';

/** タブ（Web の page.tsx と同じ決め方：承認は attendance.approve だけ、知らない値は勤怠一覧） */
export function attendanceTab(raw: string | null | undefined, isApprover: boolean): AttendanceTab {
  if (raw === 'list') return 'list';
  if (raw === 'requests' && isApprover) return 'requests';
  if (raw === 'punch' || !raw) return 'punch';
  return 'list';
}

/** 月（YYYY-MM）。正しくなければ今月 */
export function monthOrCurrent(raw: string | null | undefined, today: string): string {
  return raw && MONTH.test(raw) ? raw : today.slice(0, 7);
}

/** スタッフの絞り込み（UUID か ''） */
export function staffIdParam(raw: string | null | undefined): string {
  return isAttendanceId(raw) ? raw : '';
}

/** 月の 1 日〜末日（Web の page.tsx の monthRange と同じ） */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/** 前の月・次の月（'2026-01' と -1 → '2025-12'） */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** '2026-10' → '2026年10月' */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

/** ISO → 日本時間の HH:mm（修正申請の初期値。Web の page.tsx の toJstHHmm と同じ） */
export function toJstHHmm(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('sv-SE', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
}

/** 給与確定でロックされた日か（Web の page.tsx の isLocked と同じ） */
export function isLockedDate(ranges: { period_start: string; period_end: string }[], workDate: string): boolean {
  return ranges.some((r) => r.period_start <= workDate && r.period_end >= workDate);
}

// ---------------------------------------------------------------
// 画面の中身（Web の画面と同じ文言）
// ---------------------------------------------------------------

export interface PunchStateLike {
  todayShift: { start_time: string; end_time: string } | null;
  elsewhere: { storeName: string | null } | null;
  open: boolean;
  onBreak: boolean;
}

/** 打刻タブ（Web の PunchTab・ClockSection と同じ） */
export function punchView(s: PunchStateLike) {
  return {
    open: s.open,
    onBreak: s.onBreak,
    canClockIn: !s.open,
    canClockOut: s.open && !s.onBreak,
    canBreakStart: s.open && !s.onBreak,
    canBreakEnd: s.open && s.onBreak,
    todayShift: s.todayShift ? `本日のシフト: ${s.todayShift.start_time.slice(0, 5)}〜${s.todayShift.end_time.slice(0, 5)}` : null,
    elsewhere: !s.open && s.elsewhere ? `${s.elsewhere.storeName ?? '他店舗'}で出勤打刻が残っています。先にそちらで退勤してください。` : null,
  };
}

export interface AttendanceEntryLike {
  id: string;
  work_date: string;
  profile_id: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  break_minutes: number;
  entry_type: string | null;
  status: string;
}

export interface AttendanceEventLike {
  id: string;
  eventType: string;
  occurredAt: string;
  source: string;
  viaPin: boolean;
}

/** 勤怠一覧の 1 行（Web の ListTab・AttendanceRow と同じ） */
export function attendanceRowView(
  row: AttendanceEntryLike,
  opts: { today: string; staffName: string | null; locked: boolean; events: AttendanceEventLike[] }
) {
  const missing = !row.clock_out_at && row.work_date < opts.today;
  const entryType = (row.entry_type ?? 'normal') as EntryType;
  const worked =
    row.clock_in_at && row.clock_out_at
      ? summarizeEntry({
          clockInAt: new Date(row.clock_in_at),
          clockOutAt: new Date(row.clock_out_at),
          breakMinutes: row.break_minutes,
          isHolidayWork: entryType === 'holiday_work',
        })
      : null;
  return {
    id: row.id,
    workDate: row.work_date,
    workDateLabel: `${row.work_date.slice(5).replace('-', '/')}（${weekdayJa(row.work_date)}）`,
    staffName: opts.staffName,
    profileId: row.profile_id,
    clockInLabel: formatTime(row.clock_in_at),
    clockOutLabel: row.clock_out_at ? formatTime(row.clock_out_at) : missing ? '未打刻' : '—',
    breakMinutes: Number(row.break_minutes ?? 0),
    workedLabel: worked ? formatMinutes(worked.workMinutes) : '—',
    entryType,
    entryTypeLabel: ENTRY_TYPE_LABEL[entryType] ?? entryType,
    missing,
    status: String(row.status ?? ''),
    statusLabel: row.status === 'approved' ? '承認済' : row.status === 'closed' ? '打刻済' : '勤務中',
    locked: opts.locked,
    defaultClockIn: toJstHHmm(row.clock_in_at),
    defaultClockOut: toJstHHmm(row.clock_out_at),
    // null が混じると iPad が画面ごと読めなくなるので、文字・真偽にそろえる
    events: opts.events.map((e) => ({
      id: e.id,
      label: PUNCH_EVENT_LABEL[e.eventType] ?? String(e.eventType ?? ''),
      timeLabel: formatDateTime(e.occurredAt),
      sourceLabel: SOURCE_LABEL[e.source] ?? String(e.source ?? ''),
      viaPin: e.viaPin === true,
    })),
  };
}

export interface CorrectionRequestLike {
  id: string;
  work_date: string;
  reason: string | null;
  requested_changes: unknown;
  profiles: unknown;
  time_entries: unknown;
}

/** 承認待ちの修正申請（Web の RequestsTab と同じ） */
export function correctionRequestView(r: CorrectionRequestLike) {
  const changes = (r.requested_changes ?? {}) as { clock_in_at?: string; clock_out_at?: string; break_minutes?: number };
  const current = r.time_entries as { clock_in_at: string | null; clock_out_at: string | null; break_minutes: number } | null;
  const profile = r.profiles as { display_name: string } | null;
  return {
    id: r.id,
    title: `${profile?.display_name ?? '不明'} さん — ${r.work_date}`,
    workDate: r.work_date,
    current: `${current?.clock_in_at ? formatTime(current.clock_in_at) : '未登録'} 〜 ${
      current?.clock_out_at ? formatTime(current.clock_out_at) : '未登録'
    }（休憩 ${current?.break_minutes ?? 0}分）`,
    desired: `${formatTime(changes.clock_in_at)} 〜 ${formatTime(changes.clock_out_at)}（休憩 ${changes.break_minutes ?? 0}分）`,
    reason: r.reason ?? '',
  };
}

// ---------------------------------------------------------------
// POST の中身の検証（中身の決まりは Server Action がもう一度見る）
// ---------------------------------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

export function parsePunchEvent(v: unknown): PunchEventType | null {
  return PUNCH_EVENTS.some((e) => e.value === v) ? (v as PunchEventType) : null;
}

/** 共用端末の PIN（Web の PinPad と同じ：4〜6 桁の数字） */
export function parsePin(v: unknown): Parsed<string> {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return { ok: false, error: 'PINは4桁以上で入力してください' };
  if (v.length < 4) return { ok: false, error: 'PINは4桁以上で入力してください' };
  if (v.length > 6) return { ok: false, error: BAD };
  return { ok: true, value: v };
}

/** 修正申請（Web の correction-dialog と同じ確かめ方。店舗は今の店舗） */
export function parseCorrection(raw: Record<string, unknown>, storeId: string): Parsed<CorrectionInput> {
  const profileId = isAttendanceId(raw.profileId) ? raw.profileId : null;
  const timeEntryId = raw.timeEntryId == null || raw.timeEntryId === '' ? null : isAttendanceId(raw.timeEntryId) ? raw.timeEntryId : undefined;
  const workDate = isIsoDate(raw.workDate) ? raw.workDate : null;
  if (!profileId || timeEntryId === undefined || !workDate) return { ok: false, error: BAD };
  const clockIn = typeof raw.clockIn === 'string' ? raw.clockIn : '';
  const clockOut = typeof raw.clockOut === 'string' ? raw.clockOut : '';
  if (!clockIn || !clockOut) return { ok: false, error: '出勤時刻・退勤時刻を入力してください' };
  if (!HHMM.test(clockIn) || !HHMM.test(clockOut)) return { ok: false, error: BAD };
  const reason = text(raw.reason, 2000);
  if (reason === null) return { ok: false, error: BAD };
  if (!reason.trim()) return { ok: false, error: '理由を入力してください' };
  const breakRaw = Number(raw.breakMinutes);
  const breakMinutes = Math.max(0, Number.isFinite(breakRaw) ? Math.round(breakRaw) : 0);
  if (breakMinutes > 24 * 60) return { ok: false, error: BAD };
  return {
    ok: true,
    value: { storeId, profileId, timeEntryId, workDate, desiredClockIn: clockIn, desiredClockOut: clockOut, breakMinutes, reason: reason.trim() },
  };
}

/** 区分の変更（Web の entry-type-dialog と同じ） */
export function parseEntryTypeChange(raw: Record<string, unknown>): Parsed<{ timeEntryId: string; entryType: EntryType; reason: string }> {
  const timeEntryId = isAttendanceId(raw.timeEntryId) ? raw.timeEntryId : null;
  const entryType = ENTRY_TYPES.some((t) => t.value === raw.entryType) ? (raw.entryType as EntryType) : null;
  const reason = text(raw.reason, 2000);
  if (!timeEntryId || !entryType || reason === null) return { ok: false, error: BAD };
  if (!reason.trim()) return { ok: false, error: '理由を入力してください' };
  return { ok: true, value: { timeEntryId, entryType, reason: reason.trim() } };
}

/** 勤怠の手動追加（有給・欠勤。Web の manual-entry-dialog と同じ） */
export function parseManualEntry(raw: Record<string, unknown>, storeId: string): Parsed<ManualEntryInput> {
  if (!isAttendanceId(raw.profileId)) return { ok: false, error: '対象スタッフを選択してください' };
  if (!isIsoDate(raw.workDate)) return { ok: false, error: '日付を入力してください' };
  const entryType = raw.entryType === 'paid_leave' || raw.entryType === 'absent' ? raw.entryType : null;
  if (!entryType) return { ok: false, error: '区分が正しくありません' };
  const reason = text(raw.reason, 2000);
  if (reason === null) return { ok: false, error: BAD };
  if (!reason.trim()) return { ok: false, error: '理由を入力してください' };
  let leaveFraction: 1 | 0.5 | undefined;
  if (entryType === 'paid_leave') {
    if (raw.leaveFraction === 0.5) leaveFraction = 0.5;
    else if (raw.leaveFraction == null || raw.leaveFraction === 1) leaveFraction = 1;
    else return { ok: false, error: '取得区分が正しくありません' };
  }
  return {
    ok: true,
    value: { storeId, profileId: raw.profileId, workDate: raw.workDate, entryType, reason: reason.trim(), ...(leaveFraction ? { leaveFraction } : {}) },
  };
}
