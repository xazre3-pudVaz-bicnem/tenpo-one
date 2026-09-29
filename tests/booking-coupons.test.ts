import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  bookingCouponsFrom,
  bookingCouponsProblem,
  couponLabel,
  requestWithCoupon,
  MAX_BOOKING_COUPONS,
} from '@/lib/booking-coupons';

/** 2026-09-30 Ronnie「当店のクーポン。% か ¥ の OFF、文だけ（幹事様無料・ご予約限定コース）も。予約リンクで選べる」 */
describe('当店のクーポン', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('表示の文', () => {
    expect(couponLabel({ title: 'アラカルト', value: 5, unit: 'percent' })).toBe('アラカルト 5%OFF');
    expect(couponLabel({ title: '全品', value: 500, unit: 'yen' })).toBe('全品 ¥500OFF');
    expect(couponLabel({ title: '10名様以上で幹事様1名無料', value: null, unit: 'percent' })).toBe('10名様以上で幹事様1名無料');
    expect(couponLabel({ title: '', value: 1000, unit: 'yen' })).toBe('¥1,000OFF');
  });

  it('設定から読む（壊れた行は捨てる・5件まで）', () => {
    const list = bookingCouponsFrom({
      bookingCoupons: [
        { id: 'abcd1234', title: 'アラカルト', value: 5, unit: 'percent' },
        { id: 'bad id', title: 'x', value: 1, unit: 'yen' },
        { id: 'efgh5678', title: '', value: null, unit: 'yen' },
        { id: 'ijkl9012', title: 'ここからご予約のみのコース', value: null, unit: 'percent' },
        { id: 'mnop3456', title: '割引', value: 150, unit: 'percent' },
        'junk',
      ],
    });
    expect(list.map((c) => c.id)).toEqual(['abcd1234', 'ijkl9012', 'mnop3456']);
    expect(list[2].value).toBeNull(); // 150% は無効
    const many = bookingCouponsFrom({
      bookingCoupons: Array.from({ length: 8 }, (_, i) => ({ id: `id${i}xxx`, title: `c${i}`, value: null, unit: 'yen' })),
    });
    expect(many).toHaveLength(MAX_BOOKING_COUPONS);
    expect(bookingCouponsFrom(null)).toEqual([]);
  });

  it('保存前のチェック', () => {
    expect(bookingCouponsProblem([{ id: 'a1b2', title: 'アラカルト', value: 5, unit: 'percent' }])).toBeNull();
    expect(bookingCouponsProblem([{ id: 'a1b2', title: '', value: null, unit: 'percent' }])).not.toBeNull();
    expect(bookingCouponsProblem([{ id: 'a1b2', title: 'x', value: 101, unit: 'percent' }])).not.toBeNull();
    expect(bookingCouponsProblem([{ id: 'a1b2', title: 'x', value: 0, unit: 'yen' }])).not.toBeNull();
  });

  it('選んだクーポンはご要望の先頭に【クーポン】で残す', () => {
    expect(requestWithCoupon('全品 ¥500OFF', '窓際希望')).toBe('【クーポン】全品 ¥500OFF\n窓際希望');
    expect(requestWithCoupon('全品 ¥500OFF', null)).toBe('【クーポン】全品 ¥500OFF');
    expect(requestWithCoupon(null, ' 窓際 ')).toBe('窓際');
    expect(requestWithCoupon(null, '')).toBeNull();
  });

  it('予約ページ・予約QRカード・店舗名刺・店舗情報につながっている', () => {
    expect(read('app/(public)/book/[storeSlug]/page.tsx')).toContain('当店のクーポン');
    expect(read('components/booking/booking-wizard.tsx')).toContain('couponId: selectedCoupon?.id ?? null');
    expect(read('app/(public)/booking-actions.ts')).toContain('requestWithCoupon(couponText, input.request)');
    expect(read('components/settings/booking-qr-card.tsx')).toContain('当店のクーポン COUPON');
    expect(read('components/settings/booking-meishi.tsx')).toContain('COUPON');
    expect(read('app/app/settings/page.tsx')).toContain('<BookingCouponsEditor');
  });
});
