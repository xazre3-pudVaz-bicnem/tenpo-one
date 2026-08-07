'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

export interface CouponInput {
  id?: string;
  code: string;
  name: string;
  kind: 'fixed' | 'percent';
  value: number;
  storeId: string | null;
  targetCategoryId: string | null;
  targetMenuItemId: string | null;
  minTotal: number;
  startsAt: string | null;
  endsAt: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  maxUses: number | null;
  perCustomerLimit: number | null;
  firstVisitOnly: boolean;
  stackable: boolean;
}

/** ランダムな英数字コード（重複回避のため呼び出し側で一意性エラー時に再試行させる） */
export async function generateCouponCode(): Promise<string> {
  await requirePermission('menu.manage');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** クーポンの作成・更新 */
export async function saveCoupon(input: CouponInput): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');

  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) return { error: 'コードを入力してください' };
  if (!/^[A-Z0-9-]+$/.test(code)) return { error: 'コードは英数字とハイフンのみ使用できます' };
  if (!name) return { error: '名称を入力してください' };
  if (!Number.isFinite(input.value) || input.value <= 0) return { error: '値引き額・割引率を入力してください' };
  if (input.kind === 'percent' && input.value > 100) return { error: '割引率は100%以下で入力してください' };
  if (input.targetCategoryId && input.targetMenuItemId) {
    return { error: '対象カテゴリと対象商品はどちらか一方のみ指定してください' };
  }

  const supabase = await createClient();
  const payload = {
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    code,
    name,
    kind: input.kind,
    value: input.value,
    target_category_id: input.targetCategoryId,
    target_menu_item_id: input.targetMenuItemId,
    min_total: input.minTotal || 0,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    time_from: input.timeFrom,
    time_to: input.timeTo,
    max_uses: input.maxUses,
    per_customer_limit: input.perCustomerLimit,
    first_visit_only: input.firstVisitOnly,
    stackable: input.stackable,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await supabase.from('coupons').update(payload).eq('id', input.id).eq('organization_id', ctx.organizationId);
    if (error) {
      if (error.code === '23505') return { error: 'このコードは既に使用されています' };
      return { error: `クーポンの更新に失敗しました: ${error.message}` };
    }
  } else {
    const { error } = await supabase.from('coupons').insert({ ...payload, status: 'active', created_by: ctx.userId });
    if (error) {
      if (error.code === '23505') return { error: 'このコードは既に使用されています' };
      return { error: `クーポンの作成に失敗しました: ${error.message}` };
    }
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: input.id ? 'coupon.update' : 'coupon.create',
    p_target_table: 'coupons',
    p_target_id: input.id ?? code,
    p_before: null,
    p_after: { code, name, kind: input.kind, value: input.value },
    p_note: null,
  });

  revalidatePath('/app/coupons');
  return {};
}

/** クーポンの状態変更（停止/再開/削除） */
export async function setCouponStatus(id: string, status: 'active' | 'paused' | 'deleted'): Promise<ActionResult> {
  const ctx = await requirePermission('menu.manage');
  const supabase = await createClient();
  const { error } = await supabase
    .from('coupons')
    .update({ status, updated_by: ctx.userId })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: error.message };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'coupon.status_change',
    p_target_table: 'coupons',
    p_target_id: id,
    p_before: null,
    p_after: { status },
    p_note: null,
  });

  revalidatePath('/app/coupons');
  return {};
}

export interface CouponRedemptionRow {
  id: string;
  createdAt: string;
  orderId: string;
  customerName: string | null;
  discountAmount: number;
}

/** クーポンの利用履歴（展開表示用） */
export async function getCouponRedemptions(couponId: string): Promise<CouponRedemptionRow[]> {
  const ctx = await requirePermission('menu.manage');
  const supabase = await createClient();
  const { data } = await supabase
    .from('coupon_redemptions')
    .select('id, created_at, order_id, discount_amount, customers(name)')
    .eq('coupon_id', couponId)
    .eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: false })
    .limit(200);

  return ((data ?? []) as unknown as { id: string; created_at: string; order_id: string; discount_amount: number; customers: { name: string } | null }[]).map(
    (r) => ({
      id: r.id,
      createdAt: r.created_at,
      orderId: r.order_id,
      customerName: r.customers?.name ?? null,
      discountAmount: r.discount_amount,
    })
  );
}
