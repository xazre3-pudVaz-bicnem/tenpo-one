import { formatDate } from '@/lib/format';
import type { CreateLeaveGrantInput, CreateLeaveRequestInput, LeavePolicyInput } from '@/app/app/leave/actions';

/**
 * 有給休暇（/app/leave）の iPad ネイティブ（GET part=leave ／ POST leave…）の決まりごと。
 * 読み込みは lib/leave-server.ts（Web と同じ）、操作は Web と同じ Server Action（app/app/leave/actions.ts）。
 * ここは純粋な計算・検証と、Web の画面と同じ文言の組み立てだけ（tests/native-attendance.test.ts）。2026-10-24 Ronnie「全部ネイティブ」
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BAD = '内容が正しくありません';

export const isLeaveId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export type LeaveTab = 'mine' | 'admin';

/** タブ（Web の page.tsx と同じ：管理は attendance.approve だけ） */
export function leaveTab(raw: string | null | undefined, isApprover: boolean): LeaveTab {
  return raw === 'admin' && isApprover ? 'admin' : 'mine';
}

export const LEAVE_REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: '承認待ち',
  approved: '承認済み',
  rejected: '却下',
  cancelled: '取下げ済み',
};

/** 全休／半休（Web と同じ：0.5 だけ半休、ほかは全休） */
export const fractionLabel = (v: unknown): string => (Number(v ?? 1) === 0.5 ? '半休' : '全休');

/** 日数の表示（10 → '10日'、0.5 → '0.5日'） */
export const daysLabel = (v: unknown): string => `${Number(v ?? 0)}日`;

/** 'YYYY-MM-DD' に日を足す（Web の page.tsx の addDays と同じ） */
export function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' に年を足す（Web の grant-dialog の addYears と同じ。2/29 の 1 年後は 3/1） */
export function addYearsIso(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

export interface LeaveGrantLike {
  id: string;
  profile_id?: string;
  granted_on?: string;
  days: number | string;
  expires_on: string;
  reason?: string | null;
}

export interface LeaveTakenLike {
  profile_id?: string;
  leave_fraction: number | string | null;
}

/** 自分の残日数（Web の MineTab と同じ：有効な付与 − 取得。失効は別に） */
export function leaveTotals(grants: LeaveGrantLike[], taken: LeaveTakenLike[], today: string) {
  const activeGranted = grants.filter((g) => g.expires_on >= today).reduce((a, g) => a + Number(g.days), 0);
  const expired = grants.filter((g) => g.expires_on < today).reduce((a, g) => a + Number(g.days), 0);
  const takenTotal = taken.reduce((a, e) => a + Number(e.leave_fraction ?? 1), 0);
  return { remaining: activeGranted - takenTotal, activeGranted, taken: takenTotal, expired };
}

/** スタッフ別の残日数（Web の AdminTab と同じ） */
export function leaveBalances(staff: { id: string; name: string }[], grants: LeaveGrantLike[], taken: LeaveTakenLike[], today: string) {
  const grantsByProfile = new Map<string, { granted: number; expired: number }>();
  for (const g of grants) {
    if (!g.profile_id) continue;
    const cur = grantsByProfile.get(g.profile_id) ?? { granted: 0, expired: 0 };
    if (g.expires_on >= today) cur.granted += Number(g.days);
    else cur.expired += Number(g.days);
    grantsByProfile.set(g.profile_id, cur);
  }
  const takenByProfile = new Map<string, number>();
  for (const e of taken) {
    if (!e.profile_id) continue;
    takenByProfile.set(e.profile_id, (takenByProfile.get(e.profile_id) ?? 0) + Number(e.leave_fraction ?? 1));
  }
  return staff.map((s) => {
    const g = grantsByProfile.get(s.id) ?? { granted: 0, expired: 0 };
    const t = takenByProfile.get(s.id) ?? 0;
    return { id: s.id, name: s.name, granted: g.granted, taken: t, expired: g.expired, remaining: g.granted - t };
  });
}

/** 失効間近（60日以内。Web の AdminTab と同じ：失効日の近い順） */
export function expiringGrants<T extends LeaveGrantLike>(grants: T[], today: string, withinDays = 60): T[] {
  const threshold = addDaysIso(today, withinDays);
  return grants.filter((g) => g.expires_on >= today && g.expires_on <= threshold).sort((a, b) => a.expires_on.localeCompare(b.expires_on));
}

export interface LeaveRequestLike {
  id: string;
  leave_date: string;
  fraction: number | string;
  reason: string | null;
  status: string;
  review_note: string | null;
}

/** 自分の申請の 1 行（Web の MineTab と同じ） */
export function leaveRequestView(r: LeaveRequestLike) {
  return {
    id: r.id,
    leaveDate: r.leave_date,
    dateLabel: formatDate(r.leave_date),
    fractionLabel: fractionLabel(r.fraction),
    reason: r.reason || '',
    status: r.status,
    statusLabel: LEAVE_REQUEST_STATUS_LABEL[r.status] ?? r.status,
    rejectNote: r.status === 'rejected' && r.review_note ? r.review_note : null,
    canWithdraw: r.status === 'pending',
  };
}

// ---------------------------------------------------------------
// POST の中身の検証（中身の決まりは Server Action がもう一度見る）
// ---------------------------------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/** 有給の申請（Web の request-dialog と同じ） */
export function parseLeaveRequest(raw: Record<string, unknown>): Parsed<CreateLeaveRequestInput> {
  if (typeof raw.leaveDate !== 'string' || !raw.leaveDate) return { ok: false, error: '申請日を入力してください' };
  if (!DATE.test(raw.leaveDate)) return { ok: false, error: BAD };
  const fraction = raw.fraction === 0.5 ? 0.5 : raw.fraction === 1 ? 1 : null;
  if (fraction === null) return { ok: false, error: '取得区分が正しくありません' };
  const reason = text(raw.reason, 2000);
  if (reason === null) return { ok: false, error: BAD };
  if (!reason.trim()) return { ok: false, error: '理由を入力してください' };
  return { ok: true, value: { leaveDate: raw.leaveDate, fraction, reason: reason.trim() } };
}

/** 付与の登録（Web の grant-dialog と同じ） */
export function parseLeaveGrant(raw: Record<string, unknown>): Parsed<CreateLeaveGrantInput> {
  if (!isLeaveId(raw.profileId)) return { ok: false, error: '対象スタッフを選択してください' };
  const days = typeof raw.days === 'number' && Number.isFinite(raw.days) ? raw.days : NaN;
  if (!(days > 0)) return { ok: false, error: '付与日数は0より大きい値で入力してください' };
  if (days > 366) return { ok: false, error: BAD };
  if (typeof raw.grantedOn !== 'string' || typeof raw.expiresOn !== 'string' || !raw.grantedOn || !raw.expiresOn) {
    return { ok: false, error: '付与日・失効日を入力してください' };
  }
  if (!DATE.test(raw.grantedOn) || !DATE.test(raw.expiresOn)) return { ok: false, error: BAD };
  if (raw.expiresOn < raw.grantedOn) return { ok: false, error: '失効日は付与日以降の日付にしてください' };
  const note = text(raw.note ?? '', 2000);
  if (note === null) return { ok: false, error: BAD };
  return {
    ok: true,
    value: {
      profileId: raw.profileId,
      days,
      grantedOn: raw.grantedOn,
      expiresOn: raw.expiresOn,
      reason: raw.reason === 'adjustment' ? 'adjustment' : 'annual',
      note,
    },
  };
}

/** 有給付与ルール（Web の policy-form と同じ） */
export function parseLeavePolicy(raw: Record<string, unknown>): Parsed<LeavePolicyInput> {
  const expiryYears = typeof raw.expiryYears === 'number' && Number.isFinite(raw.expiryYears) ? raw.expiryYears : NaN;
  if (!(expiryYears > 0)) return { ok: false, error: '失効年数は1以上で入力してください' };
  if (expiryYears > 100) return { ok: false, error: BAD };
  const memo = text(raw.memo ?? '', 4000);
  if (memo === null) return { ok: false, error: BAD };
  return { ok: true, value: { expiryYears, memo } };
}
