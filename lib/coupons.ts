/**
 * クーポン検証（純関数・テスト対象）。
 * サーバー（POS action / QR）でこの検証を通してから orders.coupon_id を設定する。
 * 適用の確定記録は finalize_order 内の coupon_redemptions（UNIQUE）が担保する。
 */

export interface CouponLike {
  id: string;
  kind: 'fixed' | 'percent';
  value: number;
  minTotal: number;
  startsAt: Date | null;
  endsAt: Date | null;
  timeFrom: string | null; // 'HH:MM'
  timeTo: string | null;
  maxUses: number | null;
  perCustomerLimit: number | null;
  firstVisitOnly: boolean;
  storeId: string | null;
  status: string;
}

export interface CouponContext {
  now: Date;
  jstTime: string; // 'HH:MM'
  orderTotal: number; // 適用前の税込合計
  storeId: string;
  customerVisitCount: number | null; // 顧客未紐付けは null
  totalRedemptions: number;
  customerRedemptions: number;
}

export type CouponRejectReason =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'time_window'
  | 'wrong_store'
  | 'min_total'
  | 'max_uses'
  | 'per_customer_limit'
  | 'first_visit_only'
  | 'requires_customer';

export const COUPON_REJECT_LABELS: Record<CouponRejectReason, string> = {
  inactive: 'このクーポンは現在利用できません',
  not_started: 'このクーポンはまだ利用開始前です',
  expired: 'このクーポンは有効期限が切れています',
  time_window: 'このクーポンは対象時間帯ではありません',
  wrong_store: 'この店舗では利用できないクーポンです',
  min_total: '最低利用金額に達していません',
  max_uses: 'このクーポンは利用上限に達しました',
  per_customer_limit: 'このお客様の利用上限に達しています',
  first_visit_only: '初回来店のお客様限定のクーポンです',
  requires_customer: '顧客を選択すると利用できるクーポンです',
};

export interface CouponValidation {
  valid: boolean;
  reason?: CouponRejectReason;
  /** 適用値引き額（円・合計を超えない） */
  discount: number;
}

export function validateCoupon(coupon: CouponLike, ctx: CouponContext): CouponValidation {
  const reject = (reason: CouponRejectReason): CouponValidation => ({ valid: false, reason, discount: 0 });

  if (coupon.status !== 'active') return reject('inactive');
  if (coupon.startsAt && ctx.now < coupon.startsAt) return reject('not_started');
  if (coupon.endsAt && ctx.now > coupon.endsAt) return reject('expired');
  if (coupon.storeId && coupon.storeId !== ctx.storeId) return reject('wrong_store');
  if (coupon.timeFrom && coupon.timeTo) {
    const t = ctx.jstTime;
    const inWindow =
      coupon.timeFrom <= coupon.timeTo
        ? t >= coupon.timeFrom && t <= coupon.timeTo
        : t >= coupon.timeFrom || t <= coupon.timeTo; // 深夜跨ぎ
    if (!inWindow) return reject('time_window');
  }
  if (ctx.orderTotal < coupon.minTotal) return reject('min_total');
  if (coupon.maxUses != null && ctx.totalRedemptions >= coupon.maxUses) return reject('max_uses');
  if (coupon.perCustomerLimit != null) {
    if (ctx.customerVisitCount == null) return reject('requires_customer');
    if (ctx.customerRedemptions >= coupon.perCustomerLimit) return reject('per_customer_limit');
  }
  if (coupon.firstVisitOnly) {
    if (ctx.customerVisitCount == null) return reject('requires_customer');
    if (ctx.customerVisitCount > 0) return reject('first_visit_only');
  }

  const discount =
    coupon.kind === 'fixed'
      ? Math.min(coupon.value, ctx.orderTotal)
      : Math.min(Math.floor((ctx.orderTotal * coupon.value) / 100), ctx.orderTotal);
  return { valid: true, discount };
}
