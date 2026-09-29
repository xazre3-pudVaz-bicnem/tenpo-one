/**
 * ご予約から見込む売上（予算管理の「ご予約から見込む売上（自動計算）」）。
 * 2026-09-30 Ronnie「今日までに入っているご予約で見込める売上を自動で計算して見せる。コースはコースの金額で、
 * 席のみのご予約は、1週間の席のみの客単価の平均で」。
 *
 *   コースのご予約 … コースの金額（税込）× 人数（会計でコースを人数分計上するのと同じ）
 *   席のみのご予約 … 店の「席のみ客単価」× 人数
 *   席のみ客単価   … 直近7日（昨日まで）に会計した、コースなしのご予約・来店の 売上 ÷ 人数（店ごと）。
 *                    1件も無い店は、直近7日の店全体の客単価で代わりに計算する
 *
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

/** これから来店するご予約（キャンセル・無断キャンセル・キャンセル待ち・会計済みは入れない） */
export const UPCOMING_RESERVATION_STATUSES = ['pending', 'confirmed', 'waiting', 'arrived', 'seated', 'billing'] as const;

/** 席のみ客単価を見る日数 */
export const SEAT_ONLY_UNIT_DAYS = 7;

export interface ForecastReservation {
  storeId: string;
  partySize: number;
  /** コースの金額（税込・1人分）。席のみは null */
  coursePrice: number | null;
}

/** 直近7日の会計（ご予約・来店に紐づくもの・紐づかないもの両方） */
export interface UnitPriceOrder {
  storeId: string;
  total: number;
  guests: number;
  /** 紐づくご予約・来店がコースなしなら true。コースありは false。ご予約に紐づかない会計は null */
  seatOnlyReservation: boolean | null;
}

export type SeatOnlyUnitBasis = 'seat_only' | 'store' | 'none';

export interface SeatOnlyUnit {
  /** 1人あたり（円・整数） */
  unit: number;
  /** seat_only＝席のみのご予約・来店の平均 / store＝店全体の客単価で代わり / none＝会計なし */
  basis: SeatOnlyUnitBasis;
  /** 計算に使った会計の件数 */
  samples: number;
}

function perGuest(orders: UnitPriceOrder[]): { unit: number; samples: number } | null {
  let total = 0;
  let guests = 0;
  for (const o of orders) {
    if (!(o.guests > 0) || !Number.isFinite(o.total)) continue;
    total += o.total;
    guests += o.guests;
  }
  if (guests <= 0) return null;
  return { unit: Math.round(total / guests), samples: orders.filter((o) => o.guests > 0).length };
}

/** 店ごとの席のみ客単価 */
export function seatOnlyUnitPrices(storeIds: readonly string[], orders: readonly UnitPriceOrder[]): Map<string, SeatOnlyUnit> {
  const out = new Map<string, SeatOnlyUnit>();
  for (const storeId of storeIds) {
    const mine = orders.filter((o) => o.storeId === storeId);
    const seatOnly = perGuest(mine.filter((o) => o.seatOnlyReservation === true));
    if (seatOnly) {
      out.set(storeId, { ...seatOnly, basis: 'seat_only' });
      continue;
    }
    const store = perGuest(mine);
    out.set(storeId, store ? { ...store, basis: 'store' } : { unit: 0, basis: 'none', samples: 0 });
  }
  return out;
}

export interface BookingForecastPart {
  count: number;
  guests: number;
  amount: number;
}

export interface BookingForecast {
  course: BookingForecastPart;
  seatOnly: BookingForecastPart;
  total: number;
}

/**
 * ご予約から見込む売上。コースの金額が入っていない（0円・未設定）コースのご予約は席のみと同じに数える。
 */
export function bookingForecast(
  reservations: readonly ForecastReservation[],
  unitByStore: ReadonlyMap<string, SeatOnlyUnit>
): BookingForecast {
  const course: BookingForecastPart = { count: 0, guests: 0, amount: 0 };
  const seatOnly: BookingForecastPart = { count: 0, guests: 0, amount: 0 };
  for (const r of reservations) {
    const guests = Math.max(1, Math.floor(r.partySize || 0));
    if (r.coursePrice != null && r.coursePrice > 0) {
      course.count += 1;
      course.guests += guests;
      course.amount += r.coursePrice * guests;
    } else {
      seatOnly.count += 1;
      seatOnly.guests += guests;
      seatOnly.amount += (unitByStore.get(r.storeId)?.unit ?? 0) * guests;
    }
  }
  return { course, seatOnly, total: course.amount + seatOnly.amount };
}
