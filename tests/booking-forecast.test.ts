import { describe, it, expect } from 'vitest';
import { bookingForecast, seatOnlyUnitPrices, type UnitPriceOrder } from '@/lib/booking-forecast';

/** 2026-09-30 Ronnie「コースはコースの金額、席のみは1週間の席のみの客単価の平均で、ご予約から見込む売上を自動で」 */
describe('ご予約から見込む売上', () => {
  const orders: UnitPriceOrder[] = [
    // A店：席のみの来店 2組（計 5名・¥20,000）、コースの来店 1組、予約なしの会計
    { storeId: 'A', total: 12000, guests: 3, seatOnlyReservation: true },
    { storeId: 'A', total: 8000, guests: 2, seatOnlyReservation: true },
    { storeId: 'A', total: 30000, guests: 4, seatOnlyReservation: false },
    { storeId: 'A', total: 1000, guests: 0, seatOnlyReservation: null },
    // B店：席のみ無し → 店全体の客単価
    { storeId: 'B', total: 9000, guests: 3, seatOnlyReservation: null },
    { storeId: 'B', total: 21000, guests: 3, seatOnlyReservation: false },
  ];

  it('席のみ客単価：席のみのご予約・来店の 売上÷人数。無ければ店全体、会計が無ければ 0', () => {
    const u = seatOnlyUnitPrices(['A', 'B', 'C'], orders);
    expect(u.get('A')).toEqual({ unit: 4000, basis: 'seat_only', samples: 2 });
    expect(u.get('B')).toEqual({ unit: 5000, basis: 'store', samples: 2 });
    expect(u.get('C')).toEqual({ unit: 0, basis: 'none', samples: 0 });
  });

  it('コースは金額×人数、席のみは客単価×人数。金額の無いコースは席のみと同じに数える', () => {
    const u = seatOnlyUnitPrices(['A', 'B'], orders);
    const f = bookingForecast(
      [
        { storeId: 'A', partySize: 4, coursePrice: 5500 },
        { storeId: 'A', partySize: 2, coursePrice: null },
        { storeId: 'B', partySize: 3, coursePrice: null },
        { storeId: 'A', partySize: 2, coursePrice: 0 },
      ],
      u
    );
    expect(f.course).toEqual({ count: 1, guests: 4, amount: 22000 });
    expect(f.seatOnly).toEqual({ count: 3, guests: 7, amount: 2 * 4000 + 3 * 5000 + 2 * 4000 });
    expect(f.total).toBe(22000 + 31000);
  });

  it('人数 0 の予約は 1名として数える', () => {
    const f = bookingForecast([{ storeId: 'A', partySize: 0, coursePrice: 3000 }], new Map());
    expect(f.total).toBe(3000);
  });
});
