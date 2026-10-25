'use server';

import { revalidatePath } from 'next/cache';
import { requireCypressAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isMissingTableError } from '@/lib/schema-compat';
import { DISPLAY_MONITOR_FLAG } from '@/lib/display-monitor';

/**
 * ディスプレイ端末（キッチンディスプレイ・呼び出しモニター）を企業として使えるようにする／止める（運営だけ）。
 * feature_flags（organization_id, flag_key = 'display_monitor'）に enabled = true の行を入れる（OFF は行を消す）。
 * display_monitor だけは「行が無い＝OFF」（既存の機能フラグの「行が無い＝ON」とは逆。lib/display-monitor.ts）。
 * 使えるのは企業と店舗（setStoreDisplayMonitor）の両方が ON のときだけ。
 */
export async function setOrgDisplayMonitor(organizationId: string, enabled: boolean) {
  const ctx = await requireCypressAdmin();
  const admin = createAdminClient();

  const { data: org } = await admin.from('organizations').select('id').eq('id', organizationId).maybeSingle();
  if (!org) throw new Error('企業が見つかりません');

  const { data: existing } = await admin
    .from('feature_flags')
    .select('id, enabled')
    .eq('organization_id', organizationId)
    .eq('flag_key', DISPLAY_MONITOR_FLAG)
    .maybeSingle();

  if (!enabled) {
    // OFF は行を消す（display_monitor は「行が無い＝OFF」。enabled=false の行を残すと、
    // ほかの機能の「無効にした機能」の一覧（getSessionContext の disabledFeatures・運営のサポート画面）に混ざるため）
    if (existing) {
      const { error } = await admin.from('feature_flags').delete().eq('id', existing.id);
      if (error) throw new Error(error.message);
    }
  } else if (existing) {
    const { error } = await admin
      .from('feature_flags')
      .update({ enabled, updated_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from('feature_flags').insert({
      organization_id: organizationId,
      flag_key: DISPLAY_MONITOR_FLAG,
      enabled,
      note: 'ディスプレイ端末（企業）。行が無い＝OFF',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
  }

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: null,
    p_action: 'feature_flag.display_monitor_org',
    p_target_table: 'feature_flags',
    p_target_id: DISPLAY_MONITOR_FLAG,
    p_before: { enabled: existing ? existing.enabled === true : false },
    p_after: { enabled },
    p_note: null,
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
  revalidatePath('/admin/feature-flags');
}

/**
 * ディスプレイ端末を店舗として使えるようにする／止める（運営だけ）。store_feature_flags に入れる。
 * 表がまだ無い（migration 00103 未適用）ときは分かる言葉で断る。
 */
export async function setStoreDisplayMonitor(organizationId: string, storeId: string, enabled: boolean) {
  const ctx = await requireCypressAdmin();
  const admin = createAdminClient();

  const { data: store } = await admin.from('stores').select('id, organization_id').eq('id', storeId).maybeSingle();
  if (!store || store.organization_id !== organizationId) throw new Error('店舗が見つかりません');

  const { data: existing, error: readErr } = await admin
    .from('store_feature_flags')
    .select('id, enabled')
    .eq('store_id', storeId)
    .eq('flag_key', DISPLAY_MONITOR_FLAG)
    .maybeSingle();
  if (readErr) {
    if (isMissingTableError(readErr, 'store_feature_flags')) {
      throw new Error('migration 00103（ディスプレイ端末）が未適用のため、店舗ごとの ON/OFF はまだ使えません');
    }
    throw new Error(readErr.message);
  }

  const { error } = await admin.from('store_feature_flags').upsert(
    {
      organization_id: organizationId,
      store_id: storeId,
      flag_key: DISPLAY_MONITOR_FLAG,
      enabled,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id,flag_key' }
  );
  if (error) throw new Error(error.message);

  const supabase = await createClient();
  await supabase.rpc('log_audit', {
    p_org: organizationId,
    p_store: storeId,
    p_action: 'feature_flag.display_monitor_store',
    p_target_table: 'store_feature_flags',
    p_target_id: storeId,
    p_before: { enabled: existing ? existing.enabled === true : false },
    p_after: { enabled },
    p_note: null,
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
}
