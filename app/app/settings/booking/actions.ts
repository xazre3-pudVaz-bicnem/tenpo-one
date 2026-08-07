'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

const SLOT_MINUTES_VALUES = [15, 30, 60];

export async function updateBookingSettings(input: {
  storeId: string;
  slotMinutes: number;
  defaultStayMinutes: number;
  bookingCutoffMinutes: number;
  bookingWindowDays: number;
  maxPartySize: number;
  cancelDeadlineHours: number;
}): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    return { error: '対象店舗にアクセス権がありません' };
  }
  if (!SLOT_MINUTES_VALUES.includes(input.slotMinutes)) {
    return { error: '予約枠間隔の指定が不正です' };
  }
  if (input.defaultStayMinutes <= 0 || input.bookingCutoffMinutes < 0 || input.bookingWindowDays <= 0) {
    return { error: '数値の指定が正しくありません' };
  }
  if (input.maxPartySize <= 0 || input.cancelDeadlineHours < 0) {
    return { error: '数値の指定が正しくありません' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      slot_minutes: input.slotMinutes,
      default_stay_minutes: input.defaultStayMinutes,
      booking_cutoff_minutes: input.bookingCutoffMinutes,
      booking_window_days: input.bookingWindowDays,
      max_party_size: input.maxPartySize,
      cancel_deadline_hours: input.cancelDeadlineHours,
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `予約設定の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'settings.booking.update',
    p_target_table: 'store_settings',
    p_target_id: input.storeId,
    p_before: null,
    p_after: {
      slot_minutes: input.slotMinutes,
      default_stay_minutes: input.defaultStayMinutes,
      max_party_size: input.maxPartySize,
      cancel_deadline_hours: input.cancelDeadlineHours,
    },
    p_note: null,
  });

  revalidatePath('/app/settings/booking');
  return {};
}
