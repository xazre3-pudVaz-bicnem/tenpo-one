import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { daysAgoJst, todayJst } from '@/lib/format';
import { monthRange, type AttendanceEntryLike, type AttendanceEventLike, type PunchStateLike } from '@/lib/native-attendance';

/**
 * 勤怠（/app/attendance）の読み込み。
 * Web のページと iPad ネイティブ（lib/native-modules/attendance.ts）で同じ読み込みを使う
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface AttendanceStaffOption {
  id: string;
  name: string;
}

// ---------------------------------------------------------------
// 打刻タブ
// ---------------------------------------------------------------

/** 自分の打刻の状態（勤務中・休憩中）・本日のシフト・他店舗で開いたままの出勤 */
export async function loadPunchState(supabase: Supabase, { storeId, profileId }: { storeId: string; profileId: string }): Promise<PunchStateLike> {
  const today = todayJst();

  // 日跨ぎ勤務中の可能性があるため apply_punch と同様に当日＋前日の open エントリも対象にする
  const yesterday = daysAgoJst(1);
  // 3クエリは相互に独立のため並列取得（往復レイテンシを短縮）
  const [{ data: entry }, { data: todayShift }, { data: elsewhereEntry }] = await Promise.all([
    supabase
      .from('time_entries')
      .select('id, clock_in_at, clock_out_at, on_break, work_date')
      .eq('profile_id', profileId)
      .eq('store_id', storeId)
      .in('work_date', [today, yesterday])
      .eq('status', 'open')
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // シフトとの突合表示: 当日の確定・公開済みシフトがあれば表示する
    supabase
      .from('shifts')
      .select('start_time, end_time')
      .eq('store_id', storeId)
      .eq('profile_id', profileId)
      .eq('shift_date', today)
      .eq('kind', 'confirmed')
      .eq('status', 'published')
      .order('start_time')
      .limit(1)
      .maybeSingle(),
    // 他店舗で開いたままの出勤（ALREADY_CLOCKED_IN_ELSEWHERE の事前警告表示用）
    supabase
      .from('time_entries')
      .select('id, stores(name)')
      .eq('profile_id', profileId)
      .neq('store_id', storeId)
      .eq('status', 'open')
      .in('work_date', [today, yesterday])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const elsewhereStoreName = (elsewhereEntry?.stores as unknown as { name: string } | null)?.name ?? null;

  const open = !!entry && !!entry.clock_in_at && !entry.clock_out_at;
  const onBreak = open && !!entry?.on_break;

  return {
    todayShift: (todayShift as { start_time: string; end_time: string } | null) ?? null,
    elsewhere: elsewhereEntry ? { storeName: elsewhereStoreName } : null,
    open,
    onBreak,
  };
}

// ---------------------------------------------------------------
// 勤怠一覧タブ
// ---------------------------------------------------------------

export interface AttendanceListData {
  /** 店舗のスタッフ（attendance.approve のときだけ。名前順） */
  staffOptions: AttendanceStaffOption[];
  /** 表示の対象（自分だけ／絞り込んだ 1 人／店舗の全員） */
  targetProfileIds: string[];
  /** time_entries の行（日付の新しい順） */
  rows: (AttendanceEntryLike & Record<string, unknown>)[];
  /** 打刻履歴（行展開用） */
  eventsByEntry: Map<string, AttendanceEventLike[]>;
  /** 給与確定（confirmed／approved）の期間＝締め後ロック */
  lockedRanges: { store_id: string | null; period_start: string; period_end: string }[];
}

export async function loadAttendanceList(
  supabase: Supabase,
  {
    storeId,
    organizationId,
    selfId,
    isApprover,
    month,
    staffId,
  }: { storeId: string; organizationId: string; selfId: string; isApprover: boolean; month: string; staffId: string }
): Promise<AttendanceListData> {
  const { start, end } = monthRange(month);

  let staffOptions: AttendanceStaffOption[] = [];
  let targetProfileIds: string[] = [selfId];

  if (isApprover) {
    const { data: msRows } = await supabase.from('membership_stores').select('membership_id').eq('store_id', storeId);
    const membershipIds = (msRows ?? []).map((r) => r.membership_id);
    const { data: memberRows } = membershipIds.length
      ? await supabase
          .from('memberships')
          .select('profile_id, profiles(id, display_name)')
          .in('id', membershipIds)
          .eq('organization_id', organizationId)
          .eq('status', 'active')
      : { data: [] };
    staffOptions = (memberRows ?? [])
      .map((m) => {
        const p = m.profiles as unknown as { id: string; display_name: string } | null;
        return p ? { id: p.id, name: p.display_name } : null;
      })
      .filter((s): s is AttendanceStaffOption => !!s)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    targetProfileIds = staffId ? [staffId] : staffOptions.map((s) => s.id);
    if (targetProfileIds.length === 0) targetProfileIds = [selfId];
  }

  // entries と lockedRunRows（給与run締めロック）は相互に独立のため並列取得する。
  // eventRows は entries.id に依存するため後段で取得する。
  const [{ data: entries }, { data: lockedRunRows }] = await Promise.all([
    supabase
      .from('time_entries')
      .select('*')
      .eq('store_id', storeId)
      .in('profile_id', targetProfileIds)
      .gte('work_date', start)
      .lte('work_date', end)
      .order('work_date', { ascending: false }),
    supabase
      .from('payroll_runs')
      .select('store_id, period_start, period_end')
      .eq('organization_id', organizationId)
      .in('status', ['confirmed', 'approved'])
      .lte('period_start', end)
      .gte('period_end', start)
      .or(`store_id.is.null,store_id.eq.${storeId}`),
  ]);

  const rows = (entries ?? []) as AttendanceListData['rows'];

  // 打刻履歴（行展開用）: 対象期間の time_entries に紐づく生イベントを一括取得
  const entryIds = rows.map((r) => r.id);
  const { data: eventRows } = entryIds.length
    ? await supabase
        .from('time_entry_events')
        .select('id, time_entry_id, event_type, occurred_at, source, via_pin')
        .in('time_entry_id', entryIds)
        .order('occurred_at')
    : { data: [] };
  const eventsByEntry = new Map<string, AttendanceEventLike[]>();
  for (const e of eventRows ?? []) {
    if (!e.time_entry_id) continue;
    const list = eventsByEntry.get(e.time_entry_id) ?? [];
    list.push({ id: e.id, eventType: e.event_type, occurredAt: e.occurred_at, source: e.source, viaPin: e.via_pin });
    eventsByEntry.set(e.time_entry_id, list);
  }

  // 締め後ロック（給与run確定済み）: 表示期間と重なる confirmed/approved の run 期間で
  // 各行の work_date がロック対象かを判定しバッジ表示・操作ボタン非表示に反映する
  // （実際の書込拒否は各サーバーアクション側の isPayrollLocked で行う）。
  const lockedRanges = (lockedRunRows ?? []) as AttendanceListData['lockedRanges'];

  return { staffOptions, targetProfileIds, rows, eventsByEntry, lockedRanges };
}

// ---------------------------------------------------------------
// 承認タブ
// ---------------------------------------------------------------

/** 店舗の承認待ちの勤怠修正申請（古い順） */
export async function loadCorrectionRequests(supabase: Supabase, storeId: string) {
  const { data: requests } = await supabase
    .from('attendance_correction_requests')
    .select('*, profiles(display_name), time_entries(clock_in_at, clock_out_at, break_minutes)')
    .eq('store_id', storeId)
    .eq('status', 'pending')
    .order('created_at');
  return requests ?? [];
}
