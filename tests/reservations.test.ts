import { describe, expect, it } from 'vitest';
import { canTransition, suggestTables, type TableLike } from '@/lib/reservations';
import { computeSlots, type SlotOptions } from '@/lib/booking';

const table = (id: string, name: string, min: number, max: number, occupied = false): TableLike => ({
  id, name, capacityMin: min, capacityMax: max, isActive: true, isOccupied: occupied,
});

describe('suggestTables（テーブル自動候補）', () => {
  const tables = [
    table('t1', 'T1', 2, 4),
    table('t2', 'T2', 2, 4),
    table('c1', 'C1', 1, 2),
    table('vip', '個室1', 4, 8),
  ];

  it('2名: 無駄席が最少の空き単卓を最優先する（C1）', () => {
    const s = suggestTables(tables, 2);
    expect(s[0].tableIds).toEqual(['c1']);
    expect(s[0].combined).toBe(false);
  });

  it('6名: 単卓は個室のみ、結合候補も提示される', () => {
    const s = suggestTables(tables, 6);
    expect(s[0].tableIds).toEqual(['vip']);
    expect(s.some((x) => x.combined && x.totalCapacity >= 6)).toBe(true);
  });

  it('割当済みテーブルは候補から除外される', () => {
    const s = suggestTables([table('t1', 'T1', 2, 4, true), table('t2', 'T2', 2, 4)], 3);
    expect(s.every((x) => !x.tableIds.includes('t1'))).toBe(true);
  });

  it('8名: 単卓で収まらなければ結合（4+4）を提案する', () => {
    const s = suggestTables([table('t1', 'T1', 2, 4), table('t2', 'T2', 2, 4)], 8);
    expect(s[0].combined).toBe(true);
    expect(s[0].tableIds).toHaveLength(2);
  });

  it('満たせる組み合わせがない場合は空配列', () => {
    expect(suggestTables([table('c1', 'C1', 1, 2)], 10)).toEqual([]);
  });
});

describe('canTransition（予約ステータス遷移）', () => {
  it('正常な業務フロー: 確定→来店待ち→来店→着席→会計待ち→会計済み', () => {
    expect(canTransition('confirmed', 'waiting')).toBe(true);
    expect(canTransition('waiting', 'arrived')).toBe(true);
    expect(canTransition('arrived', 'seated')).toBe(true);
    expect(canTransition('seated', 'billing')).toBe(true);
    expect(canTransition('billing', 'completed')).toBe(true);
  });
  it('不正遷移は拒否: 会計済み→着席、キャンセル→確定', () => {
    expect(canTransition('completed', 'seated')).toBe(false);
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
    expect(canTransition('no_show', 'seated')).toBe(false);
  });
  it('キャンセル待ちからは確定へ昇格できる', () => {
    expect(canTransition('waitlisted', 'confirmed')).toBe(true);
  });
});

describe('computeSlots: 貸切ブロック', () => {
  const base: SlotOptions = {
    date: '2026-09-01',
    partySize: 2,
    capacity: 20,
    slotMinutes: 30,
    stayMinutes: 120,
    cutoffMinutes: 0,
    now: new Date('2026-08-20T12:00:00+09:00'),
    businessHour: {
      dayOfWeek: 2, isClosed: false, openTime: '11:00', closeTime: '23:00', lastEntryTime: '21:30',
    },
    isHoliday: false,
    reservations: [],
  };

  it('貸切予約の時間帯は残席があっても満席になる', () => {
    const slots = computeSlots({
      ...base,
      reservations: [{
        startAt: new Date('2026-09-01T18:00:00+09:00'),
        endAt: new Date('2026-09-01T21:00:00+09:00'),
        partySize: 4,
        isPrivateHire: true,
      }],
    });
    expect(slots.find((s) => s.time === '18:30')?.available).toBe(false);
    expect(slots.find((s) => s.time === '12:00')?.available).toBe(true);
  });
});
