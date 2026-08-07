'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
}

export interface LoyaltySettingsInput {
  enabled: boolean;
  yenPerPoint: number;
  pointValue: number;
  /** 空文字は「無期限」（null） */
  expiryMonths: number | null;
}

/**
 * ポイント設定の保存（organization_id につき1行・upsert）。
 * finalize_order / refund_order（migration 00015）がこの設定を参照して自動付与・自動取消を行う。
 */
export async function saveLoyaltySettings(input: LoyaltySettingsInput): Promise<ActionResult> {
  const ctx = await requirePermission('org.settings');

  if (input.yenPerPoint <= 0) return { error: '円/pt は1以上で入力してください' };
  if (input.pointValue <= 0) return { error: 'pt単価は1以上で入力してください' };
  if (input.expiryMonths != null && input.expiryMonths <= 0) {
    return { error: '失効月数は1以上で入力してください（無期限の場合は空欄）' };
  }

  const supabase = await createClient();
  const { data: before } = await supabase
    .from('loyalty_settings')
    .select('enabled, yen_per_point, point_value, expiry_months')
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  const { error } = await supabase.from('loyalty_settings').upsert(
    {
      organization_id: ctx.organizationId,
      enabled: input.enabled,
      yen_per_point: input.yenPerPoint,
      point_value: input.pointValue,
      expiry_months: input.expiryMonths,
      updated_by: ctx.userId,
      created_by: ctx.userId,
    },
    { onConflict: 'organization_id' }
  );
  if (error) return { error: `ポイント設定の保存に失敗しました: ${error.message}` };

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: null,
    p_action: 'settings.loyalty.update',
    p_target_table: 'loyalty_settings',
    p_target_id: ctx.organizationId,
    p_before: before ?? null,
    p_after: {
      enabled: input.enabled,
      yen_per_point: input.yenPerPoint,
      point_value: input.pointValue,
      expiry_months: input.expiryMonths,
    },
    p_note: null,
  });

  revalidatePath('/app/settings/loyalty');
  return {};
}
