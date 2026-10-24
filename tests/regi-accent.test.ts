import { describe, expect, it } from 'vitest';
import { adminAccentFor, regiAccentFor } from '@/lib/regi-accent';

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

describe('adminAccentFor（管理画面の画面ごとの色。2026-10-24「iPad の機能と同じ色で」）', () => {
  it('iPad にある画面は iPad と同じ色', () => {
    expect(adminAccentFor('/app/floor')).toBe('order');
    expect(adminAccentFor('/app/quick-pay')).toBe('quick');
    expect(adminAccentFor('/app/reservations/calendar')).toBe('ledger');
    expect(adminAccentFor('/app/expenses')).toBe('bills');
  });
  it('iPad に無い画面は近い機能の色', () => {
    expect(adminAccentFor('/app/settings-all')).toBe('settings');
    expect(adminAccentFor('/app/staff')).toBe('settings');
    expect(adminAccentFor('/app/vendors')).toBe('stock');
    expect(adminAccentFor('/app/purchases/new')).toBe('stock');
    expect(adminAccentFor('/app/now')).toBe('order');
  });
  it('決まっていない画面は null（管理画面の既定の青）', () => {
    expect(adminAccentFor('/app/dashboard')).toBeNull();
    expect(adminAccentFor('/app/management')).toBeNull();
    expect(adminAccentFor('/app/customers')).toBeNull();
  });
});
