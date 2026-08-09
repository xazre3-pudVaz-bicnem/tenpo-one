'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limit';
import { validateUploadMeta } from '@/components/invoices/labels';
import type { ManualCategory } from './labels';

const PATH = '/app/manuals';

export interface ManualInput {
  title: string;
  category: ManualCategory;
  storeId: string | null; // null = 全店共通（本社のみ）
  filePath: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  url: string | null;
  note: string | null;
}

export async function createManual(input: ManualInput) {
  const ctx = await requirePermission('store.settings');
  if (!input.title.trim()) throw new Error('タイトルを入力してください');
  if (!input.filePath && !input.url?.trim()) throw new Error('ファイルまたはURLを指定してください');

  if (input.filePath) {
    if (!rateLimiter.check(`upload:${ctx.userId}`, RATE_LIMITS.upload.limit, RATE_LIMITS.upload.windowMs)) {
      throw new Error('アップロードが多すぎます。しばらく待ってから再試行してください');
    }
    const metaError = validateUploadMeta({
      fileName: input.fileName ?? '',
      mimeType: input.mimeType ?? '',
      sizeBytes: input.sizeBytes ?? 0,
    });
    if (metaError) throw new Error(metaError);
    if (!input.filePath.startsWith(`${ctx.organizationId}/`)) {
      throw new Error('不正なファイルパスです');
    }
  }

  if (input.storeId === null) {
    if (ctx.role !== 'org_owner' && ctx.role !== 'hq_admin') {
      throw new Error('全店共通マニュアルの登録は本社管理者のみ行えます');
    }
  } else if (!ctx.stores.some((s) => s.id === input.storeId)) {
    throw new Error('担当外の店舗です');
  }

  const supabase = await createClient();
  const { error } = await supabase.from('manuals').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    title: input.title.trim(),
    category: input.category,
    file_path: input.filePath,
    url: input.url?.trim() || null,
    note: input.note,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

/** 論理削除 */
export async function deleteManual(manualId: string) {
  const ctx = await requirePermission('store.settings');
  const supabase = await createClient();
  const { data: manual } = await supabase.from('manuals').select('id, store_id').eq('id', manualId).single();
  if (!manual) throw new Error('マニュアルが見つかりません');
  if (manual.store_id !== null && !ctx.stores.some((s) => s.id === manual.store_id)) throw new Error('担当外の店舗です');

  const { error } = await supabase.from('manuals').update({ status: 'deleted', updated_by: ctx.userId }).eq('id', manualId);
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

/** 添付ファイルの署名URLを発行（1時間有効） */
export async function getManualSignedUrl(manualId: string) {
  await requireMember();
  const supabase = await createClient();
  const { data: manual, error } = await supabase.from('manuals').select('file_path').eq('id', manualId).single();
  if (error || !manual?.file_path) throw new Error('ファイルが見つかりません');
  const { data, error: urlErr } = await supabase.storage.from('documents').createSignedUrl(manual.file_path, 3600);
  if (urlErr || !data) throw new Error('署名URLの取得に失敗しました');
  return data.signedUrl;
}
