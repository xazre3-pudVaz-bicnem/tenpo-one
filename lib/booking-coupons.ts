/**
 * 当店のクーポン（予約ページ・予約QRカード・店舗名刺に出す。お客様は予約のときに選べる）。
 * 2026-09-30 Ronnie「当店のクーポンを書けるように。横に OFF ボタンで % か ¥（5 なら 5%、¥ なら 500円）。
 * 『ここからご予約のみのコース』『10名様以上で幹事様1名無料』『アラカルトで OFF』『¥ OFF』のようなもの。
 * ご予約リンクを開いても出て、クーポンを選べるように」。
 *
 * 店舗設定 store_settings.settings.bookingCoupons に入れる。割引は会計のときにスタッフが入れる
 * （お客様が選んだクーポンはご予約の「ご要望」の先頭に【クーポン】として残る）。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

export type CouponUnit = 'percent' | 'yen';

export interface BookingCoupon {
  id: string;
  /** クーポンの内容（例: アラカルト／10名様以上で幹事様1名無料／ここからご予約のみのコース） */
  title: string;
  /** 割引の数（無ければ null。文字だけのクーポン） */
  value: number | null;
  unit: CouponUnit;
}

export const MAX_BOOKING_COUPONS = 5;
export const MAX_COUPON_TITLE = 40;

const ID = /^[a-z0-9]{4,24}$/;

/** 表示する文（例: 「アラカルト 5%OFF」「全品 ¥500OFF」「10名様以上で幹事様1名無料」） */
export function couponLabel(c: Pick<BookingCoupon, 'title' | 'value' | 'unit'>): string {
  const title = c.title.trim();
  if (c.value == null || !(c.value > 0)) return title;
  const off = c.unit === 'percent' ? `${c.value}%OFF` : `¥${c.value.toLocaleString('ja-JP')}OFF`;
  return title ? `${title} ${off}` : off;
}

/** 保存されている設定からクーポンを読む（壊れた行は捨てる） */
export function bookingCouponsFrom(settings: unknown): BookingCoupon[] {
  const raw = (settings as { bookingCoupons?: unknown } | null)?.bookingCoupons;
  if (!Array.isArray(raw)) return [];
  const out: BookingCoupon[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, MAX_COUPON_TITLE) : '';
    const unit: CouponUnit = o.unit === 'yen' ? 'yen' : 'percent';
    const v = typeof o.value === 'number' && Number.isInteger(o.value) ? o.value : null;
    const value = v != null && v > 0 && (unit === 'yen' ? v <= 1_000_000 : v <= 100) ? v : null;
    if (!id || (!title && value == null)) continue;
    out.push({ id, title, value, unit });
    if (out.length >= MAX_BOOKING_COUPONS) break;
  }
  return out;
}

/** 保存する前に確かめる。問題があればその文を返す */
export function bookingCouponsProblem(list: readonly BookingCoupon[]): string | null {
  if (list.length > MAX_BOOKING_COUPONS) return `クーポンは${MAX_BOOKING_COUPONS}件までです`;
  for (const c of list) {
    const title = c.title.trim();
    if (!title && c.value == null) return 'クーポンの内容を入れてください';
    if (title.length > MAX_COUPON_TITLE) return `クーポンの内容は${MAX_COUPON_TITLE}文字までです`;
    if (c.value != null) {
      if (!Number.isInteger(c.value) || c.value <= 0) return '割引は1以上の整数で入れてください';
      if (c.unit === 'percent' && c.value > 100) return '% の割引は100までです';
      if (c.unit === 'yen' && c.value > 1_000_000) return '¥ の割引が大きすぎます';
    }
  }
  return null;
}

/** お客様が選んだクーポンを、ご予約の「ご要望」の先頭に残す文にする */
export function requestWithCoupon(label: string | null, request: string | null): string | null {
  const note = (request ?? '').trim();
  if (!label) return note || null;
  const head = `【クーポン】${label}`;
  return note ? `${head}\n${note}` : head;
}
