'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

const ROUNDING_VALUES = ['floor', 'ceil', 'round'] as const;
type Rounding = (typeof ROUNDING_VALUES)[number];

export async function updateStoreInfo(input: {
  storeId: string;
  name: string;
  nameKana: string;
  postalCode: string;
  address: string;
  phone: string;
  email: string;
  description: string;
  seatCount: number | null;
  bookingEnabled: boolean;
  receiptHeader: string;
  receiptFooter: string;
  invoiceRegistrationNumber: string;
  serviceChargeRate: number;
  rounding: string;
}): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');

  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    return { error: '対象店舗にアクセス権がありません' };
  }
  const name = input.name.trim();
  if (!name) return { error: '店舗名は必須です' };
  if (!(ROUNDING_VALUES as readonly string[]).includes(input.rounding)) {
    return { error: '端数処理の指定が不正です' };
  }
  if (input.serviceChargeRate < 0 || input.serviceChargeRate > 100) {
    return { error: 'サービス料率は0〜100の範囲で入力してください' };
  }

  const supabase = await createClient();

  const { error: storeErr } = await supabase
    .from('stores')
    .update({
      name,
      name_kana: input.nameKana.trim() || null,
      postal_code: input.postalCode.trim() || null,
      address: input.address.trim() || null,
      phone: input.phone.trim() || null,
      email: input.email.trim() || null,
      description: input.description.trim() || null,
      seat_count: input.seatCount,
      booking_enabled: input.bookingEnabled,
      updated_by: ctx.userId,
    })
    .eq('id', input.storeId)
    .eq('organization_id', ctx.organizationId);
  if (storeErr) return { error: `店舗情報の更新に失敗しました: ${storeErr.message}` };

  const { error: settingsErr } = await supabase
    .from('store_settings')
    .upsert(
      {
        organization_id: ctx.organizationId,
        store_id: input.storeId,
        receipt_header: input.receiptHeader.trim() || null,
        receipt_footer: input.receiptFooter.trim() || null,
        invoice_registration_number: input.invoiceRegistrationNumber.trim() || null,
        service_charge_rate: input.serviceChargeRate,
        rounding: input.rounding as Rounding,
        updated_by: ctx.userId,
      },
      { onConflict: 'store_id' }
    );
  if (settingsErr) return { error: `店舗設定の更新に失敗しました: ${settingsErr.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'settings.store.update',
    p_target_table: 'stores',
    p_target_id: input.storeId,
    p_before: null,
    p_after: { name, seat_count: input.seatCount, booking_enabled: input.bookingEnabled, service_charge_rate: input.serviceChargeRate, rounding: input.rounding },
    p_note: null,
  });

  revalidatePath('/app/settings/store');
  return {};
}
