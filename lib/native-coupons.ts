import { isUuid } from '@/lib/native-pos';
import type { CouponInput } from '@/app/app/coupons/actions';

/**
 * iPad アプリのネイティブの「クーポン管理」（Web の /app/coupons と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=coupons|couponUses、操作は POST { type: 'couponSave' | 'couponStatus' | 'couponCode', … }。
 * 中身は Web と同じ Server Action（app/app/coupons/actions.ts）を呼ぶだけ。どれも menu.manage。
 */

export type NativeCouponAction =
  | { type: 'couponSave'; input: CouponInput }
  | { type: 'couponStatus'; id: string; status: 'active' | 'paused' | 'deleted' }
  | { type: 'couponCode' };

export function isNativeCouponActionType(v: unknown): v is NativeCouponAction['type'] {
  return v === 'couponSave' || v === 'couponStatus' || v === 'couponCode';
}

const MAX = 1_000_000_000;
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
const isHm = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const optInt = (v: unknown): number | null | undefined => {
  if (v == null || v === '') return null;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX ? v : undefined;
};

export function parseNativeCouponAction(raw: unknown): { ok: true; action: NativeCouponAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if (b.type === 'couponCode') return { ok: true, action: { type: 'couponCode' } };
  if (b.type === 'couponStatus') {
    if (!isUuid(b.id)) return { ok: false, error: 'クーポンが見つかりません' };
    if (b.status !== 'active' && b.status !== 'paused' && b.status !== 'deleted') return { ok: false, error: '内容が正しくありません' };
    return { ok: true, action: { type: 'couponStatus', id: b.id as string, status: b.status } };
  }
  if (b.type !== 'couponSave') return { ok: false, error: '内容が正しくありません' };
  if (b.id != null && !isUuid(b.id)) return { ok: false, error: 'クーポンが見つかりません' };
  for (const k of ['storeId', 'targetCategoryId', 'targetMenuItemId'] as const) {
    if (b[k] != null && !isUuid(b[k])) return { ok: false, error: '内容が正しくありません' };
  }
  if (b.kind !== 'fixed' && b.kind !== 'percent') return { ok: false, error: '種別が正しくありません' };
  if (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value > MAX) return { ok: false, error: '値引き額・割引率を入力してください' };
  if (b.minTotal != null && (typeof b.minTotal !== 'number' || !Number.isFinite(b.minTotal) || b.minTotal < 0 || b.minTotal > MAX)) {
    return { ok: false, error: '最低利用額を正しく入力してください' };
  }
  for (const k of ['startsAt', 'endsAt'] as const) if (b[k] != null && !isIso(b[k])) return { ok: false, error: '日時が正しくありません' };
  for (const k of ['timeFrom', 'timeTo'] as const) if (b[k] != null && !isHm(b[k])) return { ok: false, error: '時間帯が正しくありません' };
  const maxUses = optInt(b.maxUses);
  const perCustomerLimit = optInt(b.perCustomerLimit);
  if (maxUses === undefined || perCustomerLimit === undefined) return { ok: false, error: '利用上限を正しく入力してください' };
  return {
    ok: true,
    action: {
      type: 'couponSave',
      input: {
        id: (b.id as string | null | undefined) ?? undefined,
        code: typeof b.code === 'string' ? b.code.slice(0, 40) : '',
        name: typeof b.name === 'string' ? b.name.slice(0, 120) : '',
        kind: b.kind,
        value: b.value,
        storeId: (b.storeId as string | null | undefined) ?? null,
        targetCategoryId: (b.targetCategoryId as string | null | undefined) ?? null,
        targetMenuItemId: (b.targetMenuItemId as string | null | undefined) ?? null,
        minTotal: (b.minTotal as number | null | undefined) ?? 0,
        startsAt: (b.startsAt as string | null | undefined) ?? null,
        endsAt: (b.endsAt as string | null | undefined) ?? null,
        timeFrom: (b.timeFrom as string | null | undefined) ?? null,
        timeTo: (b.timeTo as string | null | undefined) ?? null,
        maxUses,
        perCustomerLimit,
        firstVisitOnly: b.firstVisitOnly === true,
        stackable: b.stackable === true,
      },
    },
  };
}
