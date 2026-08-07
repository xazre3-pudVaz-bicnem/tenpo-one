'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPaymentProvider, isPaymentTestMode } from '@/lib/payments';

export interface ActionResult {
  error?: string;
}

function assertStoreAccess(storeIds: string[], storeId: string): string | null {
  return storeIds.includes(storeId) ? null : '対象店舗にアクセス権がありません';
}

/** シミュレーション決済端末の登録（テストモードのみ） */
export async function registerSimulatedReader(storeId: string, label: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };
  if (!label.trim()) return { error: '端末名を入力してください' };
  if (!isPaymentTestMode()) {
    return { error: 'シミュレーション端末はテストモードでのみ登録できます' };
  }

  try {
    const provider = getPaymentProvider('stripe');
    const reader = await provider.registerSimulatedReader(label.trim());
    const supabase = await createClient();
    const { error } = await supabase.from('terminal_readers').insert({
      organization_id: ctx.organizationId,
      store_id: storeId,
      provider: 'stripe',
      provider_reader_id: reader.providerReaderId,
      label: reader.label,
      device_type: reader.deviceType,
      is_simulated: true,
      status: reader.status,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (error) return { error: `決済端末の登録に失敗しました: ${error.message}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '決済端末の登録に失敗しました' };
  }

  revalidatePath('/app/settings/payments');
  return {};
}

/** 決済端末の削除（DBレコードのみ。プロバイダー側の解除は不要） */
export async function deleteTerminalReader(id: string, storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const supabase = await createClient();
  const { error } = await supabase
    .from('terminal_readers')
    .delete()
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('store_id', storeId);
  if (error) return { error: `決済端末の削除に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/payments');
  return {};
}

export type BookingPaymentMode = 'onsite' | 'prepay_full' | 'deposit';

export interface BookingPaymentSettingsInput {
  storeId: string;
  bookingPaymentMode: BookingPaymentMode;
  bookingDepositAmount: number;
}

const BOOKING_PAYMENT_MODES: BookingPaymentMode[] = ['onsite', 'prepay_full', 'deposit'];

/** 予約決済設定（現地払い/全額決済/予約金）の保存 */
export async function updateBookingPaymentSettings(input: BookingPaymentSettingsInput): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), input.storeId);
  if (err) return { error: err };
  if (!BOOKING_PAYMENT_MODES.includes(input.bookingPaymentMode)) {
    return { error: '予約決済方法の指定が不正です' };
  }
  if (!Number.isInteger(input.bookingDepositAmount) || input.bookingDepositAmount < 0) {
    return { error: '予約金額の指定が正しくありません' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      booking_payment_mode: input.bookingPaymentMode,
      booking_deposit_amount: input.bookingDepositAmount,
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `予約決済設定の保存に失敗しました: ${error.message}` };

  revalidatePath('/app/settings/payments');
  return {};
}
