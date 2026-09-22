import { describe, expect, it } from 'vitest';
import { floorBoardFrom, initialFloorFilter, stepFloor, swipeDirection } from '@/lib/floor-nav';

const F3 = '00000000-0000-4000-8000-000000000003';
const F4 = '00000000-0000-4000-8000-000000000004';
const F5 = '00000000-0000-4000-8000-000000000005';
const floors = [F3, F4, F5];

describe('SHUNKA 新宿: 4F から始まり、右で 5F・左で 3F', () => {
  it('最初は 4F', () => {
    expect(initialFloorFilter(floors, F4)).toBe(F4);
  });
  it('右スライドで 5F、左スライドで 3F', () => {
    expect(stepFloor(floors, F4, 'right', F4)).toBe(F5);
    expect(stepFloor(floors, F4, 'left', F4)).toBe(F3);
  });
  it('端では止まる', () => {
    expect(stepFloor(floors, F5, 'right', F4)).toBe(F5);
    expect(stepFloor(floors, F3, 'left', F4)).toBe(F3);
  });
  it('「すべて」から動かすと最初のフロアへ', () => {
    expect(stepFloor(floors, 'all', 'right', F4)).toBe(F4);
    expect(stepFloor(floors, 'all', 'left', null)).toBe(F3);
  });
});

describe('initialFloorFilter', () => {
  it('未設定・消えたフロアは「すべて」（今まで通り）', () => {
    expect(initialFloorFilter(floors, null)).toBe('all');
    expect(initialFloorFilter(floors, '00000000-0000-4000-8000-000000000009')).toBe('all');
  });
});

describe('swipeDirection', () => {
  it('横に大きく動いたときだけ', () => {
    expect(swipeDirection(120, 10)).toBe('right');
    expect(swipeDirection(-120, 10)).toBe('left');
    expect(swipeDirection(30, 0)).toBeNull();
    expect(swipeDirection(90, 100)).toBeNull();
  });
});

describe('floorBoardFrom', () => {
  it('壊れた値は捨てる', () => {
    expect(floorBoardFrom(null).defaultFloorId).toBeNull();
    expect(floorBoardFrom({ floorBoard: { defaultFloorId: 'x' } }).defaultFloorId).toBeNull();
    expect(floorBoardFrom({ floorBoard: { defaultFloorId: F4 } }).defaultFloorId).toBe(F4);
  });
});
