import { describe, expect, it } from 'vitest';
import { groupOrderRounds, ordinalLabel } from '@/components/handy/logic';

/** ハンディの卓の伝票：注文の回（1st・2nd・3rd・4th。2026-09-30 Ronnie） */
describe('注文の回', () => {
  it('英語の序数', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinalLabel)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st',
    ]);
  });

  it('送った時刻で回に分け、送った順に 1st, 2nd… 。未送信は最後', () => {
    const t = Date.UTC(2026, 8, 30, 9, 0, 0);
    const rounds = groupOrderRounds([
      { id: 'a', sentAtMs: t },
      { id: 'b', sentAtMs: t + 1000 },
      { id: 'c', sentAtMs: t + 20 * 60_000 },
      { id: 'd', sentAtMs: null },
      { id: 'e', sentAtMs: t + 45 * 60_000 },
    ]);
    expect(rounds.map((r) => [r.index, r.items.map((i) => i.id)])).toEqual([
      [1, ['a', 'b']],
      [2, ['c']],
      [3, ['e']],
      [null, ['d']],
    ]);
  });

  it('品目が無ければ空', () => {
    expect(groupOrderRounds([])).toEqual([]);
  });
});
