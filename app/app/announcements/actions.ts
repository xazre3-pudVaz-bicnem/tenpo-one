'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const PATH = '/app/announcements';

export interface AnnouncementInput {
  title: string;
  body: string;
  isImportant: boolean;
  publishFrom: string | null;
  publishTo: string | null;
  storeId: string | null; // null = 全店舗（本社のみ選択可）
}

/** お知らせを作成する。本社ロールは全店舗指定可、店長は自店のみ */
export async function createAnnouncement(input: AnnouncementInput) {
  const ctx = await requirePermission('store.settings');
  if (!input.title.trim()) throw new Error('タイトルを入力してください');
  if (!input.body.trim()) throw new Error('本文を入力してください');

  const storeId = input.storeId;
  if (storeId === null) {
    if (ctx.role !== 'org_owner' && ctx.role !== 'hq_admin') {
      throw new Error('全店舗向けお知らせの作成は本社管理者のみ行えます');
    }
  } else if (!ctx.stores.some((s) => s.id === storeId)) {
    throw new Error('担当外の店舗です');
  }

  const supabase = await createClient();
  const { error } = await supabase.from('announcements').insert({
    organization_id: ctx.organizationId,
    store_id: storeId,
    title: input.title.trim(),
    body: input.body.trim(),
    is_important: input.isImportant,
    publish_from: input.publishFrom,
    publish_to: input.publishTo,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
  revalidatePath('/app/dashboard');
}

/** 削除（お知らせは論理削除カラムが無いため物理削除。本社/店長のみ） */
export async function deleteAnnouncement(announcementId: string) {
  const ctx = await requirePermission('store.settings');
  const supabase = await createClient();
  const { data: a } = await supabase.from('announcements').select('id, store_id').eq('id', announcementId).single();
  if (!a) throw new Error('お知らせが見つかりません');
  if (a.store_id === null) {
    if (ctx.role !== 'org_owner' && ctx.role !== 'hq_admin') {
      throw new Error('全店舗向けお知らせの削除は本社管理者のみ行えます');
    }
  } else if (!ctx.stores.some((s) => s.id === a.store_id)) {
    throw new Error('担当外の店舗です');
  }

  const { error } = await supabase.from('announcements').delete().eq('id', announcementId);
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
  revalidatePath('/app/dashboard');
}

/** 開封済みにする（announcement_reads へ upsert） */
export async function markAnnouncementRead(announcementId: string) {
  const ctx = await requireMember();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('announcement_reads')
    .select('id')
    .eq('announcement_id', announcementId)
    .eq('profile_id', ctx.userId)
    .maybeSingle();
  if (existing) return;
  await supabase.from('announcement_reads').insert({ announcement_id: announcementId, profile_id: ctx.userId });
  revalidatePath(PATH);
  revalidatePath('/app/dashboard');
}
