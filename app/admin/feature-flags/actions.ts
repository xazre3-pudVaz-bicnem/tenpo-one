'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export interface FeatureFlagInput {
  flagKey: string;
  organizationId: string | null;
  enabled: boolean;
  note: string;
}

export async function createFeatureFlag(input: FeatureFlagInput) {
  await requireCypressAdmin();
  const supabase = await createClient();

  const flagKey = input.flagKey.trim();
  if (!flagKey) throw new Error('フラグキーを入力してください');

  const { data: flag, error } = await supabase
    .from('feature_flags')
    .insert({
      flag_key: flagKey,
      organization_id: input.organizationId,
      enabled: input.enabled,
      note: input.note.trim() || null,
    })
    .select('id')
    .single();
  if (error || !flag) throw new Error(error?.message ?? 'フラグの作成に失敗しました');

  await supabase.rpc('log_audit', {
    p_org: input.organizationId,
    p_store: null,
    p_action: 'feature_flag.create',
    p_target_table: 'feature_flags',
    p_target_id: flag.id,
    p_before: null,
    p_after: { flag_key: flagKey, enabled: input.enabled, organization_id: input.organizationId },
    p_note: input.note.trim() || null,
  });

  revalidatePath('/admin/feature-flags');
}

export async function toggleFeatureFlag(id: string, organizationId: string | null, enabled: boolean) {
  await requireCypressAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from('feature_flags').update({ enabled }).eq('id', id);
  if (error) throw new Error(error.message);

  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: null,
    p_action: 'feature_flag.toggle',
    p_target_table: 'feature_flags',
    p_target_id: id,
    p_before: { enabled: !enabled },
    p_after: { enabled },
    p_note: null,
  });

  revalidatePath('/admin/feature-flags');
}
