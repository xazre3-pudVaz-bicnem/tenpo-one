'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPaymentProvider, isPaymentTestMode } from '@/lib/payments';
import {
  checkoutPresetsFrom,
  checkoutPresetsToJson,
  normalizePresetName,
  PRESET_KEY_RE,
  PRESET_MAX,
  type CheckoutPresets,
} from '@/lib/checkout-presets';

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

    await supabase.rpc('log_audit', {
      p_org: ctx.organizationId,
      p_store: storeId,
      p_action: 'settings.payments.reader_add',
      p_target_table: 'terminal_readers',
      p_target_id: storeId,
      p_before: null,
      p_after: { label: reader.label, is_simulated: true },
      p_note: null,
    });
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

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.payments.reader_delete',
    p_target_table: 'terminal_readers',
    p_target_id: id,
    p_before: null,
    p_after: null,
    p_note: null,
  });

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

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'settings.payments.booking_update',
    p_target_table: 'store_settings',
    p_target_id: input.storeId,
    p_before: null,
    p_after: { booking_payment_mode: input.bookingPaymentMode, booking_deposit_amount: input.bookingDepositAmount },
    p_note: null,
  });

  revalidatePath('/app/settings/payments');
  return {};
}

/**
 * 会計画面の「値引き」と「ポイント」の選択肢（店舗ごと）。
 * 店舗要望（2026-09-24）：グルメサイトのクーポン（幹事様無料など）とポイント（ホットペッパー・
 * ぐるなび・食べログなど）をレジで選べるようにする。設定は iPad からも変えられる。
 */
export async function saveCheckoutPresets(storeId: string, input: CheckoutPresets): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  const err = assertStoreAccess(ctx.stores.map((s) => s.id), storeId);
  if (err) return { error: err };

  const discounts = Array.isArray(input?.discounts) ? input.discounts : null;
  const brands = Array.isArray(input?.pointBrands) ? input.pointBrands : null;
  if (!discounts || !brands) return { error: '選択肢の指定が正しくありません' };
  if (discounts.length > PRESET_MAX || brands.length > PRESET_MAX) {
    return { error: `選択肢は ${PRESET_MAX} 個までです` };
  }
  for (const list of [discounts, brands]) {
    for (const item of list) {
      if (!PRESET_KEY_RE.test(item?.key ?? '')) return { error: '選択肢の記号が正しくありません' };
      if (!normalizePresetName(item?.name)) return { error: '選択肢の名前を入れてください' };
    }
  }

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) return { error: `店舗設定の読み込みに失敗しました: ${readError.message}` };

  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  // 保存する形は checkoutPresetsFrom に通して揃える（壊れた値をそのまま書かない）
  const presets = checkoutPresetsFrom({ checkout: checkoutPresetsToJson(input) });
  const nextSettings = { ...current, checkout: checkoutPresetsToJson(presets) };
  const { error } = await supabase
    .from('store_settings')
    .upsert(
      { organization_id: ctx.organizationId, store_id: storeId, settings: nextSettings, updated_by: ctx.userId },
      { onConflict: 'store_id' }
    );
  if (error) return { error: `選択肢の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.payments.presets_update',
    p_target_table: 'store_settings',
    p_target_id: storeId,
    p_before: null,
    p_after: { discounts: presets.discounts.length, pointBrands: presets.pointBrands.length },
    p_note: null,
  });

  revalidatePath('/app/settings/payments');
  revalidatePath('/app/pos');
  return {};
}
