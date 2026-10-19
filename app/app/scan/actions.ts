'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limit';
import { validateUploadMeta } from '@/components/invoices/labels';
import { can } from '@/lib/permissions';
import {
  BILL_CATEGORY_LABELS,
  MATCH_WINDOW_DAYS,
  matchWithdrawal,
  type BillCategory,
  type ScanKind,
  type ScanReading,
} from '@/lib/receipt-read';

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

// ---------------------------------------------------------------------------
// ScanSnap などでまとめてスキャンした書類の自動仕分け（2026-10-20 Ronnie）
//   レシート → 金額・日付が合う出金に自動で紐付け（レジクローズの「出金レシート」が OK になる）
//   請求書   → 月払い：仕入先の請求書（invoices・月次清算の仕入先の列）／家賃・電気・水道・ガス（月次清算で本部が反映）
//   読めない・合わない → 保存ボックスに「要確認」で残す（金額・日付は入れておく）
// 文字の読み取りは端末のブラウザの中（components/scan/scan-bulk-import.tsx）。ここは読み取った結果で仕分けるだけ。
// ---------------------------------------------------------------------------

export type AutoFileResult =
  | { result: 'attached'; label: string }
  | { result: 'vendor_bill'; label: string }
  | { result: 'fixed_bill'; label: string }
  | { result: 'review'; label: string };

const AUTO_MATCH_KINDS = ['withdrawal', 'petty_out'];
const SCAN_KINDS: ScanKind[] = ['receipt', 'bill'];
const BILL_CATEGORIES: BillCategory[] = ['rent', 'electric', 'water', 'gas', 'vendor'];

function cleanReading(r: ScanReading): ScanReading {
  const amount = typeof r.amount === 'number' && Number.isInteger(r.amount) && r.amount > 0 && r.amount <= 10_000_000 ? r.amount : null;
  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  const kind = SCAN_KINDS.includes(r.kind) ? r.kind : 'receipt';
  const category = kind === 'bill' && r.category && BILL_CATEGORIES.includes(r.category) ? r.category : kind === 'bill' ? 'vendor' : null;
  const vendorName = typeof r.vendorName === 'string' && r.vendorName.trim() ? r.vendorName.trim().slice(0, 40) : null;
  return { kind, category, amount, date, vendorName };
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const yenLabel = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const mdLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export async function autoFileScan(documentId: string, raw: ScanReading): Promise<AutoFileResult> {
  const ctx = await requirePermission('documents.write');
  if (!UUID_RE.test(documentId)) throw new Error('不正なIDです');
  const reading = cleanReading(raw);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from('documents')
    .select('id, organization_id, store_id, status')
    .eq('id', documentId)
    .maybeSingle();
  if (!doc || doc.organization_id !== ctx.organizationId || doc.status === 'deleted') throw new Error('対象の書類が見つかりません');
  if (doc.store_id !== null && !ctx.stores.some((s) => s.id === doc.store_id)) throw new Error('対象の書類にアクセス権がありません');
  if (doc.status !== 'inbox') return { result: 'review', label: 'すでに仕分け済みです' };

  const base = {
    amount: reading.amount,
    doc_date: reading.date,
    year_month: reading.date ? reading.date.slice(0, 7) : null,
    ocr_status: 'done',
    ocr_payload: { source: 'scan_auto', ...reading },
    updated_by: ctx.userId,
  };
  const { error: saveErr } = await supabase.from('documents').update(base).eq('id', documentId);
  if (saveErr) throw new Error(saveErr.message);

  // ---- レシート → 出金に紐付け ----
  if (reading.kind === 'receipt') {
    if (reading.amount == null) return { result: 'review', label: '金額が読めませんでした' };
    if (!doc.store_id || !can(ctx.role, 'cash.write')) return { result: 'review', label: `${yenLabel(reading.amount)}・出金に紐付ける権限がありません` };
    const center = reading.date ?? today;
    const { data: txs } = await supabase
      .from('cash_transactions')
      .select('id, kind, amount, business_date, purpose')
      .eq('store_id', doc.store_id)
      .in('kind', AUTO_MATCH_KINDS)
      .eq('status', 'active')
      .is('receipt_document_id', null)
      .eq('amount', reading.amount)
      .gte('business_date', shiftDate(center, reading.date ? -MATCH_WINDOW_DAYS : -7))
      .lte('business_date', shiftDate(center, reading.date ? MATCH_WINDOW_DAYS : 0))
      .limit(20);
    const rows = (txs ?? []) as { id: string; kind: string; amount: number; business_date: string; purpose: string | null }[];
    const hit = matchWithdrawal(
      reading,
      rows.map((t) => ({ id: t.id, amount: t.amount, businessDate: t.business_date })),
      today
    );
    if (!hit) {
      const why = rows.length > 1 ? '同じ金額の出金が2件以上あります' : '金額・日付の合う出金がありません';
      return { result: 'review', label: `${yenLabel(reading.amount)}・${why}` };
    }
    await attachReceiptToCashTransaction(hit.id, documentId);
    await supabase.from('documents').update({ doc_type: 'receipt', status: 'filed', updated_by: ctx.userId }).eq('id', documentId);
    const tx = rows.find((t) => t.id === hit.id);
    const purpose = tx?.purpose?.split('\n')[0]?.slice(0, 20);
    revalidateScanViews();
    return { result: 'attached', label: `${mdLabel(hit.businessDate)} 出金 ${yenLabel(hit.amount)}${purpose ? `（${purpose}）` : ''}` };
  }

  // ---- 請求書 → 月払い ----
  if (reading.amount == null) return { result: 'review', label: '請求書の金額が読めませんでした' };
  const category = reading.category ?? 'vendor';
  if (category === 'vendor') {
    const vendorName = reading.vendorName ?? '（スキャンした請求書）';
    const { error: invErr } = await supabase.from('invoices').insert({
      organization_id: ctx.organizationId,
      store_id: doc.store_id,
      vendor_id: null,
      vendor_name: vendorName,
      issue_date: reading.date,
      amount: reading.amount,
      tax_amount: 0,
      status: 'open',
      document_id: documentId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (invErr) return { result: 'review', label: `${yenLabel(reading.amount)}・請求書を登録できませんでした` };
    await supabase
      .from('documents')
      .update({ doc_type: 'invoice', status: 'filed', title: vendorName, updated_by: ctx.userId })
      .eq('id', documentId);
    revalidateScanViews();
    revalidatePath('/app/expenses');
    revalidatePath('/app/settlement');
    return { result: 'vendor_bill', label: `${vendorName} ${yenLabel(reading.amount)}` };
  }
  // 家賃・電気・水道・ガス：入れるのは本部（月次清算）。ここでは書類を請求書として分けておき、月次清算に「スキャン済み」で出す
  const catLabel = BILL_CATEGORY_LABELS[category];
  await supabase
    .from('documents')
    .update({ doc_type: 'invoice', status: 'filed', title: `${catLabel}の請求書`, updated_by: ctx.userId })
    .eq('id', documentId);
  revalidateScanViews();
  revalidatePath('/app/settlement');
  return { result: 'fixed_bill', label: `${catLabel} ${yenLabel(reading.amount)}（月次清算で反映）` };
}
