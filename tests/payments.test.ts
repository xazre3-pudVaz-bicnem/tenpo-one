import { describe, expect, it } from 'vitest';
import {
  bookingIdempotencyKey,
  computeBookingCharge,
  isValidChargeAmount,
  posIdempotencyKey,
  refundIdempotencyKey,
} from '@/lib/payments/types';

describe('idempotencyキー（二重決済防止）', () => {
  it('POS: 同一注文×同一金額は同一キー（リトライで新規決済が発生しない）', () => {
    expect(posIdempotencyKey('order-1', 2180)).toBe(posIdempotencyKey('order-1', 2180));
  });
  it('POS: 金額が変わるとキーが変わる（旧intentはキャンセルして作り直す）', () => {
    expect(posIdempotencyKey('order-1', 2180)).not.toBe(posIdempotencyKey('order-1', 3000));
  });
  it('予約: 予約×用途×金額で一意', () => {
    expect(bookingIdempotencyKey('r1', 'booking_prepay', 11000)).toBe('book:r1:booking_prepay:11000');
    expect(bookingIdempotencyKey('r1', 'booking_deposit', 2000)).not.toBe(
      bookingIdempotencyKey('r1', 'booking_prepay', 2000)
    );
  });
  it('返金: 連番で複数回の部分返金を区別する', () => {
    expect(refundIdempotencyKey('pi1', 500, 1)).not.toBe(refundIdempotencyKey('pi1', 500, 2));
  });
});

describe('computeBookingCharge（予約決済額）', () => {
  it('現地払い（onsite）は決済不要', () => {
    const r = computeBookingCharge({ mode: 'onsite', depositAmount: 0, coursePrice: 5500, partySize: 4 });
    expect(r.amountYen).toBe(0);
    expect(r.purpose).toBeNull();
  });
  it('全額前払い: コース価格 × 人数', () => {
    const r = computeBookingCharge({ mode: 'prepay_full', depositAmount: 0, coursePrice: 5500, partySize: 4 });
    expect(r.amountYen).toBe(22000);
    expect(r.purpose).toBe('booking_prepay');
  });
  it('全額前払いでもコース未選択なら決済不要', () => {
    const r = computeBookingCharge({ mode: 'prepay_full', depositAmount: 0, coursePrice: null, partySize: 4 });
    expect(r.purpose).toBeNull();
  });
  it('予約金: 設定額 × 人数', () => {
    const r = computeBookingCharge({ mode: 'deposit', depositAmount: 1000, coursePrice: 5500, partySize: 3 });
    expect(r.amountYen).toBe(3000);
    expect(r.purpose).toBe('booking_deposit');
  });
  it('予約金モードでも設定額0なら決済不要', () => {
    const r = computeBookingCharge({ mode: 'deposit', depositAmount: 0, coursePrice: null, partySize: 2 });
    expect(r.purpose).toBeNull();
  });
});

describe('isValidChargeAmount（決済金額検証）', () => {
  it('正の整数円のみ許可', () => {
    expect(isValidChargeAmount(100)).toBe(true);
    expect(isValidChargeAmount(0)).toBe(false);
    expect(isValidChargeAmount(-500)).toBe(false);
    expect(isValidChargeAmount(100.5)).toBe(false);
  });
  it('上限（1,000万円）を超える金額は拒否', () => {
    expect(isValidChargeAmount(10_000_001)).toBe(false);
  });
});
