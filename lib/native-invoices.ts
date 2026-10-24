import { formatDate, formatDateTime } from '@/lib/format';
import {
  DOC_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_OPTIONS,
  OCR_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  TRIAGE_DOC_TYPE_OPTIONS,
  UNPAID_INVOICE_STATUSES,
  extFromFile,
  type DocType,
  type InvoiceStatus,
  type OcrStatus,
  type PaymentMethod,
} from '@/components/invoices/labels';

/**
 * 請求書・書類（/app/invoices）の iPad ネイティブ（GET part=invoices ／ POST invoice…）の決まりごと。
 * 読み込みは lib/invoices-server.ts（Web と同じ）、操作は Web と同じ Server Action（app/app/invoices/actions.ts）。
 * ここは純粋な検証と、Web の画面と同じ文言の組み立てだけ（tests/native-invoices.test.ts）。2026-10-24 Ronnie「全部ネイティブ」
 */

export type InvoicesTab = 'invoices' | 'inbox' | 'documents';

/** /app/invoices の絞り込み（URL の ?status=… と同じ。空は「すべて」） */
export interface InvoicesSearch {
  status?: string;
  vendor?: string;
  ym?: string;
  docType?: string;
  store?: string;
  expense?: string;
  overdue?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const BAD = '内容が正しくありません';

export const isInvoiceId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** 'YYYY-MM' → その月の 1 日〜翌月 1 日（発行日の絞り込み。Web の page.tsx の ymRange と同じ） */
export function invoiceYmRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const endDate = new Date(y, m, 1);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`;
  return { start, end };
}

// ---------------------------------------------------------------
// GET の道（?tab=…&status=… ／ ?invoice=<id> ／ ?file=<documentId>）
// ---------------------------------------------------------------

export type NativeInvoicesView =
  | { view: 'list'; tab: InvoicesTab; search: InvoicesSearch }
  | { view: 'detail'; invoiceId: string }
  | { view: 'file'; documentId: string };

/** 空（すべて）・正しい値はそのまま、ほかは「指定なし」（Web は URL の値をそのまま使うが、アプリは正しい値しか送らない） */
function pick(params: URLSearchParams, name: string, ok: (v: string) => boolean): string | undefined {
  if (!params.has(name)) return undefined;
  const v = params.get(name) ?? '';
  return v === '' || ok(v) ? v : undefined;
}

export function parseInvoicesView(params: URLSearchParams): NativeInvoicesView | { error: string } {
  const invoice = params.get('invoice');
  if (invoice != null) return isInvoiceId(invoice) ? { view: 'detail', invoiceId: invoice } : { error: BAD };
  const file = params.get('file');
  if (file != null) return isInvoiceId(file) ? { view: 'file', documentId: file } : { error: BAD };
  const t = params.get('tab');
  const tab: InvoicesTab = t === 'inbox' || t === 'documents' ? t : 'invoices';
  const search: InvoicesSearch = {
    status: pick(params, 'status', (v) => (INVOICE_STATUS_OPTIONS as string[]).includes(v)),
    vendor: pick(params, 'vendor', (v) => UUID.test(v)),
    expense: pick(params, 'expense', (v) => UUID.test(v)),
    ym: pick(params, 'ym', (v) => YM.test(v)),
    overdue: pick(params, 'overdue', (v) => v === '1'),
    docType: pick(params, 'docType', (v) => v in DOC_TYPE_LABELS),
    store: pick(params, 'store', (v) => UUID.test(v)),
  };
  for (const k of Object.keys(search) as (keyof InvoicesSearch)[]) if (search[k] === undefined) delete search[k];
  return { view: 'list', tab, search };
}

// ---------------------------------------------------------------
// 状態の操作（Web の app/app/invoices/actions.ts の TRANSITIONS・詳細ダイアログのボタンと同じ）
// ---------------------------------------------------------------

export type InvoiceAction = 'review' | 'submit' | 'approve' | 'schedule' | 'pay' | 'reject';
export const INVOICE_ACTIONS: InvoiceAction[] = ['review', 'submit', 'approve', 'schedule', 'pay', 'reject'];

/** 操作ごとの権限（Server Action の TRANSITIONS と同じ。Server Action の中でももう一度見る） */
export const INVOICE_ACTION_PERMISSION: Record<InvoiceAction, 'documents.write' | 'invoices.approve'> = {
  review: 'documents.write',
  submit: 'documents.write',
  approve: 'invoices.approve',
  schedule: 'invoices.approve',
  pay: 'invoices.approve',
  reject: 'invoices.approve',
};

/** ボタンの字と、押したあとの toast（Web の詳細ダイアログと同じ） */
export const INVOICE_ACTION_LABEL: Record<InvoiceAction, { button: string; done: string }> = {
  review: { button: '確認待ちへ', done: '確認待ちにしました' },
  submit: { button: '承認へ回す', done: '承認へ回しました' },
  approve: { button: '承認する', done: '承認しました' },
  schedule: { button: '支払予定にする', done: '支払予定にしました' },
  pay: { button: '支払済みにする', done: '支払済みにしました' },
  reject: { button: '差戻す', done: '差戻しました' },
};

/** いまの状態・権限で出すボタン（Web の InvoiceDetailDialog と同じ条件） */
export function invoiceActionsFor(status: string, canWrite: boolean, canApprove: boolean): InvoiceAction[] {
  const out: InvoiceAction[] = [];
  if (status === 'open' && canWrite) out.push('review');
  if (status === 'review' && canWrite) out.push('submit');
  if (status === 'pending_approval' && canApprove) out.push('approve');
  if (status === 'approved' && canApprove) out.push('schedule');
  if ((status === 'scheduled' || status === 'approved') && canApprove) out.push('pay');
  if (['open', 'review', 'pending_approval', 'approved', 'scheduled'].includes(status) && canApprove) out.push('reject');
  return out;
}

/** 支払期限を過ぎた未払か（Web の InvoiceTable と同じ） */
export function isInvoiceOverdue(dueDate: string | null, status: string, today: string): boolean {
  return !!dueDate && dueDate < today && (UNPAID_INVOICE_STATUSES as string[]).includes(status);
}

// ---------------------------------------------------------------
// 表示（Web と同じ文言）
// ---------------------------------------------------------------

const statusLabel = (s: string) => INVOICE_STATUS_LABELS[s as InvoiceStatus] ?? s;
const methodLabel = (m: string | null) => (m ? PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m : null);

/** 状態・支払方法・種別の選択肢（Web の Select と同じ並び） */
export function invoiceOptionLists() {
  return {
    statusOptions: INVOICE_STATUS_OPTIONS.map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s] })),
    paymentMethodOptions: PAYMENT_METHOD_OPTIONS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] })),
    docTypeOptions: TRIAGE_DOC_TYPE_OPTIONS.map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] })),
  };
}

export interface InvoiceRowLike {
  id: string;
  status: string;
  vendorName: string;
  dueDate: string | null;
  amount: number;
  storeName: string | null;
  expenseAccountName: string | null;
  journaled: boolean;
}

/** 請求書の一覧の 1 行（Web の InvoiceTable の列と同じ） */
export function invoiceRowView(r: InvoiceRowLike, today: string) {
  return {
    id: r.id,
    status: r.status,
    statusLabel: statusLabel(r.status),
    overdue: isInvoiceOverdue(r.dueDate, r.status, today),
    vendorName: r.vendorName,
    expenseLabel: r.expenseAccountName ?? '—',
    dueLabel: formatDate(r.dueDate),
    amount: Number(r.amount ?? 0),
    storeLabel: r.storeName ?? '全店舗',
    journaled: r.journaled,
    // 仕訳を見る（Web の JournalSourceLink と同じ道）
    journalHref: r.journaled ? `/app/accounting?${new URLSearchParams({ source_type: 'purchase', source_id: r.id }).toString()}` : null,
  };
}

export interface InboxDocLike {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/** 保存ボックスの 1 行（Web の InboxList と同じ「日時・○KB」） */
export function inboxDocView(d: InboxDocLike) {
  return {
    id: d.id,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sub: `${formatDateTime(d.createdAt)}・${(Number(d.sizeBytes ?? 0) / 1024).toFixed(0)}KB`,
  };
}

export interface DocumentRowLike {
  id: string;
  docType: string;
  fileName: string;
  docDate: string | null;
  amount: number | null;
  vendorName: string | null;
  storeName: string | null;
  ocrStatus: string;
}

/** 書類の一覧の 1 行（Web の DocumentList の列と同じ） */
export function documentRowView(r: DocumentRowLike) {
  return {
    id: r.id,
    docTypeLabel: DOC_TYPE_LABELS[r.docType as DocType] ?? r.docType,
    fileName: r.fileName,
    dateLabel: formatDate(r.docDate),
    vendorLabel: r.vendorName ?? '—',
    storeLabel: r.storeName ?? '全店舗',
    amount: r.amount == null ? null : Number(r.amount),
    ocrStatus: r.ocrStatus,
    ocrLabel: OCR_STATUS_LABELS[r.ocrStatus as OcrStatus] ?? r.ocrStatus,
  };
}

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const rel = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : Array.isArray(v) && v[0] && typeof v[0] === 'object' ? (v[0] as Row) : null);

/**
 * 請求書の詳細（Web の InvoiceDetailDialog と同じ中身）。getInvoiceDetail の返事をそのまま受ける。
 * 編集できるか・出すボタンも Web と同じ条件で決める
 */
export function invoiceDetailView(
  invoice: unknown,
  comments: { id: string; body: string; createdAt: string; author: string }[],
  requiredApprovalRoleLabel: string | null,
  canWrite: boolean,
  canApprove: boolean
) {
  const inv = (invoice && typeof invoice === 'object' ? invoice : {}) as Row;
  const status = s(inv.status) ?? 'open';
  const doc = rel(inv.documents);
  const ocr = doc ? s(doc.ocr_status) ?? 'none' : null;
  const paymentMethod = s(inv.payment_method);
  return {
    id: s(inv.id) ?? '',
    status,
    statusLabel: statusLabel(status),
    vendorName: s(inv.vendor_name) ?? '',
    storeLabel: s(rel(inv.stores)?.name) ?? '全店舗',
    invoiceNo: s(inv.invoice_no),
    issueDate: s(inv.issue_date),
    dueDate: s(inv.due_date),
    issueLabel: formatDate(s(inv.issue_date)),
    dueLabel: formatDate(s(inv.due_date)),
    paidLabel: formatDate(s(inv.paid_at)),
    amount: n(inv.amount),
    taxAmount: n(inv.tax_amount),
    registrationNumber: s(inv.registration_number),
    paymentMethod,
    paymentMethodLabel: methodLabel(paymentMethod),
    expenseAccountId: s(inv.expense_account_id),
    expenseLabel: s(rel(inv.expense_accounts)?.name) ?? '未設定',
    note: s(inv.note),
    documentId: s(inv.document_id),
    attachment: doc
      ? { documentId: s(doc.id) ?? '', fileName: s(doc.file_name) ?? '', mimeType: s(doc.mime_type) ?? '', ocrStatus: ocr, ocrLabel: OCR_STATUS_LABELS[ocr as OcrStatus] ?? ocr }
      : null,
    comments: comments.map((c) => ({ id: c.id, body: c.body, author: c.author, createdLabel: formatDateTime(c.createdAt) })),
    requiredApprovalRoleLabel: status === 'pending_approval' ? requiredApprovalRoleLabel : null,
    canEdit: canWrite && status !== 'paid',
    canComment: canWrite,
    actions: invoiceActionsFor(status, canWrite, canApprove).map((a) => ({ action: a, label: INVOICE_ACTION_LABEL[a].button, done: INVOICE_ACTION_LABEL[a].done })),
    noPermission: !canWrite && !canApprove,
  };
}

// ---------------------------------------------------------------
// POST の中身の検証（中身の決まりは Server Action がそのまま見る）
// ---------------------------------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const optStr = (v: unknown, max: number): string | null | undefined => {
  if (v == null) return null;
  if (typeof v !== 'string' || v.length > max) return undefined;
  const t = v.trim();
  return t === '' ? null : t;
};
/** null／'' は null、UUID はそのまま、それ以外は undefined（だめ） */
const optId = (v: unknown): string | null | undefined => (v == null || v === '' ? null : isInvoiceId(v) ? v : undefined);
const optDate = (v: unknown): string | null | undefined => (v == null || v === '' ? null : typeof v === 'string' && DATE.test(v) ? v : undefined);
/** 金額（0 以上の数。整数に丸める）。null／'' は null */
const optYen = (v: unknown): number | null | undefined => {
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(x) || x < 0 || x > 1e12) return undefined;
  return Math.round(x);
};

/** アップロード済みファイルの参照（Server Action の UploadedFileRef と同じ形。中身の検証は Server Action の validateUploadMeta） */
export interface NativeFileRef {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export function parseFileRef(raw: unknown): NativeFileRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Row;
  if (typeof b.filePath !== 'string' || b.filePath.length === 0 || b.filePath.length > 500) return null;
  if (typeof b.fileName !== 'string' || b.fileName.length === 0 || b.fileName.length > 255) return null;
  if (typeof b.mimeType !== 'string' || b.mimeType.length > 100) return null;
  if (typeof b.sizeBytes !== 'number' || !Number.isFinite(b.sizeBytes)) return null;
  return { filePath: b.filePath, fileName: b.fileName, mimeType: b.mimeType, sizeBytes: b.sizeBytes };
}

export interface NativeInvoiceFields {
  vendorName: string;
  invoiceNo: string | null;
  issueDate: string | null;
  dueDate: string | null;
  amount: number;
  taxAmount: number;
  registrationNumber: string | null;
  paymentMethod: PaymentMethod | null;
  expenseAccountId: string | null;
  note: string | null;
}

function parseFields(b: Row): Parsed<NativeInvoiceFields> {
  if (typeof b.vendorName !== 'string' || b.vendorName.length > 200) return { ok: false, error: BAD };
  const invoiceNo = optStr(b.invoiceNo, 100);
  const issueDate = optDate(b.issueDate);
  const dueDate = optDate(b.dueDate);
  const amount = optYen(b.amount);
  const taxAmount = optYen(b.taxAmount);
  const registrationNumber = optStr(b.registrationNumber, 50);
  const note = optStr(b.note, 2000);
  const expenseAccountId = optId(b.expenseAccountId);
  const paymentMethod = b.paymentMethod == null || b.paymentMethod === '' ? null : (PAYMENT_METHOD_OPTIONS as string[]).includes(b.paymentMethod as string) ? (b.paymentMethod as PaymentMethod) : undefined;
  if (amount === undefined || amount === null) return { ok: false, error: '金額を正しく入力してください' };
  if (taxAmount === undefined) return { ok: false, error: '税額を正しく入力してください' };
  if (invoiceNo === undefined || issueDate === undefined || dueDate === undefined || registrationNumber === undefined || note === undefined || expenseAccountId === undefined || paymentMethod === undefined) {
    return { ok: false, error: BAD };
  }
  return {
    ok: true,
    value: { vendorName: b.vendorName.trim(), invoiceNo, issueDate, dueDate, amount, taxAmount: taxAmount ?? 0, registrationNumber, paymentMethod, expenseAccountId, note },
  };
}

/** 請求書を登録（Web の InvoiceForm → createInvoice と同じ中身） */
export function parseCreateInvoice(raw: Row): Parsed<NativeInvoiceFields & { storeId: string | null; vendorId: string | null; file: NativeFileRef | null }> {
  const f = parseFields(raw);
  if (!f.ok) return f;
  const storeId = optId(raw.storeId);
  const vendorId = optId(raw.vendorId);
  if (storeId === undefined || vendorId === undefined) return { ok: false, error: BAD };
  let file: NativeFileRef | null = null;
  if (raw.file != null) {
    file = parseFileRef(raw.file);
    if (!file) return { ok: false, error: '添付ファイルが正しくありません' };
  }
  return { ok: true, value: { ...f.value, storeId, vendorId, file } };
}

/** 請求書の編集（Web の詳細ダイアログ → updateInvoice と同じ中身） */
export function parseUpdateInvoice(raw: Row): Parsed<{ invoiceId: string; fields: NativeInvoiceFields }> {
  if (!isInvoiceId(raw.invoiceId)) return { ok: false, error: BAD };
  const f = parseFields(raw);
  if (!f.ok) return f;
  return { ok: true, value: { invoiceId: raw.invoiceId, fields: f.value } };
}

/** 状態の操作（承認・差戻し・支払済み …） */
export function parseInvoiceStatus(raw: Row): Parsed<{ invoiceId: string; action: InvoiceAction; reason?: string; paidAt?: string }> {
  if (!isInvoiceId(raw.invoiceId)) return { ok: false, error: BAD };
  if (!(INVOICE_ACTIONS as unknown[]).includes(raw.action)) return { ok: false, error: BAD };
  const action = raw.action as InvoiceAction;
  const reason = typeof raw.reason === 'string' && raw.reason.length <= 1000 ? raw.reason.trim() : '';
  const paidAt = typeof raw.paidAt === 'string' && DATE.test(raw.paidAt) ? raw.paidAt : '';
  if (action === 'reject' && !reason) return { ok: false, error: '差戻し理由を入力してください' };
  if (action === 'pay' && !paidAt) return { ok: false, error: '支払日を入力してください' };
  return { ok: true, value: { invoiceId: raw.invoiceId, action, ...(action === 'reject' ? { reason } : {}), ...(action === 'pay' ? { paidAt } : {}) } };
}

export interface NativeTriageInput {
  documentId: string;
  docType: DocType;
  storeId: string | null;
  vendorId: string | null;
  vendorName: string | null;
  docDate: string | null;
  amount: number | null;
  taxAmount: number | null;
  memo: string | null;
}

/** 保存ボックスの仕分け（Web の TriageDialog → triageDocument と同じ中身） */
export function parseTriage(raw: Row): Parsed<NativeTriageInput> {
  if (!isInvoiceId(raw.documentId)) return { ok: false, error: BAD };
  if (!(TRIAGE_DOC_TYPE_OPTIONS as unknown[]).includes(raw.docType)) return { ok: false, error: '種別を選んでください' };
  const storeId = optId(raw.storeId);
  const vendorId = optId(raw.vendorId);
  const vendorName = optStr(raw.vendorName, 200);
  const docDate = optDate(raw.docDate);
  const amount = optYen(raw.amount);
  const taxAmount = optYen(raw.taxAmount);
  const memo = optStr(raw.memo, 1000);
  if (amount === undefined) return { ok: false, error: '金額を正しく入力してください' };
  if (taxAmount === undefined) return { ok: false, error: '税額を正しく入力してください' };
  if (storeId === undefined || vendorId === undefined || vendorName === undefined || docDate === undefined || memo === undefined) return { ok: false, error: BAD };
  return { ok: true, value: { documentId: raw.documentId, docType: raw.docType as DocType, storeId, vendorId, vendorName, docDate, amount, taxAmount, memo } };
}

// ---------------------------------------------------------------
// ファイルのアップロード（Web はブラウザから Storage へ直接。アプリは 3MB までは本文で送ってサーバーが上げる、
// それより大きいもの（ScanSnap の PDF など。Web と同じ 20MB まで）は署名付きの URL へ iPad から直接上げる）
// ---------------------------------------------------------------

/** 本文で送る上限。Vercel の本文の上限（4.5MB）より小さく、Base64 で 4/3 倍になる分を見込む（lib/native-scan.ts と同じ） */
export const NATIVE_INVOICE_INLINE_MAX = 3_000_000;

export interface NativeUploadRequest {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storeId: string | null;
  dataBase64: string | null;
}

export function parseUploadRequest(raw: Row): Parsed<NativeUploadRequest> {
  const fileName = typeof raw.fileName === 'string' ? raw.fileName.replace(/[\\/]/g, '_').trim().slice(0, 200) : '';
  if (!fileName) return { ok: false, error: 'ファイル名が正しくありません' };
  if (typeof raw.mimeType !== 'string' || raw.mimeType.length > 100) return { ok: false, error: BAD };
  if (typeof raw.sizeBytes !== 'number' || !Number.isFinite(raw.sizeBytes)) return { ok: false, error: 'ファイルサイズが不正です' };
  const storeId = optId(raw.storeId);
  if (storeId === undefined) return { ok: false, error: BAD };
  let dataBase64: string | null = null;
  if (raw.dataBase64 != null) {
    if (typeof raw.dataBase64 !== 'string' || raw.dataBase64.length === 0 || !/^[A-Za-z0-9+/=\r\n]+$/.test(raw.dataBase64)) return { ok: false, error: 'ファイルが正しくありません' };
    if (Math.floor((raw.dataBase64.length * 3) / 4) > NATIVE_INVOICE_INLINE_MAX + 4) return { ok: false, error: 'ファイルが大きすぎます' };
    dataBase64 = raw.dataBase64;
  }
  return { ok: true, value: { fileName, mimeType: raw.mimeType, sizeBytes: Math.round(raw.sizeBytes), storeId, dataBase64 } };
}

/** 保存先のパス（Web の InvoiceForm・UploadZone と同じ形：組織/店舗|hq/年/月/uuid.拡張子。年月は日本時間） */
export function invoiceUploadPath(organizationId: string, storeId: string | null, file: { fileName: string; mimeType: string }, uuid: string, now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const yyyy = String(jst.getUTCFullYear());
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const ext = extFromFile({ name: file.fileName, type: file.mimeType });
  return `${organizationId}/${storeId ?? 'hq'}/${yyyy}/${mm}/${uuid}.${ext}`;
}
