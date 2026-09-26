import { describe, expect, it } from 'vitest';
import {
  businessDayProblem,
  businessHourOptions,
  businessHoursLabel,
  hmToMin,
  minToHm,
  toBusinessDayTime,
  toDbTime,
} from '@/lib/business-hours';

describe('営業日の時刻（24:00〜30:00。2026-09-27 Ronnie）', () => {
  it('分との変換', () => {
    expect(hmToMin('25:00')).toBe(1500);
    expect(hmToMin('30:00')).toBe(1800);
    expect(hmToMin('30:15')).toBeNull();
    expect(hmToMin('9:30')).toBe(570);
    expect(hmToMin('junk')).toBeNull();
    expect(minToHm(1500)).toBe('25:00');
  });

  it('DB へは 24 を引いて保存（25:00 → 01:00、24:00 → 00:00）', () => {
    expect(toDbTime('25:00')).toBe('01:00');
    expect(toDbTime('24:00')).toBe('00:00');
    expect(toDbTime('23:00')).toBe('23:00');
    expect(toDbTime(null)).toBeNull();
  });

  it('DB から読むときは開店より前なら翌日（+24h）', () => {
    expect(toBusinessDayTime('01:00:00', '12:00:00')).toBe('25:00');
    expect(toBusinessDayTime('06:00', '17:00')).toBe('30:00');
    expect(toBusinessDayTime('23:00', '12:00')).toBe('23:00');
    // 開店と同じ時刻は翌日扱い（24時間営業のような設定）
    expect(toBusinessDayTime('12:00', '12:00')).toBe('36:00');
    expect(toBusinessDayTime('23:00', null)).toBe('23:00');
  });

  it('表示ラベル', () => {
    expect(businessHoursLabel('17:00:00', '05:00:00', '04:00:00')).toBe('17:00〜29:00（最終入店 28:00）');
    expect(businessHoursLabel('12:00', '23:00')).toBe('12:00〜23:00');
  });

  it('整合性チェック', () => {
    expect(businessDayProblem('12:00', '25:00', '24:00')).toBeNull();
    expect(businessDayProblem('12:00', '11:00', null)).toMatch(/閉店は開店より後/);
    expect(businessDayProblem('12:00', '25:00', '26:00')).toMatch(/最終入店/);
    expect(businessDayProblem(null, '25:00', null)).toMatch(/入力/);
  });

  it('選択肢は 15 分刻みで 30:00 まで', () => {
    const opts = businessHourOptions();
    expect(opts[0]).toBe('00:00');
    expect(opts[opts.length - 1]).toBe('30:00');
    expect(opts).toContain('25:45');
  });
});
