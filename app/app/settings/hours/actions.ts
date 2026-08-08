'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

export interface BusinessHourInput {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  lastEntryTime: string | null;
}

function normalizeTime(v: string | null): string | null {
  if (!v) return null;
  return /^\d{2}:\d{2}$/.test(v) ? v : null;
}

/** 曜日別営業時間の一括保存 */
export async function saveBusinessHours(storeId: string, hours: BusinessHourInput[]): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) {
    return { error: '対象店舗にアクセス権がありません' };
  }
  if (hours.length !== 7 || hours.some((h) => h.dayOfWeek < 0 || h.dayOfWeek > 6)) {
    return { error: '営業時間データが不正です' };
  }
  // 営業日に開店/閉店が空のまま保存されると予約枠が生成されなくなるため必須とする
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  for (const h of hours) {
    if (h.isClosed) continue;
    if (!normalizeTime(h.openTime) || !normalizeTime(h.closeTime)) {
      return { error: `${dayNames[h.dayOfWeek]}曜日の開店・閉店時刻を入力してください（休業の場合は定休日に設定）` };
    }
  }

  const supabase = await createClient();
  const rows = hours.map((h) => ({
    organization_id: ctx.organizationId,
    store_id: storeId,
    day_of_week: h.dayOfWeek,
    is_closed: h.isClosed,
    open_time: h.isClosed ? null : normalizeTime(h.openTime),
    close_time: h.isClosed ? null : normalizeTime(h.closeTime),
    last_entry_time: h.isClosed ? null : normalizeTime(h.lastEntryTime),
    updated_by: ctx.userId,
  }));

  const { error } = await supabase.from('business_hours').upsert(rows, { onConflict: 'store_id,day_of_week' });
  if (error) return { error: `営業時間の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.hours.update',
    p_target_table: 'business_hours',
    p_target_id: storeId,
    p_before: null,
    p_after: { hours },
    p_note: null,
  });

  revalidatePath('/app/settings/hours');
  return {};
}

/** 休業日の追加 */
export async function addHoliday(input: {
  storeId: string;
  holidayDate: string;
  name: string;
  isTemporary: boolean;
}): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === input.storeId)) {
    return { error: '対象店舗にアクセス権がありません' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.holidayDate)) {
    return { error: '日付を選択してください' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('holidays').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    holiday_date: input.holidayDate,
    name: input.name.trim() || null,
    is_temporary: input.isTemporary,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) {
    if (error.code === '23505') return { error: 'その日付は既に休業日として登録されています' };
    return { error: `休業日の登録に失敗しました: ${error.message}` };
  }

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: input.storeId,
    p_action: 'settings.hours.holiday_add',
    p_target_table: 'holidays',
    p_target_id: input.storeId,
    p_before: null,
    p_after: { holiday_date: input.holidayDate, name: input.name.trim() || null, is_temporary: input.isTemporary },
    p_note: null,
  });

  revalidatePath('/app/settings/hours');
  return {};
}

/** 休業日の削除 */
export async function deleteHoliday(holidayId: string, storeId: string): Promise<ActionResult> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) {
    return { error: '対象店舗にアクセス権がありません' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('holidays')
    .delete()
    .eq('id', holidayId)
    .eq('organization_id', ctx.organizationId);
  if (error) return { error: `休業日の削除に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.hours.holiday_delete',
    p_target_table: 'holidays',
    p_target_id: holidayId,
    p_before: null,
    p_after: null,
    p_note: null,
  });

  revalidatePath('/app/settings/hours');
  return {};
}
