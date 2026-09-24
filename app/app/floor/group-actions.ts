'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { setTableGroup, tableGroupsFrom } from '@/lib/table-group';

/**
 * テーブルグループを保存する（2026-09-25 店舗要望）。
 * 大人数のお客様を2卓・3卓に分けるとき、その卓を1組としてまとめる。
 * データベースの列は増やさず store_settings.settings.tableGroups に持つ。
 *
 * tableIds が1つ以下ならグループを解除する。
 */
export async function saveTableGroup(tableIds: string[]): Promise<{ error?: string }> {
  const ctx = await requirePermission('tables.operate');
  const store = ctx.currentStore ?? ctx.stores[0];
  if (!store) return { error: '店舗が選ばれていません' };

  const ids = [...new Set((tableIds ?? []).filter((v) => typeof v === 'string' && v))];
  if (ids.length > 12) return { error: 'まとめられるのは12卓までです' };

  const supabase = await createClient();

  // 他店の卓・削除済みの卓は入れない
  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from('restaurant_tables')
      .select('id')
      .eq('store_id', store.id)
      .eq('status', 'active')
      .in('id', ids);
    if ((rows ?? []).length !== ids.length) return { error: 'この店舗にないテーブルが含まれています' };
  }

  const { data: existing } = await supabase
    .from('store_settings')
    .select('settings')
    .eq('store_id', store.id)
    .maybeSingle();
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const next = setTableGroup(tableGroupsFrom(current), ids, randomUUID());

  const { error } = await supabase.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: store.id,
      settings: { ...current, tableGroups: next },
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `テーブルグループの保存に失敗しました: ${error.message}` };

  revalidatePath('/app/floor');
  return {};
}
