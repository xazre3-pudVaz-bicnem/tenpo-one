import { describe, it, expect } from 'vitest';
import { isPlanTimeOver, planMinutesLeft, toMs } from '@/lib/plan-time';

const t = (s: string) => Date.parse(s);

describe('プランの時間切れ', () => {
  it('終了予定を過ぎたら時間切れ', () => {
    const end = t('2026-09-25T12:00:00Z');
    expect(isPlanTimeOver(end, t('2026-09-25T11:59:00Z'))).toBe(false);
    expect(isPlanTimeOver(end, end)).toBe(false);
    expect(isPlanTimeOver(end, t('2026-09-25T12:00:01Z'))).toBe(true);
  });

  it('時間制でない卓（end_at 無し）は時間切れにしない', () => {
    expect(isPlanTimeOver(null, Date.now())).toBe(false);
    expect(isPlanTimeOver(undefined, Date.now())).toBe(false);
    expect(isPlanTimeOver(Number.NaN, Date.now())).toBe(false);
  });

  it('残り時間は切り上げ、過ぎたら0', () => {
    const end = t('2026-09-25T12:00:00Z');
    expect(planMinutesLeft(end, t('2026-09-25T11:30:00Z'))).toBe(30);
    expect(planMinutesLeft(end, t('2026-09-25T11:59:01Z'))).toBe(1);
    expect(planMinutesLeft(end, t('2026-09-25T12:30:00Z'))).toBe(0);
    expect(planMinutesLeft(null, Date.now())).toBeNull();
  });

  it('ISO文字列をミリ秒に', () => {
    expect(toMs('2026-09-25T12:00:00Z')).toBe(t('2026-09-25T12:00:00Z'));
    expect(toMs(null)).toBeNull();
    expect(toMs('')).toBeNull();
    expect(toMs('not a date')).toBeNull();
  });
});
