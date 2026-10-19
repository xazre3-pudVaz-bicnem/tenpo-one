'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limit';
import { validateUploadMeta } from '@/components/invoices/labels';
import { can } from '@/lib/permissions';
import {
  BILL_CATEGORY_LABELS,
  INVOICE_PAYMENT_METHOD,
  PAYMENT_LABELS,
  isCashPayment,
  matchWithdrawal,
  type BillCategory,
  type PaymentMethod,
  type ScanKind,
  type ScanReading,
} from '@/lib/receipt-read';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

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
  /** ファイルの SHA-256（同じファイルの取り込み防止・改変検知。documents.content_hash） */
  contentHash?: string | null;
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
      content_hash: input.contentHash && SHA256_RE.test(input.contentHash) ? input.contentHash : null,
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
// ScanSnap などでまとめてスキャンした書類の仕分け（2026-10-20 Ronnie）
//   1. 取り込む前に、同じファイルがもう入っていないか確かめる（checkScanDuplicate：中身の SHA-256。古い書類はファイル名＋大きさ）
//   2. 読み取った内容から「どこに入れるか」の案を出す（planScanFiling。書類に金額・日付などは入れるが、仕分けはまだしない）
//   3. 画面で確かめて・直してから登録（fileScan）
//      レシート（現金）           → 出金に紐付け（レジクローズの「出金レシート」が OK になる）
//      レシート（カード・電子マネー・QR）→ レシートとして保存（レジの出金とは紐付けない）
//      請求書                     → 月払い：仕入先の請求書（invoices）／家賃・電気・水道・ガス（月次清算で本部が反映）
//      あとで                     → 保存ボックスに残す
//   同じ内容（日付・金額・発行元）の書類がもうあるときは「あとで」を案にして知らせる
// 文字の読み取りは端末のブラウザの中（components/scan/scan-bulk-import.tsx）。ここは読み取った結果で仕分けるだけ。
// ---------------------------------------------------------------------------

export type ScanAction = 'attach' | 'receipt' | 'bill' | 'keep';

export type AutoFileResult =
  | { result: 'attached'; label: string }
  | { result: 'receipt'; label: string }
  | { result: 'vendor_bill'; label: string }
  | { result: 'fixed_bill'; label: string }
  | { result: 'review'; label: string };

/** レシートを紐付けられる出金（同じ金額・前後の日付・レシートがまだ無いもの） */
export interface ScanCandidate {
  id: string;
  businessDate: string;
  amount: number;
  label: string;
}

export interface ScanPlan {
  /** 整えた読み取り結果（画面の入力欄の値） */
  reading: ScanReading;
  /** おすすめの登録先 */
  action: ScanAction;
  /** おすすめの出金（action が attach のとき） */
  txId: string | null;
  candidates: ScanCandidate[];
  /** 案の説明（「10/19 出金 ¥3,280 に紐付けます」など） */
  note: string;
  /** 同じ内容の書類がもうあるときの説明 */
  duplicate: string | null;
  /** 出金に紐付けられるか（店舗の書類で cash.write がある） */
  canAttach: boolean;
}

const AUTO_MATCH_KINDS = ['withdrawal', 'petty_out'];
const SCAN_KINDS: ScanKind[] = ['receipt', 'bill'];
const BILL_CATEGORIES: BillCategory[] = ['rent', 'electric', 'water', 'gas', 'vendor'];
const PAYMENTS: PaymentMethod[] = ['cash', 'card', 'emoney', 'qr', 'transfer', 'debit'];
const ACTIONS: ScanAction[] = ['attach', 'receipt', 'bill', 'keep'];

function cleanReading(r: ScanReading): ScanReading {
  const amount = typeof r.amount === 'number' && Number.isInteger(r.amount) && r.amount > 0 && r.amount <= 10_000_000 ? r.amount : null;
  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  const kind = SCAN_KINDS.includes(r.kind) ? r.kind : 'receipt';
  const category = kind === 'bill' && r.category && BILL_CATEGORIES.includes(r.category) ? r.category : kind === 'bill' ? 'vendor' : null;
  const vendorName = typeof r.vendorName === 'string' && r.vendorName.trim() ? r.vendorName.trim().slice(0, 40) : null;
  const tax =
    typeof r.tax === 'number' && Number.isInteger(r.tax) && r.tax >= 0 && (amount == null || r.tax <= amount) ? r.tax : null;
  const payment = r.payment && PAYMENTS.includes(r.payment) ? r.payment : null;
  return { kind, category, amount, date, vendorName, tax, payment };
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const yenLabel = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const mdLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** timestamptz → 'M/D'（JST） */
const mdOfTimestamp = (iso: string) => mdLabel(new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
const todayJstDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

type Ctx = Awaited<ReturnType<typeof requirePermission>>;
type Supa = Awaited<ReturnType<typeof createClient>>;
type ScanDoc = { id: string; organization_id: string; store_id: string | null; status: string };

async function loadScanDoc(supabase: Supa, ctx: Ctx, documentId: string): Promise<ScanDoc> {
  if (!UUID_RE.test(documentId)) throw new Error('不正なIDです');
  const { data: doc } = await supabase
    .from('documents')
    .select('id, organization_id, store_id, status')
    .eq('id', documentId)
    .maybeSingle();
  if (!doc || doc.organization_id !== ctx.organizationId || doc.status === 'deleted') throw new Error('対象の書類が見つかりません');
  if (doc.store_id !== null && !ctx.stores.some((s) => s.id === doc.store_id)) throw new Error('対象の書類にアクセス権がありません');
  return doc;
}

/** 読み取った（直した）内容を書類に入れる。保存ボックスにあるあいだだけ */
async function saveReading(supabase: Supa, ctx: Ctx, documentId: string, reading: ScanReading) {
  const { error } = await supabase
    .from('documents')
    .update({
      amount: reading.amount,
      tax_amount: reading.tax,
      doc_date: reading.date,
      year_month: reading.date ? reading.date.slice(0, 7) : null,
      ocr_status: 'done',
      ocr_payload: { source: 'scan_auto', ...reading },
      updated_by: ctx.userId,
    })
    .eq('id', documentId)
    .eq('status', 'inbox');
  if (error) throw new Error(error.message);
}

/** 同じ金額・前後の日付・レシートがまだ無い出金（選べるように少し広めに出す。自動で選ぶのは matchWithdrawal の幅だけ） */
async function findCandidates(supabase: Supa, storeId: string, reading: ScanReading, today: string): Promise<ScanCandidate[]> {
  if (reading.amount == null) return [];
  const center = reading.date ?? today;
  const { data } = await supabase
    .from('cash_transactions')
    .select('id, kind, amount, business_date, purpose')
    .eq('store_id', storeId)
    .in('kind', AUTO_MATCH_KINDS)
    .eq('status', 'active')
    .is('receipt_document_id', null)
    .eq('amount', reading.amount)
    .gte('business_date', shiftDate(center, reading.date ? -7 : -14))
    .lte('business_date', reading.date ? shiftDate(center, 7) : today)
    .order('business_date', { ascending: false })
    .limit(10);
  return ((data ?? []) as { id: string; kind: string; amount: number; business_date: string; purpose: string | null }[]).map((t) => ({
    id: t.id,
    businessDate: t.business_date,
    amount: t.amount,
    label: t.purpose?.split('\n')[0]?.trim().slice(0, 24) || (t.kind === 'petty_out' ? '小口出金' : '出金'),
  }));
}

/** 同じ内容の書類（日付・金額・発行元が同じ）がもう仕分けてあるか。あればその説明 */
async function findSameContent(supabase: Supa, ctx: Ctx, doc: ScanDoc, reading: ScanReading): Promise<string | null> {
  if (reading.amount == null) return null;
  if (reading.kind === 'receipt') {
    if (!reading.date) return null;
    let q = supabase
      .from('documents')
      .select('id, created_at, title, ocr_payload')
      .eq('organization_id', ctx.organizationId)
      .in('doc_type', ['receipt', 'register_receipt'])
      .eq('status', 'filed')
      .eq('amount', reading.amount)
      .eq('doc_date', reading.date)
      .neq('id', doc.id)
      .limit(10);
    q = doc.store_id ? q.eq('store_id', doc.store_id) : q.is('store_id', null);
    const { data } = await q;
    const same = (data ?? []).find((r) => {
      const payload = (r.ocr_payload ?? null) as { vendorName?: string | null } | null;
      const v = payload?.vendorName ?? r.title ?? null;
      return reading.vendorName == null || v == null || v === reading.vendorName;
    });
    return same ? `同じ日・同じ金額のレシートがもうあります（${mdOfTimestamp(same.created_at)} 取込）` : null;
  }
  const category = reading.category ?? 'vendor';
  if (category === 'vendor') {
    if (!reading.vendorName && !reading.date) return null;
    let q = supabase
      .from('invoices')
      .select('id, created_at')
      .eq('organization_id', ctx.organizationId)
      .eq('amount', reading.amount)
      .neq('status', 'rejected')
      .limit(1);
    if (reading.vendorName) q = q.eq('vendor_name', reading.vendorName);
    if (reading.date) q = q.eq('issue_date', reading.date);
    q = doc.store_id ? q.eq('store_id', doc.store_id) : q.is('store_id', null);
    const { data } = await q;
    return data && data.length > 0 ? `同じ請求書がもう月払いにあります（${mdOfTimestamp(data[0].created_at)} 登録）` : null;
  }
  if (!reading.date) return null;
  let q = supabase
    .from('documents')
    .select('id, created_at')
    .eq('organization_id', ctx.organizationId)
    .eq('doc_type', 'invoice')
    .eq('status', 'filed')
    .eq('amount', reading.amount)
    .eq('year_month', reading.date.slice(0, 7))
    .eq('title', `${BILL_CATEGORY_LABELS[category]}の請求書`)
    .neq('id', doc.id)
    .limit(1);
  q = doc.store_id ? q.eq('store_id', doc.store_id) : q.is('store_id', null);
  const { data } = await q;
  return data && data.length > 0 ? `同じ月の${BILL_CATEGORY_LABELS[category]}の請求書がもうあります（${mdOfTimestamp(data[0].created_at)} 取込）` : null;
}

/**
 * 取り込む前の重複チェック。中身（SHA-256）が同じ書類があれば、その取込日の説明を返す。
 * 中身のハッシュが無い古い書類は、ファイル名＋大きさで確かめる。
 */
export async function checkScanDuplicate(input: { hash: string | null; fileName: string; sizeBytes: number }): Promise<{ duplicate: string | null }> {
  const ctx = await requirePermission('documents.write');
  const supabase = await createClient();
  const label = (r: { created_at: string; status: string }) =>
    `同じファイルが ${mdOfTimestamp(r.created_at)} に取り込み済みです${r.status === 'inbox' ? '（保存ボックス）' : ''}`;
  if (input.hash && SHA256_RE.test(input.hash)) {
    const { data } = await supabase
      .from('documents')
      .select('created_at, status')
      .eq('organization_id', ctx.organizationId)
      .eq('content_hash', input.hash)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0) return { duplicate: label(data[0]) };
  }
  const { data: old } = await supabase
    .from('documents')
    .select('created_at, status')
    .eq('organization_id', ctx.organizationId)
    .eq('file_name', input.fileName.slice(0, 255))
    .eq('size_bytes', input.sizeBytes)
    .is('content_hash', null)
    .neq('status', 'deleted')
    .limit(1);
  return { duplicate: old && old.length > 0 ? label(old[0]) : null };
}

/** 読み取った内容を書類に入れ、登録先の案を返す（まだ仕分けない。画面で確かめてから fileScan） */
export async function planScanFiling(documentId: string, raw: ScanReading): Promise<ScanPlan> {
  const ctx = await requirePermission('documents.write');
  const reading = cleanReading(raw);
  const supabase = await createClient();
  const doc = await loadScanDoc(supabase, ctx, documentId);
  const plan: ScanPlan = { reading, action: 'keep', txId: null, candidates: [], note: '', duplicate: null, canAttach: false };
  if (doc.status !== 'inbox') return { ...plan, note: 'すでに仕分け済みです' };
  await saveReading(supabase, ctx, documentId, reading);

  const today = todayJstDate();
  const canAttach = Boolean(doc.store_id) && can(ctx.role, 'cash.write');
  const duplicate = await findSameContent(supabase, ctx, doc, reading);
  const base: ScanPlan = { ...plan, duplicate, canAttach };
  /** 同じ内容がもうあるときは「あとで」を案にする（選び直せる） */
  const suggest = (action: ScanAction): ScanAction => (duplicate ? 'keep' : action);

  if (reading.kind === 'receipt') {
    if (reading.amount == null) return { ...base, note: '金額が読めませんでした。金額を入れてください' };
    if (!isCashPayment(reading.payment)) {
      return { ...base, action: suggest('receipt'), note: `${PAYMENT_LABELS[reading.payment as PaymentMethod]}で払ったレシートです（出金とは紐付けません）` };
    }
    if (!canAttach) {
      return { ...base, note: doc.store_id ? '出金に紐付ける権限がありません（保存ボックスに残します）' : '店舗を選んでから取り込むと出金に紐付けできます' };
    }
    const candidates = await findCandidates(supabase, doc.store_id as string, reading, today);
    const hit = matchWithdrawal(reading, candidates, today);
    if (hit) {
      const c = candidates.find((x) => x.id === hit.id);
      return {
        ...base,
        candidates,
        action: suggest('attach'),
        txId: duplicate ? null : hit.id,
        note: `${mdLabel(hit.businessDate)} の出金 ${yenLabel(hit.amount)}${c ? `（${c.label}）` : ''}に紐付けます`,
      };
    }
    if (candidates.length > 0) {
      return {
        ...base,
        candidates,
        note: candidates.length > 1 ? '同じ金額の出金が2件以上あります。合うものを選んでください' : '日付の近い出金がありません。合っていれば選んでください',
      };
    }
    return { ...base, note: '金額・日付の合う出金がありません（保存ボックスに残します）' };
  }

  if (reading.amount == null) return { ...base, note: '請求書の金額が読めませんでした。金額を入れてください' };
  const category = reading.category ?? 'vendor';
  return {
    ...base,
    action: suggest('bill'),
    note: category === 'vendor' ? '月払い（仕入先の請求書）に入れます' : `月払い：${BILL_CATEGORY_LABELS[category]}（月次清算で反映）`,
  };
}

/** 画面で確かめた内容で仕分ける */
export async function fileScan(
  documentId: string,
  raw: ScanReading,
  choice: { action: ScanAction; txId?: string | null }
): Promise<AutoFileResult> {
  const ctx = await requirePermission('documents.write');
  if (!ACTIONS.includes(choice.action)) throw new Error('登録先が正しくありません');
  const reading = cleanReading(raw);
  const supabase = await createClient();
  const doc = await loadScanDoc(supabase, ctx, documentId);
  if (doc.status !== 'inbox') return { result: 'review', label: 'すでに仕分け済みです' };
  await saveReading(supabase, ctx, documentId, reading);
  const amountText = reading.amount != null ? yenLabel(reading.amount) : '';

  if (choice.action === 'keep') {
    revalidateScanViews();
    return { result: 'review', label: `${amountText ? `${amountText} ` : ''}（あとで仕分け）` };
  }

  // ---- レシート → 出金に紐付け ----
  if (choice.action === 'attach') {
    if (!choice.txId || !UUID_RE.test(choice.txId)) throw new Error('紐付ける出金を選んでください');
    if (!doc.store_id || !can(ctx.role, 'cash.write')) throw new Error('出金に紐付ける権限がありません');
    const { data: tx } = await supabase
      .from('cash_transactions')
      .select('id, store_id, kind, amount, business_date, purpose, status, receipt_document_id')
      .eq('id', choice.txId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();
    if (!tx || tx.store_id !== doc.store_id || !AUTO_MATCH_KINDS.includes(tx.kind) || tx.status !== 'active') {
      throw new Error('この出金には紐付けできません');
    }
    if (tx.receipt_document_id && tx.receipt_document_id !== documentId) throw new Error('この出金にはもうレシートがあります');
    if (reading.amount !== tx.amount) throw new Error('レシートの金額と出金の金額が合いません');
    await attachReceiptToCashTransaction(tx.id, documentId);
    await supabase
      .from('documents')
      .update({ doc_type: 'receipt', status: 'filed', title: reading.vendorName, updated_by: ctx.userId })
      .eq('id', documentId);
    const purpose = tx.purpose?.split('\n')[0]?.slice(0, 20);
    revalidateScanViews();
    return { result: 'attached', label: `${mdLabel(tx.business_date)} 出金 ${yenLabel(tx.amount)}${purpose ? `（${purpose}）` : ''}` };
  }

  // ---- カード・電子マネー・QR のレシート → レシートとして保存 ----
  if (choice.action === 'receipt') {
    await supabase
      .from('documents')
      .update({ doc_type: 'receipt', status: 'filed', title: reading.vendorName, updated_by: ctx.userId })
      .eq('id', documentId);
    revalidateScanViews();
    revalidatePath('/app/expenses');
    const pay = reading.payment ? `（${PAYMENT_LABELS[reading.payment]}）` : '';
    return { result: 'receipt', label: `${reading.vendorName ?? 'レシート'} ${amountText}${pay}` };
  }

  // ---- 請求書 → 月払い ----
  if (reading.amount == null) throw new Error('請求書の金額を入れてください');
  const category = reading.kind === 'bill' ? (reading.category ?? 'vendor') : 'vendor';
  if (category === 'vendor') {
    const vendorName = reading.vendorName ?? '（スキャンした請求書）';
    const { error: invErr } = await supabase.from('invoices').insert({
      organization_id: ctx.organizationId,
      store_id: doc.store_id,
      vendor_id: null,
      vendor_name: vendorName,
      issue_date: reading.date,
      amount: reading.amount,
      tax_amount: reading.tax ?? 0,
      payment_method: reading.payment ? INVOICE_PAYMENT_METHOD[reading.payment] : null,
      status: 'open',
      document_id: documentId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    });
    if (invErr) throw new Error('請求書を登録できませんでした');
    await supabase
      .from('documents')
      .update({ doc_type: 'invoice', status: 'filed', title: vendorName, updated_by: ctx.userId })
      .eq('id', documentId);
    revalidateScanViews();
    revalidatePath('/app/expenses');
    revalidatePath('/app/settlement');
    return { result: 'vendor_bill', label: `${vendorName} ${amountText}` };
  }
  // 家賃・電気・水道・ガス：入れるのは本部（月次清算）。ここでは書類を請求書として分けておき、月次清算に「スキャン済み」で出す
  const catLabel = BILL_CATEGORY_LABELS[category];
  await supabase
    .from('documents')
    .update({ doc_type: 'invoice', status: 'filed', title: `${catLabel}の請求書`, updated_by: ctx.userId })
    .eq('id', documentId);
  revalidateScanViews();
  revalidatePath('/app/settlement');
  return { result: 'fixed_bill', label: `${catLabel} ${amountText}（月次清算で反映）` };
}
