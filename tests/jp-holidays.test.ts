import { describe, it, expect } from 'vitest';
import { japaneseHolidays, holidayName } from '@/lib/jp-holidays';

describe('日本の祝日', () => {
  it('2026年', () => {
    expect([...japaneseHolidays(2026).keys()].sort()).toEqual([
      '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
      '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
    ]);
    expect(holidayName('2026-05-06')).toBe('振替休日');
    expect(holidayName('2026-09-22')).toBe('国民の休日');
    expect(holidayName('2026-10-12')).toBe('スポーツの日');
    expect(holidayName('2026-10-19')).toBeNull();
  });
  it('2027年：振替休日（2/11は木・3/21日曜→3/22）', () => {
    expect(holidayName('2027-03-21')).toBe('春分の日');
    expect(holidayName('2027-03-22')).toBe('振替休日');
    expect(holidayName('2027-01-11')).toBe('成人の日');
  });
});
