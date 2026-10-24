import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attendanceRowView,
  attendanceTab,
  correctionRequestView,
  isLockedDate,
  monthLabel,
  monthOrCurrent,
  monthRange,
  parseCorrection,
  parseEntryTypeChange,
  parseManualEntry,
  parsePin,
  parsePunchEvent,
  punchView,
  shiftMonth,
  staffIdParam,
  toJstHHmm,
} from '@/lib/native-attendance';
import {
  addDaysIso,
  addYearsIso,
  daysLabel,
  expiringGrants,
  fractionLabel,
  leaveBalances,
  leaveRequestView,
  leaveTab,
  leaveTotals,
  parseLeaveGrant,
  parseLeavePolicy,
  parseLeaveRequest,
} from '@/lib/native-leave';

const ID = '11111111-2222-4333-8444-555555555555';
const ID2 = '66666666-7777-4888-9999-000000000000';
const STORE = '99999999-8888-4777-8666-555555555555';
const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

describe('勤怠：GET の道（part=attendance）', () => {
  it('タブは Web と同じ決め方（承認は attendance.approve だけ・知らない値は勤怠一覧）', () => {
    expect(attendanceTab(null, false)).toBe('punch');
    expect(attendanceTab('', true)).toBe('punch');
    expect(attendanceTab('punch', true)).toBe('punch');
    expect(attendanceTab('list', false)).toBe('list');
    expect(attendanceTab('requests', true)).toBe('requests');
    expect(attendanceTab('requests', false)).toBe('list');
    expect(attendanceTab('xyz', true)).toBe('list');
  });

  it('月は YYYY-MM だけ（違えば今月）、スタッフは UUID だけ', () => {
    expect(monthOrCurrent('2026-09', '2026-10-24')).toBe('2026-09');
    expect(monthOrCurrent('2026-13', '2026-10-24')).toBe('2026-10');
    expect(monthOrCurrent(null, '2026-10-24')).toBe('2026-10');
    expect(staffIdParam(ID)).toBe(ID);
    expect(staffIdParam('abc')).toBe('');
    expect(staffIdParam(null)).toBe('');
  });

  it('月の範囲・前後の月・表示', () => {
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(monthRange('2026-10')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
    expect(monthLabel('2026-03')).toBe('2026年3月');
  });

  it('日本時間の HH:mm・ロックの判定', () => {
    expect(toJstHHmm('2026-10-24T00:05:00Z')).toBe('09:05');
    expect(toJstHHmm(null)).toBe('');
    const ranges = [{ period_start: '2026-09-01', period_end: '2026-09-30' }];
    expect(isLockedDate(ranges, '2026-09-15')).toBe(true);
    expect(isLockedDate(ranges, '2026-10-01')).toBe(false);
  });
});

describe('勤怠：画面の中身（Web と同じ文言）', () => {
  it('打刻：ボタンの押せる・押せない、シフト、他店舗の出勤', () => {
    const idle = punchView({ todayShift: { start_time: '10:00:00', end_time: '18:30:00' }, elsewhere: { storeName: '新宿店' }, open: false, onBreak: false });
    expect(idle).toMatchObject({ canClockIn: true, canClockOut: false, canBreakStart: false, canBreakEnd: false });
    expect(idle.todayShift).toBe('本日のシフト: 10:00〜18:30');
    expect(idle.elsewhere).toBe('新宿店で出勤打刻が残っています。先にそちらで退勤してください。');

    const working = punchView({ todayShift: null, elsewhere: { storeName: null }, open: true, onBreak: false });
    expect(working).toMatchObject({ canClockIn: false, canClockOut: true, canBreakStart: true, canBreakEnd: false, todayShift: null, elsewhere: null });

    const onBreak = punchView({ todayShift: null, elsewhere: null, open: true, onBreak: true });
    expect(onBreak).toMatchObject({ canClockOut: false, canBreakStart: false, canBreakEnd: true });

    expect(punchView({ todayShift: null, elsewhere: { storeName: null }, open: false, onBreak: false }).elsewhere).toBe(
      '他店舗で出勤打刻が残っています。先にそちらで退勤してください。'
    );
  });

  it('勤怠一覧の 1 行：実働・打刻漏れ・区分・状態・打刻履歴', () => {
    const v = attendanceRowView(
      {
        id: ID,
        work_date: '2026-10-20',
        profile_id: ID2,
        clock_in_at: '2026-10-20T01:00:00Z', // 10:00
        clock_out_at: '2026-10-20T10:00:00Z', // 19:00
        break_minutes: 60,
        entry_type: 'late',
        status: 'closed',
      },
      {
        today: '2026-10-24',
        staffName: '山田',
        locked: true,
        events: [{ id: 'e1', eventType: 'clock_in', occurredAt: '2026-10-20T01:00:00Z', source: 'shared_terminal', viaPin: true }],
      }
    );
    expect(v).toMatchObject({
      workDateLabel: '10/20（火）',
      staffName: '山田',
      clockInLabel: '10:00',
      clockOutLabel: '19:00',
      breakMinutes: 60,
      workedLabel: '8:00',
      entryType: 'late',
      entryTypeLabel: '遅刻',
      missing: false,
      statusLabel: '打刻済',
      locked: true,
      defaultClockIn: '10:00',
      defaultClockOut: '19:00',
    });
    expect(v.events[0]).toMatchObject({ label: '出勤', sourceLabel: '共用端末（PIN）', viaPin: true });

    const missing = attendanceRowView(
      { id: ID, work_date: '2026-10-20', profile_id: ID2, clock_in_at: '2026-10-20T01:00:00Z', clock_out_at: null, break_minutes: 0, entry_type: null, status: 'open' },
      { today: '2026-10-24', staffName: null, locked: false, events: [] }
    );
    expect(missing).toMatchObject({ missing: true, clockOutLabel: '未打刻', workedLabel: '—', entryTypeLabel: '通常', statusLabel: '勤務中', defaultClockOut: '' });

    const leave = attendanceRowView(
      { id: ID, work_date: '2026-10-24', profile_id: ID2, clock_in_at: null, clock_out_at: null, break_minutes: 0, entry_type: 'paid_leave', status: 'approved' },
      { today: '2026-10-24', staffName: null, locked: false, events: [] }
    );
    expect(leave).toMatchObject({ missing: false, clockInLabel: '—', clockOutLabel: '—', entryTypeLabel: '有給', statusLabel: '承認済' });
  });

  it('承認待ちの修正申請（現在値・希望値）', () => {
    const v = correctionRequestView({
      id: ID,
      work_date: '2026-10-20',
      reason: '打刻を忘れました',
      requested_changes: { clock_in_at: '2026-10-20T01:00:00Z', clock_out_at: '2026-10-20T09:30:00Z', break_minutes: 45 },
      profiles: { display_name: '山田' },
      time_entries: { clock_in_at: '2026-10-20T01:10:00Z', clock_out_at: null, break_minutes: 0 },
    });
    expect(v.title).toBe('山田 さん — 2026-10-20');
    expect(v.current).toBe('10:10 〜 未登録（休憩 0分）');
    expect(v.desired).toBe('10:00 〜 18:30（休憩 45分）');
    expect(correctionRequestView({ id: ID, work_date: '2026-10-20', reason: null, requested_changes: {}, profiles: null, time_entries: null }).current).toBe(
      '未登録 〜 未登録（休憩 0分）'
    );
  });
});

describe('勤怠：POST の中身', () => {
  it('打刻の種類・PIN', () => {
    expect(parsePunchEvent('clock_in')).toBe('clock_in');
    expect(parsePunchEvent('break_end')).toBe('break_end');
    expect(parsePunchEvent('nap')).toBeNull();
    expect(parsePin('1234')).toEqual({ ok: true, value: '1234' });
    expect(parsePin('123456')).toEqual({ ok: true, value: '123456' });
    expect(parsePin('123')).toEqual({ ok: false, error: 'PINは4桁以上で入力してください' });
    expect(parsePin('12a4').ok).toBe(false);
    expect(parsePin('1234567').ok).toBe(false);
    expect(parsePin(1234).ok).toBe(false);
  });

  it('修正申請：Web と同じ確かめ方・店舗は今の店舗', () => {
    const base = { profileId: ID, timeEntryId: ID2, workDate: '2026-10-20', clockIn: '10:00', clockOut: '19:00', breakMinutes: 60, reason: ' 忘れました ' };
    expect(parseCorrection(base, STORE)).toEqual({
      ok: true,
      value: { storeId: STORE, profileId: ID, timeEntryId: ID2, workDate: '2026-10-20', desiredClockIn: '10:00', desiredClockOut: '19:00', breakMinutes: 60, reason: '忘れました' },
    });
    expect(parseCorrection({ ...base, timeEntryId: null }, STORE)).toMatchObject({ ok: true, value: { timeEntryId: null } });
    expect(parseCorrection({ ...base, breakMinutes: -5 }, STORE)).toMatchObject({ ok: true, value: { breakMinutes: 0 } });
    expect(parseCorrection({ ...base, clockOut: '' }, STORE)).toEqual({ ok: false, error: '出勤時刻・退勤時刻を入力してください' });
    expect(parseCorrection({ ...base, reason: '  ' }, STORE)).toEqual({ ok: false, error: '理由を入力してください' });
    expect(parseCorrection({ ...base, clockIn: '25:00' }, STORE).ok).toBe(false);
    expect(parseCorrection({ ...base, profileId: 'x' }, STORE).ok).toBe(false);
    expect(parseCorrection({ ...base, timeEntryId: 'x' }, STORE).ok).toBe(false);
  });

  it('区分の変更・手動追加（有給は全休/半休）', () => {
    expect(parseEntryTypeChange({ timeEntryId: ID, entryType: 'holiday_work', reason: '確認済み' })).toEqual({
      ok: true,
      value: { timeEntryId: ID, entryType: 'holiday_work', reason: '確認済み' },
    });
    expect(parseEntryTypeChange({ timeEntryId: ID, entryType: 'vacation', reason: 'x' }).ok).toBe(false);
    expect(parseEntryTypeChange({ timeEntryId: ID, entryType: 'late', reason: '' })).toEqual({ ok: false, error: '理由を入力してください' });

    expect(parseManualEntry({ profileId: ID, workDate: '2026-10-24', entryType: 'paid_leave', leaveFraction: 0.5, reason: '申請あり' }, STORE)).toEqual({
      ok: true,
      value: { storeId: STORE, profileId: ID, workDate: '2026-10-24', entryType: 'paid_leave', reason: '申請あり', leaveFraction: 0.5 },
    });
    expect(parseManualEntry({ profileId: ID, workDate: '2026-10-24', entryType: 'paid_leave', reason: 'x' }, STORE)).toMatchObject({ ok: true, value: { leaveFraction: 1 } });
    const absent = parseManualEntry({ profileId: ID, workDate: '2026-10-24', entryType: 'absent', leaveFraction: 0.5, reason: '連絡なし' }, STORE);
    expect(absent.ok && 'leaveFraction' in absent.value).toBe(false);
    expect(parseManualEntry({ profileId: '', workDate: '2026-10-24', entryType: 'absent', reason: 'x' }, STORE)).toEqual({ ok: false, error: '対象スタッフを選択してください' });
    expect(parseManualEntry({ profileId: ID, workDate: '2026-10-24', entryType: 'late', reason: 'x' }, STORE)).toEqual({ ok: false, error: '区分が正しくありません' });
    expect(parseManualEntry({ profileId: ID, workDate: '2026-10-24', entryType: 'paid_leave', leaveFraction: 0.25, reason: 'x' }, STORE)).toEqual({
      ok: false,
      error: '取得区分が正しくありません',
    });
  });
});

describe('有給休暇（part=leave）', () => {
  it('タブ・区分・日数の表示', () => {
    expect(leaveTab('admin', true)).toBe('admin');
    expect(leaveTab('admin', false)).toBe('mine');
    expect(leaveTab(null, true)).toBe('mine');
    expect(fractionLabel(0.5)).toBe('半休');
    expect(fractionLabel('0.5')).toBe('半休');
    expect(fractionLabel(1)).toBe('全休');
    expect(fractionLabel(null)).toBe('全休');
    expect(daysLabel(10)).toBe('10日');
    expect(daysLabel('0.5')).toBe('0.5日');
  });

  it('日付の足し算（Web と同じ：2/29 の 1 年後は 3/1）', () => {
    expect(addDaysIso('2026-10-24', 60)).toBe('2026-12-23');
    expect(addYearsIso('2026-10-24', 2)).toBe('2028-10-24');
    expect(addYearsIso('2028-02-29', 1)).toBe('2029-03-01');
  });

  it('自分の残日数：有効な付与 − 取得、失効は別', () => {
    const grants = [
      { id: 'g1', days: 10, expires_on: '2027-04-01' },
      { id: 'g2', days: '5', expires_on: '2026-04-01' },
    ];
    const taken = [{ leave_fraction: 1 }, { leave_fraction: 0.5 }, { leave_fraction: null }];
    expect(leaveTotals(grants, taken, '2026-10-24')).toEqual({ remaining: 7.5, activeGranted: 10, taken: 2.5, expired: 5 });
    expect(leaveTotals([], [{ leave_fraction: 1 }], '2026-10-24').remaining).toBe(-1);
  });

  it('スタッフ別の残日数・失効間近（60日以内・近い順）', () => {
    const staff = [
      { id: ID, name: '山田' },
      { id: ID2, name: '佐藤' },
    ];
    const grants = [
      { id: 'a', profile_id: ID, days: 10, expires_on: '2026-12-01' },
      { id: 'b', profile_id: ID, days: 3, expires_on: '2026-01-01' },
      { id: 'c', profile_id: ID2, days: 5, expires_on: '2026-11-01' },
      { id: 'd', profile_id: ID2, days: 5, expires_on: '2027-11-01' },
    ];
    const taken = [{ profile_id: ID, leave_fraction: 0.5 }, { profile_id: ID2, leave_fraction: 1 }];
    expect(leaveBalances(staff, grants, taken, '2026-10-24')).toEqual([
      { id: ID, name: '山田', granted: 10, taken: 0.5, expired: 3, remaining: 9.5 },
      { id: ID2, name: '佐藤', granted: 10, taken: 1, expired: 0, remaining: 9 },
    ]);
    expect(expiringGrants(grants, '2026-10-24').map((g) => g.id)).toEqual(['c', 'a']);
  });

  it('自分の申請の 1 行（却下理由・取下げ）', () => {
    expect(leaveRequestView({ id: ID, leave_date: '2026-11-03', fraction: 0.5, reason: '私用', status: 'rejected', review_note: '繁忙期' })).toMatchObject({
      dateLabel: '2026/11/3',
      fractionLabel: '半休',
      statusLabel: '却下',
      rejectNote: '繁忙期',
      canWithdraw: false,
    });
    expect(leaveRequestView({ id: ID, leave_date: '2026-11-03', fraction: 1, reason: null, status: 'pending', review_note: null })).toMatchObject({
      statusLabel: '承認待ち',
      rejectNote: null,
      canWithdraw: true,
      reason: '',
    });
  });

  it('POST：申請・付与・ルール（Web と同じことば）', () => {
    expect(parseLeaveRequest({ leaveDate: '2026-11-03', fraction: 0.5, reason: ' 私用 ' })).toEqual({ ok: true, value: { leaveDate: '2026-11-03', fraction: 0.5, reason: '私用' } });
    expect(parseLeaveRequest({ leaveDate: '', fraction: 1, reason: 'x' })).toEqual({ ok: false, error: '申請日を入力してください' });
    expect(parseLeaveRequest({ leaveDate: '2026-11-03', fraction: 2, reason: 'x' })).toEqual({ ok: false, error: '取得区分が正しくありません' });
    expect(parseLeaveRequest({ leaveDate: '2026-11-03', fraction: 1, reason: '' })).toEqual({ ok: false, error: '理由を入力してください' });

    const grant = { profileId: ID, days: 10, grantedOn: '2026-10-24', expiresOn: '2028-10-24', reason: 'adjustment', note: '' };
    expect(parseLeaveGrant(grant)).toEqual({ ok: true, value: { ...grant } });
    expect(parseLeaveGrant({ ...grant, reason: 'whatever' })).toMatchObject({ ok: true, value: { reason: 'annual' } });
    expect(parseLeaveGrant({ ...grant, profileId: '' })).toEqual({ ok: false, error: '対象スタッフを選択してください' });
    expect(parseLeaveGrant({ ...grant, days: 0 })).toEqual({ ok: false, error: '付与日数は0より大きい値で入力してください' });
    expect(parseLeaveGrant({ ...grant, expiresOn: '2026-01-01' })).toEqual({ ok: false, error: '失効日は付与日以降の日付にしてください' });

    expect(parseLeavePolicy({ expiryYears: 2, memo: '入社6ヶ月で10日' })).toEqual({ ok: true, value: { expiryYears: 2, memo: '入社6ヶ月で10日' } });
    expect(parseLeavePolicy({ expiryYears: 0, memo: '' })).toEqual({ ok: false, error: '失効年数は1以上で入力してください' });
  });
});

describe('iPad：ネイティブで開く（登録の 3 か所）', () => {
  it('Web の道 → key、key → 画面、サーバーの GET／POST', () => {
    const swift = read('ios/Shared/NativeModules.swift');
    // コメントのままではなく、本当に登録されている行
    expect(swift).toMatch(/^\s*\("\/app\/attendance", "attendance"\),/m);
    expect(swift).toMatch(/^\s*\("\/app\/leave", "leave"\),/m);
    expect(swift).toMatch(/^\s*case "attendance": NativeAttendanceView\(/m);
    expect(swift).toMatch(/^\s*case "leave": NativeLeaveView\(/m);
    const registry = read('lib/native-modules/registry.ts');
    expect(registry).toContain('attendance: attendance.attendanceGet');
    expect(registry).toContain('leave: leave.leaveGet');
    for (const t of ['attendancePunch', 'attendancePunchPin', 'attendanceCorrection', 'attendanceApprove', 'attendanceReject', 'attendanceEntryType', 'attendanceManualEntry']) {
      expect(registry).toContain(`${t}: attendance.${t}Post`);
    }
    for (const t of ['leaveRequest', 'leaveWithdraw', 'leaveApprove', 'leaveReject', 'leaveGrant', 'leavePolicy']) {
      expect(registry).toContain(`${t}: leave.${t}Post`);
    }
  });

  it('スタッフの勤怠・有給は iPad に残さない（読んだらすぐ保存を消す）', () => {
    const attendance = read('ios/Shared/NativeAttendanceView.swift');
    const leave = read('ios/Shared/NativeLeaveView.swift');
    // 勤怠・有給の読み込みは NATApi.get だけ（NativeAPI.send が保存した分を、読んだらすぐ消す）
    expect(attendance).toMatch(/enum NATApi \{[\s\S]*defer \{ NativeDiskCache\.remove\(NativeAPI\.cacheKey\(NativeModuleAPI\.url\(part, query\)\)\) \}/);
    expect(attendance).toContain('NATApi.get(NATPayload.self, part: "attendance"');
    expect(leave).toContain('NATApi.get(NLVPayload.self, part: "leave"');
    for (const src of [attendance, leave]) {
      expect(src).not.toContain('NativeModuleAPI.cached(');
      expect(src.match(/NativeModuleAPI\.get\(/g)?.length ?? 0).toBe(src === attendance ? 1 : 0);
    }
  });

  it('Web のページは同じ読み込みを使う', () => {
    expect(read('app/app/attendance/page.tsx')).toContain("from '@/lib/attendance-server'");
    expect(read('app/app/leave/page.tsx')).toContain("from '@/lib/leave-server'");
  });
});
