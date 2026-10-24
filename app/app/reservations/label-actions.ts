'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sanitizeKeywords } from '@/lib/reservation-entry';
import { reservationTagGroupsFrom, sanitizeTagGroups, type ReservationTagGroup } from '@/lib/reservation-tags';

/**
 * 店舗のキーワード・お客様／予約のタグの保存（2026-10-24 Ronnie）。
 * - キーワード：予約登録の画面からその場で足す・消す・並べ替える。予約を登録できる人（reservations.write）なら誰でも。
 *   店舗設定の表は店長以上しか書けない（RLS）ので、権限と店舗を確かめたうえでサーバーの鍵で reservation_keywords だけを書く。
 * - タグの区分：店舗の設定（store.settings）。
 * 上限（キーワード 10 個・15 文字、タグ 15 文字など）はここでも必ず確かめる（lib/reservation-entry.ts・lib/reservation-tags.ts）。
 */

function revalidateLedger() {
  revalidatePath('/app/reservations');
  revalidatePath('/app/settings/reservation-book');
}

export async function saveReservationKeywords(storeId: string, keywords: unknown): Promise<{ keywords?: string[]; error?: string }> {
  const ctx = await requirePermission('reservations.write');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: 'この店舗へのアクセス権限がありません' };
  const r = sanitizeKeywords(keywords);
  if (!r.ok) return { error: r.error };
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  if (readError) return { error: `店舗設定の読み込みに失敗しました: ${readError.message}` };
  const current = (existing?.settings as Record<string, unknown> | null) ?? {};
  const { error } = await admin.from('store_settings').upsert(
    {
      organization_id: ctx.organizationId,
      store_id: storeId,
      settings: { ...current, reservation_keywords: r.keywords },
      updated_by: ctx.userId,
    },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `キーワードを保存できませんでした: ${error.message}` };
  revalidateLedger();
  return { keywords: r.keywords };
}

/** タグの区分を保存する。groups=null で既定に戻す */
export async function saveReservationTagGroups(storeId: string, groups: unknown): Promise<{ groups?: ReservationTagGroup[]; error?: string }> {
  const ctx = await requirePermission('store.settings');
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: 'この店舗へのアクセス権限がありません' };
  let next: ReservationTagGroup[] | null = null;
  if (groups !== null) {
    const r = sanitizeTagGroups(groups);
    if (!r.ok) return { error: r.error };
    next = r.groups;
  }
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
  if (readError) return { error: `店舗設定の読み込みに失敗しました: ${readError.message}` };
  const current = { ...((existing?.settings as Record<string, unknown> | null) ?? {}) };
  if (next) current.reservation_tag_groups = next;
  else delete current.reservation_tag_groups;
  const { error } = await supabase.from('store_settings').upsert(
    { organization_id: ctx.organizationId, store_id: storeId, settings: current, updated_by: ctx.userId },
    { onConflict: 'store_id' }
  );
  if (error) return { error: `タグを保存できませんでした: ${error.message}` };
  revalidateLedger();
  return { groups: next ?? reservationTagGroupsFrom(null) };
}
