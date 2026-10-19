import { describe, expect, it } from 'vitest';
import { countWalkIns } from '@/lib/home-todos';

describe('countWalkIns（当日ウォークイン）', () => {
  it('予約なし・直接来店の予約は数え、ネット予約・テイクアウトは数えない', () => {
    expect(
      countWalkIns([
        { order_type: 'dine_in', reservation_id: null },
        { order_type: 'dine_in', reservation_id: 'r1', reservation_created_via: 'walk_in' },
        { order_type: 'course', reservation_id: 'r2', reservation_created_via: 'tableone' },
        { order_type: 'takeout', reservation_id: null },
        { order_type: null, reservation_id: null },
      ])
    ).toBe(3);
  });
});
