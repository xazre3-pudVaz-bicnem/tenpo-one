import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { loadInvoicesPageData } from '@/lib/invoices-server';
import { MAX_FILE_SIZE, validateUploadMeta } from '@/components/invoices/labels';
import { OCR_NOT_CONNECTED_NOTE } from '@/components/invoices/extraction';
import {
  INVOICE_ACTION_LABEL,
  INVOICE_ACTION_PERMISSION,
  NATIVE_INVOICE_INLINE_MAX,
  documentRowView,
  inboxDocView,
  invoiceDetailView,
  invoiceOptionLists,
  invoiceRowView,
  invoiceUploadPath,
  isInvoiceId,
  parseCreateInvoice,
  parseFileRef,
  parseInvoiceStatus,
  parseInvoicesView,
  parseTriage,
  parseUpdateInvoice,
  parseUploadRequest,
} from '@/lib/native-invoices';
import {
  addDocumentComment,
  changeInvoiceStatus,
  checkDuplicateDocument,
  createInboxDocument,
  createInvoice,
  deleteDocument,
  getDocumentSignedUrl,
  getInvoiceDetail,
  runDocumentOcr,
  triageDocument,
  updateInvoice,
} from '@/app/app/invoices/actions';
import type { SessionContext } from '@/lib/auth';
import type { PermissionAction } from '@/lib/permissions';
import type { NativeModuleGet, NativeModulePost, NativeModuleResult } from '@/lib/native-modules/registry';

/**
 * 請求書・書類の iPad ネイティブ（GET part=invoices ／ POST invoice…）。
 * 中身・操作は Web の /app/invoices と同じ（読み込み lib/invoices-server.ts、操作 app/app/invoices/actions.ts）。2026-10-24 Ronnie「全部ネイティブ」
 *   GET part=invoices&tab=invoices|inbox|documents&status=&vendor=&expense=&ym=&overdue=1&docType=&store=  … 一覧（Web のタブ・絞り込みと同じ）
 *   GET part=invoices&invoice=<id>   … 請求書の詳細（コメント・必要な承認ロール・添付）
 *   GET part=invoices&file=<docId>   … 添付ファイルの署名 URL（1時間。iPad が取ってきてプレビュー・共有シート）
 * 権限は Web と同じ（documents.write・invoices.approve・csv.export。Server Action の中でももう一度見る）
 */

const FEATURE_OFF: NativeModuleResult = { status: 403, body: { ok: false, error: '請求書・書類は使えません' } };
const bad = (error: string): NativeModuleResult => ({ status: 400, body: { ok: false, error } });
const denied = (error = '権限がありません'): NativeModuleResult => ({ status: 403, body: { ok: false, error } });
const errorText = (e: unknown, fallback: string): string => {
  const raw = e instanceof Error ? e.message : '';
  return !raw || /Minified React error|Server Components render|digest|NEXT_REDIRECT/i.test(raw) ? fallback : raw;
};

const featureOff = (ctx: SessionContext) => !ctx.organizationId || ctx.disabledFeatures?.has('accounting') === true;

// ---------------------------------------------------------------
// GET
// ---------------------------------------------------------------

export const invoicesGet: NativeModuleGet = async ({ ctx, url }) => {
  if (featureOff(ctx) || !ctx.organizationId) return FEATURE_OFF;
  const view = parseInvoicesView(url.searchParams);
  if ('error' in view) return bad(view.error);
  const canWrite = can(ctx.role, 'documents.write');
  const canApprove = can(ctx.role, 'invoices.approve');

  if (view.view === 'detail') {
    try {
      const { invoice, comments, requiredApprovalRoleLabel } = await getInvoiceDetail(view.invoiceId);
      return { body: { ok: true, view: 'detail', detail: invoiceDetailView(invoice, comments, requiredApprovalRoleLabel, canWrite, canApprove) } };
    } catch (e) {
      return { status: 404, body: { ok: false, error: errorText(e, '請求書が見つかりません') } };
    }
  }

  if (view.view === 'file') {
    try {
      const f = await getDocumentSignedUrl(view.documentId);
      return { body: { ok: true, view: 'file', url: f.url, mimeType: f.mimeType, fileName: f.fileName } };
    } catch {
      return { status: 404, body: { ok: false, error: 'プレビューを開けませんでした' } };
    }
  }

  const supabase = await createClient();
  const { tab, search } = view;
  const data = await loadInvoicesPageData(supabase, { organizationId: ctx.organizationId, currentStore: ctx.currentStore }, tab, search);
  const today = todayJst();
  const stores = ctx.stores.map((s) => ({ id: s.id, name: s.name }));
  const hqStores = ctx.isHq ? stores : [];
  const status = search.status ?? '';

  return {
    body: {
      ok: true,
      view: 'list',
      tab,
      canWrite,
      canApprove,
      canExport: can(ctx.role, 'csv.export'),
      currentStoreId: ctx.currentStore?.id ?? null,
      // 請求書の登録・書類の絞り込みの店舗は本部だけ（Web の storeOptions）、仕分けは触れる店舗すべて（Web の InboxList）
      formStores: hqStores,
      triageStores: stores,
      vendors: data.vendors.map((v) => ({ id: v.id as string, name: v.name as string })),
      accounts: data.accounts.map((a) => ({ id: a.id as string, name: a.name as string })),
      filters: {
        status,
        vendor: search.vendor ?? '',
        expense: search.expense ?? '',
        ym: search.ym ?? '',
        overdue: search.overdue === '1',
        docType: search.docType ?? '',
        store: search.store ?? ctx.currentStore?.id ?? '',
      },
      summary: {
        unpaidTotal: data.unpaidTotal,
        scheduledThisMonthTotal: data.scheduledThisMonthTotal,
        overdueCount: data.overdueCount,
        overdueTotal: data.overdueTotal,
      },
      invoices: data.invoiceRows.map((r) => invoiceRowView(r, today)),
      inbox: data.inboxDocs.map(inboxDocView),
      documents: data.documentRows.map(documentRowView),
      ...invoiceOptionLists(),
      // 請求書CSV（Web の「請求書CSV」と同じ道・同じファイル）
      csvPath: `/app/invoices/export${status ? `?status=${encodeURIComponent(status)}` : ''}`,
      csvName: `invoices_${today}.csv`,
      inlineMax: NATIVE_INVOICE_INLINE_MAX,
      maxFileSize: MAX_FILE_SIZE,
    },
  };
};

// ---------------------------------------------------------------
// POST
// ---------------------------------------------------------------

/** 機能・権限を見てから実行。Server Action の throw は 400 とそのことばに */
const guarded =
  (permission: PermissionAction | ((raw: Record<string, unknown>) => PermissionAction | null), run: (raw: Record<string, unknown>, ctx: SessionContext) => Promise<NativeModuleResult>): NativeModulePost =>
  async ({ ctx, raw }) => {
    if (featureOff(ctx)) return FEATURE_OFF;
    const need = typeof permission === 'function' ? permission(raw) : permission;
    if (!need) return bad('内容が正しくありません');
    if (!can(ctx.role, need)) return denied(need === 'invoices.approve' ? '請求書を承認・支払する権限がありません' : '書類を扱う権限がありません');
    try {
      return await run(raw, ctx);
    } catch (e) {
      return bad(errorText(e, '操作に失敗しました'));
    }
  };

const done = (message: string, extra: Record<string, unknown> = {}): NativeModuleResult => ({ body: { ok: true, message, ...extra } });

/** 請求書を登録（添付は先に invoiceUpload で上げた参照） */
export const invCreatePost = guarded('documents.write', async (raw) => {
  const p = parseCreateInvoice(raw);
  if (!p.ok) return bad(p.error);
  await createInvoice(p.value);
  return done('請求書を登録しました');
});

/** 請求書の編集（支払済みは Server Action が断る） */
export const invUpdatePost = guarded('documents.write', async (raw) => {
  const p = parseUpdateInvoice(raw);
  if (!p.ok) return bad(p.error);
  await updateInvoice(p.value.invoiceId, p.value.fields);
  return done('請求書を更新しました');
});

/** 状態の操作（確認待ちへ・承認へ回す・承認・支払予定・支払済み・差戻し）。権限は操作ごと（Server Action の TRANSITIONS と同じ） */
export const invStatusPost = guarded(
  (raw) => {
    const a = raw.action;
    return typeof a === 'string' && a in INVOICE_ACTION_PERMISSION ? INVOICE_ACTION_PERMISSION[a as keyof typeof INVOICE_ACTION_PERMISSION] : null;
  },
  async (raw) => {
    const p = parseInvoiceStatus(raw);
    if (!p.ok) return bad(p.error);
    await changeInvoiceStatus(p.value.invoiceId, p.value.action, { reason: p.value.reason, paidAt: p.value.paidAt });
    return done(INVOICE_ACTION_LABEL[p.value.action].done);
  }
);

/** 書類にコメント */
export const invCommentPost = guarded('documents.write', async (raw) => {
  if (!isInvoiceId(raw.documentId)) return bad('内容が正しくありません');
  const body = typeof raw.body === 'string' ? raw.body.slice(0, 2000) : '';
  if (!body.trim()) return bad('コメントを入力してください');
  await addDocumentComment(raw.documentId, body.trim());
  return done('コメントを追加しました');
});

/** OCR で読み取り（モック・未接続。結果は入力欄に入れるだけ。Web と同じ） */
export const invOcrPost = guarded('documents.write', async (raw) => {
  if (!isInvoiceId(raw.documentId)) return bad('内容が正しくありません');
  const extraction = await runDocumentOcr(raw.documentId);
  return done('OCR（モック）を実行しました', {
    extraction: {
      vendor: extraction.vendor,
      issuedDate: extraction.issuedDate,
      dueDate: extraction.dueDate,
      total: extraction.total,
      tax: extraction.tax,
      registrationNumber: extraction.registrationNumber,
    },
    note: OCR_NOT_CONNECTED_NOTE,
  });
});

/** 保存ボックスの書類を仕分け（種別＝請求書なら請求書も作る） */
export const invTriagePost = guarded('documents.write', async (raw) => {
  const p = parseTriage(raw);
  if (!p.ok) return bad(p.error);
  await triageDocument(p.value);
  return done('仕分けしました');
});

/** 書類の削除（理由必須・監査ログ。Web の ConfirmDialog と同じ） */
export const invDocDeletePost = guarded('documents.write', async (raw) => {
  if (!isInvoiceId(raw.documentId)) return bad('内容が正しくありません');
  const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 1000).trim() : '';
  if (!reason) return bad('理由を入力してください');
  await deleteDocument(raw.documentId, reason);
  return done('書類を削除しました');
});

/** 重複アップロードの可能性（同じファイル名・サイズ。Web の UploadZone と同じく、あってもスキップ／続行を選べる） */
export const invDupCheckPost = guarded('documents.write', async (raw) => {
  const fileName = typeof raw.fileName === 'string' ? raw.fileName.slice(0, 255) : '';
  const sizeBytes = typeof raw.sizeBytes === 'number' && Number.isFinite(raw.sizeBytes) ? raw.sizeBytes : -1;
  if (!fileName || sizeBytes < 0) return bad('内容が正しくありません');
  const { duplicate } = await checkDuplicateDocument(fileName, sizeBytes);
  return { body: { ok: true, duplicate } };
});

/**
 * ファイルを Storage（documents バケット）へ。Web はブラウザから直接上げるところ。
 *   dataBase64 あり（3MB まで）… サーバーが Web と同じ場所へ上げる
 *   dataBase64 なし（20MB まで）… 署名付きのアップロード URL を返す（iPad がそこへ PUT）
 * どちらも返事の file を、そのまま invoiceInboxCreate・invoiceCreate に渡す（メタの検証は Server Action がもう一度する）
 */
export const invUploadPost = guarded('documents.write', async (raw, ctx) => {
  const p = parseUploadRequest(raw);
  if (!p.ok) return bad(p.error);
  const u = p.value;
  if (u.storeId && !ctx.stores.some((s) => s.id === u.storeId)) return denied('対象店舗にアクセス権がありません');
  const bytes = u.dataBase64 ? Buffer.from(u.dataBase64, 'base64') : null;
  if (bytes && bytes.length === 0) return bad('ファイルが正しくありません');
  const sizeBytes = bytes ? bytes.length : u.sizeBytes;
  const metaError = validateUploadMeta({ fileName: u.fileName, mimeType: u.mimeType, sizeBytes });
  if (metaError) return bad(metaError);
  const path = invoiceUploadPath(ctx.organizationId as string, u.storeId, u, crypto.randomUUID());
  const file = { filePath: path, fileName: u.fileName, mimeType: u.mimeType, sizeBytes };
  const supabase = await createClient();
  if (bytes) {
    const { error } = await supabase.storage.from('documents').upload(path, bytes, { contentType: u.mimeType, upsert: false });
    if (error) return bad('ストレージへのアップロードに失敗しました');
    return { body: { ok: true, file } };
  }
  const { data, error } = await supabase.storage.from('documents').createSignedUploadUrl(path);
  if (error || !data) return bad('アップロードの準備に失敗しました');
  return { body: { ok: true, file, upload: { url: data.signedUrl, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null } } };
});

/** 保存ボックスへ登録（上げたファイルの参照） */
export const invInboxCreatePost = guarded('documents.write', async (raw) => {
  const file = parseFileRef(raw.file);
  if (!file) return bad('ファイルが正しくありません');
  await createInboxDocument(file);
  return done('保存ボックスに保存しました');
});
