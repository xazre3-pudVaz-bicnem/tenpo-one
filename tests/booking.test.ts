import { describe, expect, it } from 'vitest';
import { computeSlots, type SlotOptions } from '@/lib/booking';

const baseOpts: SlotOptions = {
  date: '2026-09-01',
  partySize: 2,
  capacity: 20,
  slotMinutes: 30,
  stayMinutes: 120,
  cutoffMinutes: 120,
  now: new Date('2026-08-30T12:00:00+09:00'),
  businessHour: {
    dayOfWeek: 2,
    isClosed: false,
    openTime: '11:00',
    closeTime: '23:00',
    lastEntryTime: '21:30',
  },
  isHoliday: false,
  reservations: [],
};

describe('computeSlots（予約枠判定）', () => {
  it('営業時間内に30分刻みのスロットを生成する', () => {
    const slots = computeSlots(baseOpts);
    expect(slots[0].time).toBe('11:00');
    expect(slots.at(-1)!.time).toBe('21:30');
    expect(slots).toHaveLength(22);
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it('休業日は空配列', () => {
    expect(computeSlots({ ...baseOpts, isHoliday: true })).toEqual([]);
  });

  it('定休日（isClosed）は空配列', () => {
    expect(
      computeSlots({ ...baseOpts, businessHour: { ...baseOpts.businessHour!, isClosed: true } })
    ).toEqual([]);
  });

  it('収容能力を超える人数は空配列', () => {
    expect(computeSlots({ ...baseOpts, partySize: 21 })).toEqual([]);
  });

  it('締切時間内のスロットは不可になる', () => {
    const slots = computeSlots({
      ...baseOpts,
      date: '2026-08-30',
      now: new Date('2026-08-30T12:00:00+09:00'),
    });
    // 12:00 + 120分締切 = 14:00以降のみ予約可
    const at1330 = slots.find((s) => s.time === '13:30');
    const at1400 = slots.find((s) => s.time === '14:00');
    expect(at1330?.available).toBe(false);
    expect(at1400?.available).toBe(true);
  });

  it('滞在時間が重複する既存予約の人数分だけ容量が減る', () => {
    const slots = computeSlots({
      ...baseOpts,
      partySize: 4,
      capacity: 10,
      reservations: [
        {
          startAt: new Date('2026-09-01T18:00:00+09:00'),
          endAt: new Date('2026-09-01T20:00:00+09:00'),
          partySize: 8,
        },
      ],
    });
    // 18:00-20:00は8名使用中 → 残2名 → 4名は不可
    expect(slots.find((s) => s.time === '18:00')?.available).toBe(false);
    expect(slots.find((s) => s.time === '19:30')?.available).toBe(false);
    // 16:30開始は18:00までに被る（16:30+120=18:30）→不可
    expect(slots.find((s) => s.time === '16:30')?.available).toBe(false);
    // 16:00開始は18:00終了で重複ぎりぎり回避 → 可
    expect(slots.find((s) => s.time === '16:00')?.available).toBe(true);
    // 20:00開始は退店後 → 可
    expect(slots.find((s) => s.time === '20:00')?.available).toBe(true);
  });
});
