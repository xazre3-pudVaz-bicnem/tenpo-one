'use server';

import { revalidatePath } from 'next/cache';
import { requireMember, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { PermissionAction } from '@/lib/permissions';
import type { DocType, InvoiceStatus, PaymentMethod } from '@/components/invoices/labels';

const PATH = '/app/invoices';

/** アップロード済みファイルの参照情報（クライアントでStorageへ先にアップロード済み） */
interface UploadedFileRef {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** 保存ボックスへファイルメタデータを登録（ファイル本体はクライアントから直接Storageへアップロード済み） */
export async function createInboxDocument(input: UploadedFileRef) {
  const ctx = await requirePermission('documents.write');
  const supabase = await createClient();
  const { error } = await supabase.from('documents').insert({
    organization_id: ctx.organizationId,
    store_id: ctx.currentStore?.id ?? null,
    doc_type: 'other',
    file_path: input.filePath,
    file_name: input.fileName,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    status: 'inbox',
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

/** 保存ボックスの書類を仕分け（種別=invoiceなら請求書も同時作成） */
export async function triageDocument(input: {
  documentId: string;
  docType: DocType;
  storeId: string | null;
  vendorId: string | null;
  vendorName: string | null;
  docDate: string | null;
  amount: number | null;
  taxAmount: number | null;
  memo: string | null;
}) {
  const ctx = await requirePermission('documents.write');
  const supabase = await createClient();

  const { data: doc, error: fetchErr } = await supabase
    .from('documents')
    .select('id, status')
    .eq('id', input.documentId)
    .single();
  if (fetchErr || !doc) throw new Error('書類が見つかりません');
  if (doc.status !== 'inbox') throw new Error('この書類はすでに仕分け済みです');

  const yearMonth = input.docDate ? input.docDate.slice(0, 7) : null;
  const { error: updErr } = await supabase
    .from('documents')
    .update({
      doc_type: input.docType,
      store_id: input.storeId,
      vendor_id: input.vendorId,
      doc_date: input.docDate,
      year_month: yearMonth,
      amount: input.amount,
      tax_amount: input.taxAmount,
      memo: input.memo,
      status: 'filed',
      updated_by: ctx.userId,
    })
    .eq('id', input.documentId);
  if (updErr) throw new Error(updErr.message);

  if (input.docType === 'invoice') {
    const vendorName = input.vendorName?.trim() || '（取引先未設定）';
    const { error: invErr } = await supabase.from('invoices').insert({
      organization_id: ctx.organizationId,
      store_id: input.storeId,
      vendor_id: input.vendorId,
      vendor_name: vendorName,
      issue_date: input.docDate,
      amount: input.amount ?? 0,
      tax_amount: input.taxAmount ?? 0,
      status: 'open',
      document_id: input.documentId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (invErr) throw new Error(invErr.message);
  }

  revalidatePath(PATH);
}

/** 請求書を登録（添付があれば書類も同時作成し紐付け） */
export async function createInvoice(input: {
  storeId: string | null;
  vendorId: string | null;
  vendorName: string;
  invoiceNo: string | null;
  issueDate: string | null;
  dueDate: string | null;
  amount: number;
  taxAmount: number;
  registrationNumber: string | null;
  paymentMethod: PaymentMethod | null;
  note: string | null;
  file: UploadedFileRef | null;
}) {
  const ctx = await requirePermission('documents.write');
  if (!input.vendorName.trim()) throw new Error('取引先を入力してください');
  const supabase = await createClient();

  let documentId: string | null = null;
  if (input.file) {
    const { data: doc, error } = await supabase
      .from('documents')
      .insert({
        organization_id: ctx.organizationId,
        store_id: input.storeId,
        doc_type: 'invoice',
        file_path: input.file.filePath,
        file_name: input.file.fileName,
        mime_type: input.file.mimeType,
        size_bytes: input.file.sizeBytes,
        doc_date: input.issueDate,
        year_month: input.issueDate ? input.issueDate.slice(0, 7) : null,
        vendor_id: input.vendorId,
        amount: input.amount,
        tax_amount: input.taxAmount,
        status: 'filed',
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('id')
      .single();
    if (error || !doc) throw new Error(error?.message ?? '書類の登録に失敗しました');
    documentId = doc.id;
  }

  const { error: invErr } = await supabase.from('invoices').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    vendor_id: input.vendorId,
    vendor_name: input.vendorName.trim(),
    invoice_no: input.invoiceNo,
    issue_date: input.issueDate,
    due_date: input.dueDate,
    amount: input.amount,
    tax_amount: input.taxAmount,
    registration_number: input.registrationNumber,
    payment_method: input.paymentMethod,
    status: 'open',
    document_id: documentId,
    note: input.note,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (invErr) throw new Error(invErr.message);

  revalidatePath(PATH);
}

type InvoiceAction = 'review' | 'approve' | 'schedule' | 'pay' | 'reject';

const TRANSITIONS: Record<
  InvoiceAction,
  { from: InvoiceStatus[]; to: InvoiceStatus; permission: PermissionAction }
> = {
  review: { from: ['open'], to: 'review', permission: 'documents.write' },
  approve: { from: ['review'], to: 'approved', permission: 'invoices.approve' },
  schedule: { from: ['approved'], to: 'scheduled', permission: 'invoices.approve' },
  pay: { from: ['scheduled', 'approved'], to: 'paid', permission: 'invoices.approve' },
  reject: { from: ['open', 'review', 'approved', 'scheduled'], to: 'rejected', permission: 'invoices.approve' },
};

/** 請求書の状態遷移（承認・差戻し・支払確定を含む）。すべて監査ログに記録する */
export async function changeInvoiceStatus(
  invoiceId: string,
  action: InvoiceAction,
  opts?: { reason?: string; paidAt?: string }
) {
  const def = TRANSITIONS[action];
  const ctx = await requirePermission(def.permission);
  if (action === 'reject' && !opts?.reason?.trim()) throw new Error('差戻し理由を入力してください');
  if (action === 'pay' && !opts?.paidAt) throw new Error('支払日を入力してください');

  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, organization_id, store_id, status, note')
    .eq('id', invoiceId)
    .single();
  if (error || !invoice) throw new Error('請求書が見つかりません');
  if (!def.from.includes(invoice.status as InvoiceStatus)) {
    throw new Error('この状態からは操作できません');
  }

  const update: Record<string, unknown> = { status: def.to, updated_by: ctx.userId };
  if (action === 'approve') {
    update.approved_by = ctx.userId;
    update.approved_at = new Date().toISOString();
  }
  if (action === 'pay') update.paid_at = opts!.paidAt;
  if (action === 'reject') {
    update.note = invoice.note ? `${invoice.note}\n[差戻し理由] ${opts!.reason}` : `[差戻し理由] ${opts!.reason}`;
  }

  const { error: updErr } = await supabase.from('invoices').update(update).eq('id', invoiceId);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: invoice.store_id,
    p_action: `invoice.${action}`,
    p_target_table: 'invoices',
    p_target_id: invoiceId,
    p_before: { status: invoice.status },
    p_after: { status: def.to },
    p_note: opts?.reason ?? null,
  });

  revalidatePath(PATH);
}

/** 書類・請求書の詳細（添付情報・コメント込み）を取得 */
export async function getInvoiceDetail(invoiceId: string) {
  await requireMember();
  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, vendors(name), stores(name), documents(id, file_name, mime_type, doc_type)')
    .eq('id', invoiceId)
    .single();
  if (error || !invoice) throw new Error('請求書が見つかりません');

  let comments: { id: string; body: string; createdAt: string; author: string }[] = [];
  const documentId = (invoice as { document_id: string | null }).document_id;
  if (documentId) {
    const { data: c } = await supabase
      .from('document_comments')
      .select('id, body, created_at, profiles(display_name)')
      .eq('document_id', documentId)
      .order('created_at');
    comments = (c ?? []).map((x) => ({
      id: x.id as string,
      body: x.body as string,
      createdAt: x.created_at as string,
      author: (x.profiles as unknown as { display_name: string } | null)?.display_name ?? '不明',
    }));
  }
  return { invoice, comments };
}

/** 添付ファイルの閲覧用署名URLを発行（1時間有効） */
export async function getDocumentSignedUrl(documentId: string) {
  await requireMember();
  const supabase = await createClient();
  const { data: doc, error } = await supabase
    .from('documents')
    .select('file_path, mime_type, file_name')
    .eq('id', documentId)
    .single();
  if (error || !doc) throw new Error('書類が見つかりません');

  const { data, error: urlErr } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 3600);
  if (urlErr || !data) throw new Error('署名URLの取得に失敗しました');
  return { url: data.signedUrl, mimeType: doc.mime_type as string, fileName: doc.file_name as string };
}

/** 書類にコメントを追加 */
export async function addDocumentComment(documentId: string, body: string) {
  const ctx = await requirePermission('documents.write');
  if (!body.trim()) throw new Error('コメントを入力してください');
  const supabase = await createClient();
  const { data: doc } = await supabase.from('documents').select('organization_id').eq('id', documentId).single();
  if (!doc) throw new Error('書類が見つかりません');

  const { error } = await supabase.from('document_comments').insert({
    organization_id: doc.organization_id,
    document_id: documentId,
    body: body.trim(),
    created_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

/** 書類の論理削除（filed済みのもの）。理由必須・監査ログ */
export async function deleteDocument(documentId: string, reason: string) {
  const ctx = await requirePermission('documents.write');
  if (!reason.trim()) throw new Error('理由を入力してください');
  const supabase = await createClient();
  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, organization_id, store_id, status')
    .eq('id', documentId)
    .single();
  if (error || !doc) throw new Error('書類が見つかりません');

  const { error: updErr } = await supabase
    .from('documents')
    .update({ status: 'deleted', updated_by: ctx.userId })
    .eq('id', documentId);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: doc.store_id,
    p_action: 'document.delete',
    p_target_table: 'documents',
    p_target_id: documentId,
    p_before: { status: doc.status },
    p_after: { status: 'deleted' },
    p_note: reason,
  });

  revalidatePath(PATH);
}
