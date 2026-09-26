import { describe, expect, it } from 'vitest';
import {
  durationForCourse,
  isGuestCount,
  isSeatDuration,
  jstHm,
  seatBadgeLabel,
  seatDurationMinutes,
} from '@/lib/seat-time';

// 2026-09-22 18:03 JST
const start = Date.UTC(2026, 8, 22, 9, 3);

describe('seat-time', () => {
  it('日本時間の HH:MM', () => {
    expect(jstHm(start)).toBe('18:03');
  });
  it('時間（分）は開始と終了予定から', () => {
    expect(seatDurationMinutes({ startMs: start, endMs: start + 120 * 60_000 })).toBe(120);
    expect(seatDurationMinutes({ startMs: start, endMs: null })).toBeNull();
    expect(seatDurationMinutes({ startMs: start, endMs: start - 1 })).toBeNull();
  });
  it('時間の範囲は15分〜8時間', () => {
    expect(isSeatDuration(90)).toBe(true);
    expect(isSeatDuration(10)).toBe(false);
    expect(isSeatDuration(600)).toBe(false);
    expect(isSeatDuration(90.5)).toBe(false);
  });
  it('コースを選ぶと所要時間が既定値、無ければ今の時間のまま', () => {
    expect(durationForCourse({ id: 'c', name: 'C', durationMinutes: 150 }, 120)).toBe(150);
    expect(durationForCourse({ id: 'c', name: 'C', durationMinutes: null }, 120)).toBe(120);
    expect(durationForCourse(null, null)).toBeNull();
  });
  it('バッジの表示', () => {
    const courses = [{ id: 'c', name: '3h 3980 course', durationMinutes: 180 }];
    expect(seatBadgeLabel({ startMs: start, endMs: start + 120 * 60_000, courseId: null }, courses)).toBe('18:03〜20:03');
    expect(seatBadgeLabel({ startMs: start, endMs: start + 180 * 60_000, courseId: 'c' }, courses)).toBe(
      '18:03〜21:03・3h 3980 course'
    );
    expect(seatBadgeLabel({ startMs: start, endMs: null, courseId: null }, courses)).toBe('18:03〜');
  });
  it('人数は 1〜999 の整数だけ', () => {
    expect(isGuestCount(1)).toBe(true);
    expect(isGuestCount(999)).toBe(true);
    expect(isGuestCount(0)).toBe(false);
    expect(isGuestCount(1000)).toBe(false);
    expect(isGuestCount(2.5)).toBe(false);
    expect(isGuestCount('4')).toBe(false);
  });
});
