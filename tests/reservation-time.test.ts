import { describe, it, expect } from 'vitest';
import {
  hmToMinutes,
  isValidStayMinutes,
  minutesToHm,
  RESERVATION_TIME_OPTIONS,
  RESERVATION_TIME_STEP,
  STAY_MINUTE_OPTIONS,
  stayOptionLabel,
  withCurrentStay,
  withCurrentTime,
} from '@/lib/reservation-time';

describe('予約の開始時刻（15分単位）', () => {
  it('00:00〜23:45 を15分ずつ並べる', () => {
    expect(RESERVATION_TIME_STEP).toBe(15);
    expect(RESERVATION_TIME_OPTIONS).toHaveLength(96);
    expect(RESERVATION_TIME_OPTIONS[0]).toBe('00:00');
    expect(RESERVATION_TIME_OPTIONS[RESERVATION_TIME_OPTIONS.length - 1]).toBe('23:45');
    expect(RESERVATION_TIME_OPTIONS).toContain('18:15');
    expect(RESERVATION_TIME_OPTIONS).toContain('18:45');
  });

  it('15分単位でない既存の予約の時刻は選択肢に足す（日付だけ直しても時刻がずれない）', () => {
    const list = withCurrentTime(RESERVATION_TIME_OPTIONS, '18:10');
    expect(list).toHaveLength(97);
    expect(list.indexOf('18:10')).toBe(list.indexOf('18:00') + 1);
    expect(list.indexOf('18:15')).toBe(list.indexOf('18:10') + 1);
  });

  it('15分単位の時刻・読めない値は足さない', () => {
    expect(withCurrentTime(RESERVATION_TIME_OPTIONS, '18:15')).toHaveLength(96);
    expect(withCurrentTime(RESERVATION_TIME_OPTIONS, 'abc')).toHaveLength(96);
  });

  it('時刻と分の変換（24時を超えたら翌日側）', () => {
    expect(hmToMinutes('18:45')).toBe(1125);
    expect(hmToMinutes('24:00')).toBeNull();
    expect(hmToMinutes('18:60')).toBeNull();
    expect(minutesToHm(1125)).toBe('18:45');
    expect(minutesToHm(23 * 60 + 30 + 45)).toBe('00:15');
  });
});

describe('予約の滞在時間（15分単位）', () => {
  it('30分〜5時間を15分ずつ並べる', () => {
    expect(STAY_MINUTE_OPTIONS[0]).toBe(30);
    expect(STAY_MINUTE_OPTIONS[STAY_MINUTE_OPTIONS.length - 1]).toBe(300);
    expect(STAY_MINUTE_OPTIONS.every((m, i) => i === 0 || m - STAY_MINUTE_OPTIONS[i - 1] === 15)).toBe(true);
    // これまでの選択肢（60/90/120/150/180）は全部残っている
    for (const m of [60, 90, 120, 150, 180]) expect(STAY_MINUTE_OPTIONS).toContain(m);
  });

  it('表示は「分（時間:分）」', () => {
    expect(stayOptionLabel(105)).toBe('105分（1:45）');
    expect(stayOptionLabel(120)).toBe('120分（2:00）');
  });

  it('15分単位でない既存の滞在時間は選択肢に足す。壊れた値は足さない', () => {
    expect(withCurrentStay(STAY_MINUTE_OPTIONS, 100)).toContain(100);
    expect(withCurrentStay(STAY_MINUTE_OPTIONS, 360)).toContain(360);
    expect(withCurrentStay(STAY_MINUTE_OPTIONS, 120)).toHaveLength(STAY_MINUTE_OPTIONS.length);
    expect(withCurrentStay(STAY_MINUTE_OPTIONS, 0)).toHaveLength(STAY_MINUTE_OPTIONS.length);
    expect(withCurrentStay(STAY_MINUTE_OPTIONS, -30)).toHaveLength(STAY_MINUTE_OPTIONS.length);
  });

  it('サーバーで受け付ける滞在時間は 1分〜24時間の整数', () => {
    expect(isValidStayMinutes(105)).toBe(true);
    expect(isValidStayMinutes(0)).toBe(false);
    expect(isValidStayMinutes(1.5)).toBe(false);
    expect(isValidStayMinutes(Number.NaN)).toBe(false);
    expect(isValidStayMinutes(24 * 60 + 1)).toBe(false);
  });
});
