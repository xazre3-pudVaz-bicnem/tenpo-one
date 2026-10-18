'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { qrServiceFrom, qrServiceToJson, sanitizeQrServiceItems, type QrServiceSettings } from '@/lib/qr-service';

/**
 * お客様QRの「サービス」（お水・お箸など）の一覧の保存（店長以上）。
 * store_settings.settings.qrService に入れる（DB 変更なし。settings の他の項目は消さない）。
 */
export async function saveQrService(storeId: string, input: QrServiceSettings): Promise<{ error?: string }> {
  const ctx = await requirePermission('menu.manage');
  if (!ctx.isHq && !ctx.stores.some((s) => s.id === storeId)) return { error: 'この店舗は変更できません' };
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) return { error: `店舗設定の読み込みに失敗しました: ${readError.message}` };
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const next = qrServiceToJson({ enabled: input.enabled === true, items: sanitizeQrServiceItems(input.items) });
  const { error } = await supabase
    .from('store_settings')
    .upsert(
      {
        organization_id: ctx.organizationId,
        store_id: storeId,
        settings: { ...current, qrService: next },
        updated_by: ctx.userId,
      },
      { onConflict: 'store_id' }
    );
  if (error) return { error: `保存に失敗しました: ${error.message}` };
  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: storeId,
    p_action: 'settings.qr_service.update',
    p_target_table: 'store_settings',
    p_target_id: storeId,
    p_before: { qrService: qrServiceFrom(current) },
    p_after: { qrService: next },
    p_note: null,
  });
  revalidatePath('/app/settings/qr-service');
  return {};
}
