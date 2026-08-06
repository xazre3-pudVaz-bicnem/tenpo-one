import { describe, expect, it } from 'vitest';
import { applicableTaxRate } from '@/lib/tax';

describe('applicableTaxRate（店内10% / テイクアウト8% / 酒類は常に10%）', () => {
  it('店内飲食は10%', () => {
    expect(applicableTaxRate('dine_in', false)).toBe(10);
    expect(applicableTaxRate('course', false)).toBe(10);
  });
  it('テイクアウト・デリバリーの飲食料品は8%', () => {
    expect(applicableTaxRate('takeout', false)).toBe(8);
    expect(applicableTaxRate('delivery', false)).toBe(8);
    expect(applicableTaxRate('pre_order', false)).toBe(8);
  });
  it('酒類はテイクアウトでも10%', () => {
    expect(applicableTaxRate('takeout', true)).toBe(10);
    expect(applicableTaxRate('dine_in', true)).toBe(10);
  });
});
