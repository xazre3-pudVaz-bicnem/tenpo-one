import { describe, expect, it } from 'vitest';
import {
  addDays,
  isHm,
  isNativeShiftActionType,
  isYmd,
  mondayOf,
  NATIVE_SHIFT_ACTION_TYPES,
  parseNativeShiftAction,
} from '@/lib/native-shifts';

const ID = '11111111-2222-4333-8444-555555555555';
const ID2 = '66666666-7777-4888-9999-000000000000';

describe('週の日付（Web のシフト表と同じ UTC の日付計算）', () => {
  it('mondayOf はその週の月曜', () => {
    expect(mondayOf('2026-10-24')).toBe('2026-10-19'); // 土
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // 日
    expect(mondayOf('2026-10-19')).toBe('2026-10-19'); // 月
    expect(mondayOf('2027-01-01')).toBe('2026-12-28'); // 年をまたぐ
  });

  it('addDays は月・年をまたぐ', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-28', 6)).toBe('2027-01-03');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('isYmd は実在する日付だけ', () => {
    expect(isYmd('2026-10-24')).toBe(true);
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('2026-1-01')).toBe(false);
    expect(isYmd(20261024)).toBe(false);
  });

  it('isHm は 00:00〜23:59', () => {
    expect(isHm('09:00')).toBe(true);
    expect(isHm('23:59')).toBe(true);
    expect(isHm('24:00')).toBe(false);
    expect(isHm('9:00')).toBe(false);
    expect(isHm('09:00:00')).toBe(false);
  });
});

describe('parseNativeShiftAction', () => {
  it('種類の一覧と判定', () => {
    for (const t of NATIVE_SHIFT_ACTION_TYPES) expect(isNativeShiftActionType(t)).toBe(true);
    expect(isNativeShiftActionType('payrollRuleSave')).toBe(false);
    expect(isNativeShiftActionType(null)).toBe(false);
  });

  it('shiftUpsert（新規・更新）', () => {
    const base = { type: 'shiftUpsert', profileId: ID, date: '2026-10-24', startTime: '09:00', endTime: '17:00', kind: 'confirmed' };
    expect(parseNativeShiftAction(base)).toEqual({ ok: true, action: { ...base } });
    expect(parseNativeShiftAction({ ...base, id: ID2 })).toEqual({ ok: true, action: { ...base, id: ID2 } });
    expect(parseNativeShiftAction({ ...base, id: null })).toEqual({ ok: true, action: { ...base } });
    expect(parseNativeShiftAction({ ...base, id: 'x' }).ok).toBe(false);
    expect(parseNativeShiftAction({ ...base, profileId: '' })).toEqual({ ok: false, error: 'スタッフを選択してください' });
    expect(parseNativeShiftAction({ ...base, date: '2026-13-01' })).toEqual({ ok: false, error: '日付が正しくありません' });
    expect(parseNativeShiftAction({ ...base, endTime: '25:00' })).toEqual({ ok: false, error: '時刻が正しくありません' });
    expect(parseNativeShiftAction({ ...base, kind: 'other' })).toEqual({ ok: false, error: '種別が正しくありません' });
  });

  it('shiftPublish は月曜にそろえて 7 日間', () => {
    expect(parseNativeShiftAction({ type: 'shiftPublish', weekStart: '2026-10-22' })).toEqual({
      ok: true,
      action: { type: 'shiftPublish', weekStart: '2026-10-19', weekEnd: '2026-10-25' },
    });
    expect(parseNativeShiftAction({ type: 'shiftPublish', weekStart: 'x' }).ok).toBe(false);
  });

  it('shiftRequest（本人の希望）', () => {
    const base = { type: 'shiftRequest', date: '2026-10-24', startTime: '10:00', endTime: '15:00' };
    expect(parseNativeShiftAction(base)).toEqual({ ok: true, action: base });
    expect(parseNativeShiftAction({ ...base, id: ID })).toEqual({ ok: true, action: { ...base, id: ID } });
    expect(parseNativeShiftAction({ ...base, startTime: '' }).ok).toBe(false);
  });

  it('shiftChangeRequest（休み希望は時刻なし、理由は 500 字まで）', () => {
    expect(parseNativeShiftAction({ type: 'shiftChangeRequest', shiftId: ID, dayOff: true, reason: '通院のため', desiredStart: '10:00' })).toEqual({
      ok: true,
      action: { type: 'shiftChangeRequest', shiftId: ID, dayOff: true, desiredStart: null, desiredEnd: null, reason: '通院のため' },
    });
    expect(parseNativeShiftAction({ type: 'shiftChangeRequest', shiftId: ID, dayOff: false, reason: 'x', desiredStart: '10:00', desiredEnd: '14:00' })).toEqual({
      ok: true,
      action: { type: 'shiftChangeRequest', shiftId: ID, dayOff: false, desiredStart: '10:00', desiredEnd: '14:00', reason: 'x' },
    });
    expect(parseNativeShiftAction({ type: 'shiftChangeRequest', shiftId: ID, dayOff: false, reason: 'x' })).toEqual({
      ok: false,
      error: '希望時間を正しく入力してください',
    });
    const long = parseNativeShiftAction({ type: 'shiftChangeRequest', shiftId: ID, dayOff: true, reason: 'あ'.repeat(800) });
    expect(long.ok && long.action.type === 'shiftChangeRequest' ? long.action.reason.length : 0).toBe(500);
  });

  it('shiftReqAdd（曜日 0〜6、人数は整数）', () => {
    const base = { type: 'shiftReqAdd', dayOfWeek: 1, timeFrom: '11:00', timeTo: '15:00', requiredCount: 2 };
    expect(parseNativeShiftAction(base)).toEqual({ ok: true, action: base });
    expect(parseNativeShiftAction({ ...base, dayOfWeek: 7 })).toEqual({ ok: false, error: '曜日が正しくありません' });
    expect(parseNativeShiftAction({ ...base, requiredCount: 1.5 }).ok).toBe(false);
    // 0 は Server Action が Web と同じことばで断る（ここは通す）
    expect(parseNativeShiftAction({ ...base, requiredCount: 0 }).ok).toBe(true);
  });

  it('id だけの操作', () => {
    expect(parseNativeShiftAction({ type: 'shiftDelete', id: ID })).toEqual({ ok: true, action: { type: 'shiftDelete', id: ID } });
    expect(parseNativeShiftAction({ type: 'shiftRejectChange', shiftId: ID })).toEqual({ ok: true, action: { type: 'shiftRejectChange', shiftId: ID } });
    expect(parseNativeShiftAction({ type: 'shiftReqDelete', id: ID })).toEqual({ ok: true, action: { type: 'shiftReqDelete', id: ID } });
    expect(parseNativeShiftAction({ type: 'shiftDelete', id: 'nope' }).ok).toBe(false);
    expect(parseNativeShiftAction(null).ok).toBe(false);
    expect(parseNativeShiftAction([]).ok).toBe(false);
    expect(parseNativeShiftAction({ type: 'unknown' }).ok).toBe(false);
  });
});
