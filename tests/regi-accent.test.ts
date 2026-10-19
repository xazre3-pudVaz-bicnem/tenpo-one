import { describe, expect, it } from 'vitest';
import { regiAccentFor } from '@/lib/regi-accent';

describe('regiAccentFor（レジの画面ごとの色）', () => {
  it('ホームのボタンと同じ色', () => {
    expect(regiAccentFor('/app/floor')).toBe('order');
    expect(regiAccentFor('/app/pos')).toBe('order');
    expect(regiAccentFor('/app/quick-pay')).toBe('quick');
    expect(regiAccentFor('/app/reservations/inbox')).toBe('ledger');
    expect(regiAccentFor('/app/cash')).toBe('cash');
    expect(regiAccentFor('/app/cash/close')).toBe('close');
    expect(regiAccentFor('/app/expenses')).toBe('bills');
    expect(regiAccentFor('/app/inventory/menu-stock')).toBe('stock');
  });
  it('決まっていない画面は null（今の色）', () => {
    expect(regiAccentFor('/app/dashboard')).toBeNull();
    expect(regiAccentFor('/app/cashier')).toBeNull();
  });
});
