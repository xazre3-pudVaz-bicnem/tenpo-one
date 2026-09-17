'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limit';
import { validateUploadMeta } from '@/components/invoices/labels';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** レシートを紐付けられる出金系の kind（レジの出金・小口出金・立替） */
const RECEIPT_TX_KINDS = ['withdrawal', 'petty_out', 'petty_advance'];

function revalidateScanViews() {
  revalidatePath('/app/scan');
  revalidatePath('/app/invoices');
  revalidatePath('/app/cash');
  revalidatePath('/app/cash/close');
}

/**
 * スキャン（撮影）した書類のメタデータ登録。
 * 書類取込（app/app/invoices の createInboxDocument）と同じ手順・同じ検証で、
 * ファイル本体はクライアントから Storage へ直接アップロード済み。種別は領収書（receipt）で保存ボックスへ入れる。
 * OCR（外部AI）は呼ばない。
 */
export async function createScanDocument(input: {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storeId: string | null;
}): Promise<{ id: string }> {
  const ctx = await requirePermission('documents.write');
  if (!rateLimiter.check(`upload:${ctx.userId}`, RATE_LIMITS.upload.limit, RATE_LIMITS.upload.windowMs)) {
    throw new Error('アップロードが多すぎます。しばらく待ってから再試行してください');
  }
  const metaError = validateUploadMeta(input);
  if (metaError) throw new Error(metaError);
  if (!input.filePath.startsWith(`${ctx.organizationId}/`) || input.filePath.includes('..')) {
    throw new Error('不正なファイルパスです');
  }
  const storeId = input.storeId ?? ctx.currentStore?.id ?? null;
  if (storeId !== null && !ctx.stores.some((s) => s.id === storeId)) {
    throw new Error('対象店舗にアクセス権がありません');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('documents')
    .insert({
      organization_id: ctx.organizationId,
      store_id: storeId,
      doc_type: 'receipt',
      file_path: input.filePath,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      status: 'inbox',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? '書類の登録に失敗しました');
  revalidateScanViews();
  return { id: data.id };
}

/**
 * 出金（cash_transactions）にレシート書類を紐付ける（receipt_document_id を設定）。
 * 対象取引・書類とも自組織かつアクセス可能な店舗のものであることを確認してから更新し、監査ログを残す。
 * 権限は小口現金の登録と同じ cash.write（cash_transactions の更新RLSと同じロール範囲）。
 */
export async function attachReceiptToCashTransaction(txId: string, documentId: string) {
  const ctx = await requirePermission('cash.write');
  if (!UUID_RE.test(txId) || !UUID_RE.test(documentId)) throw new Error('不正なIDです');

  const supabase = await createClient();
  const [{ data: tx }, { data: doc }] = await Promise.all([
    supabase
      .from('cash_transactions')
      .select('id, organization_id, store_id, kind, status, receipt_document_id')
      .eq('id', txId)
      .maybeSingle(),
    supabase.from('documents').select('id, organization_id, store_id, status').eq('id', documentId).maybeSingle(),
  ]);

  if (!tx || tx.organization_id !== ctx.organizationId || !ctx.stores.some((s) => s.id === tx.store_id)) {
    throw new Error('対象の出金が見つかりません');
  }
  if (!RECEIPT_TX_KINDS.includes(tx.kind)) throw new Error('レシートを紐付けられるのは出金のみです');
  if (tx.status !== 'active') throw new Error('取消済みの出金にはレシートを紐付けられません');
  if (!doc || doc.organization_id !== ctx.organizationId || doc.status === 'deleted') {
    throw new Error('対象の書類が見つかりません');
  }
  if (doc.store_id !== null && !ctx.stores.some((s) => s.id === doc.store_id)) {
    throw new Error('対象の書類にアクセス権がありません');
  }
  if (tx.receipt_document_id === documentId) return;

  const { data: updated, error } = await supabase
    .from('cash_transactions')
    .update({ receipt_document_id: documentId, updated_by: ctx.userId })
    .eq('id', txId)
    .eq('organization_id', ctx.organizationId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) throw new Error('この出金を更新する権限がありません');

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: tx.store_id,
    p_action: 'cash_transaction.attach_receipt',
    p_target_table: 'cash_transactions',
    p_target_id: txId,
    p_before: { receipt_document_id: tx.receipt_document_id },
    p_after: { receipt_document_id: documentId },
    p_note: null,
  });
  revalidateScanViews();
}
