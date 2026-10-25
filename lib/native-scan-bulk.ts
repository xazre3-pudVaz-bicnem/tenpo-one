import { isUuid } from '@/lib/native-pos';
import type { ScanAction } from '@/app/app/scan/actions';
import {
  BILL_CATEGORY_SHORT,
  PAYMENT_LABELS,
  SCAN_BILL_CATEGORIES,
  SCAN_BILL_PAYMENTS,
  SCAN_RECEIPT_PAYMENTS,
  type BillCategory,
  type PaymentMethod,
  type ScanKind,
  type ScanReading,
} from '@/lib/receipt-read';

/**
 * iPad ネイティブの「ScanSnap まとめて取り込み」（/app/scan#scan-bulk。ios/Shared/NativeScanBulkView.swift）の
 * 送られてきた中身を確かめる純関数（2026-10-25 Ronnie「iPad のサブメニューのサブメニューまで全部ネイティブ」）。
 * 流れは Web の components/scan/scan-bulk-import.tsx と同じ：
 *   iPad：ファイルを選ぶ → HEIC は JPEG に → SHA-256 → POST scanBulkCheck（checkScanDuplicate）
 *         → POST scanUpload（3MB まで。dayFolder・contentHash）／3MB を超えるものは scanBulkUploadUrl → 直接アップロード → scanBulkRegister
 *         → 文字の読み取り（PDF の文字は PDFKit・画像は Vision。iPad の中）→ POST scanBulkPlan（lines）
 *   サーバー：readScan(lines, todayJst()) ＋ planScanFiling（Web と同じ。読み方はサーバーの lib/receipt-read.ts だけ）
 *   iPad：確かめ・直し → POST scanBulkPlan（reading。直した内容で案を出し直す）／scanBulkFile（fileScan）
 */

/** 1回に選べるファイルの数（Web と同じ） */
export const SCAN_BULK_MAX_FILES = 50;
/** 読み取った行の上限（1ファイル。Web は最初の2ページだけ読む） */
export const SCAN_BULK_MAX_LINES = 3000;
const MAX_LINE_CHARS = 500;
const SHA256_RE = /^[0-9a-f]{64}$/;
const KINDS: ScanKind[] = ['receipt', 'bill'];
const CATEGORIES: BillCategory[] = ['rent', 'electric', 'water', 'gas', 'vendor'];
const PAYMENTS: PaymentMethod[] = ['cash', 'card', 'emoney', 'qr', 'transfer', 'debit'];
const ACTIONS: ScanAction[] = ['attach', 'receipt', 'bill', 'keep'];
/** iPad は HEIC・WebP を JPEG にしてから送る（scanUpload と同じ 3 種類） */
const UPLOAD_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type ScanUploadMime = (typeof UPLOAD_MIMES)[number];

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = <T>(error = '内容が正しくありません'): Parsed<T> => ({ ok: false, error });

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** 読み取った文字の行（文字列の配列。長すぎる行・多すぎる行は切る） */
export function parseScanLines(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .slice(0, SCAN_BULK_MAX_LINES)
    .map((l) => (typeof l === 'string' ? l.slice(0, MAX_LINE_CHARS) : ''));
}

const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * 画面で直した読み取り結果。形だけ確かめる（範囲・空白の整えはサーバーの planScanFiling・fileScan の cleanReading が Web と同じにする）
 */
export function parseScanReading(raw: unknown): ScanReading | null {
  const b = obj(raw);
  if (!b) return null;
  const kind = KINDS.includes(b.kind as ScanKind) ? (b.kind as ScanKind) : 'receipt';
  return {
    kind,
    category: CATEGORIES.includes(b.category as BillCategory) ? (b.category as BillCategory) : null,
    amount: intOrNull(b.amount),
    date: strOrNull(b.date),
    vendorName: strOrNull(b.vendorName),
    tax: intOrNull(b.tax),
    payment: PAYMENTS.includes(b.payment as PaymentMethod) ? (b.payment as PaymentMethod) : null,
  };
}

/** POST scanBulkCheck：取り込む前の重複チェック（checkScanDuplicate の引数） */
export function parseScanCheck(raw: unknown): Parsed<{ hash: string | null; fileName: string; sizeBytes: number }> {
  const b = obj(raw);
  if (!b) return bad();
  const hash = typeof b.hash === 'string' && SHA256_RE.test(b.hash) ? b.hash : null;
  const fileName = typeof b.fileName === 'string' ? b.fileName.slice(0, 255) : '';
  const sizeBytes = typeof b.sizeBytes === 'number' && Number.isFinite(b.sizeBytes) && b.sizeBytes > 0 ? Math.floor(b.sizeBytes) : 0;
  if (!fileName || sizeBytes <= 0) return bad();
  return { ok: true, value: { hash, fileName, sizeBytes } };
}

/** POST scanBulkPlan：読み取った行（はじめ）か、直した読み取り結果（出し直し）で登録先の案を出す */
export function parseScanPlan(raw: unknown): Parsed<{ documentId: string; lines: string[] | null; reading: ScanReading | null }> {
  const b = obj(raw);
  if (!b || !isUuid(b.documentId)) return bad('不正なIDです');
  const lines = b.lines !== undefined && b.lines !== null ? parseScanLines(b.lines) : null;
  const reading = b.reading !== undefined && b.reading !== null ? parseScanReading(b.reading) : null;
  if (!lines && !reading) return bad();
  return { ok: true, value: { documentId: b.documentId, lines, reading } };
}

/** POST scanBulkFile：確かめた内容で仕分ける（fileScan の引数） */
export function parseScanFile(raw: unknown): Parsed<{ documentId: string; reading: ScanReading; action: ScanAction; txId: string | null }> {
  const b = obj(raw);
  if (!b || !isUuid(b.documentId)) return bad('不正なIDです');
  const reading = parseScanReading(b.reading);
  if (!reading) return bad();
  if (!ACTIONS.includes(b.action as ScanAction)) return bad('登録先が正しくありません');
  if (b.txId != null && !isUuid(b.txId)) return bad('出金が正しくありません');
  return { ok: true, value: { documentId: b.documentId, reading, action: b.action as ScanAction, txId: (b.txId as string | null | undefined) ?? null } };
}

/** POST scanBulkUploadUrl：3MB を超えるファイルを保存ボックスへ直接上げる URL（Web がブラウザから直接上げるのと同じ） */
export function parseScanUploadMeta(raw: unknown): Parsed<{ fileName: string; mimeType: ScanUploadMime; sizeBytes: number }> {
  const b = obj(raw);
  if (!b) return bad();
  const fileName = typeof b.fileName === 'string' ? b.fileName.replace(/[\\/]/g, '_').slice(0, 255) : '';
  const mimeType = UPLOAD_MIMES.find((m) => m === b.mimeType);
  const sizeBytes = typeof b.sizeBytes === 'number' && Number.isFinite(b.sizeBytes) ? Math.floor(b.sizeBytes) : 0;
  if (!fileName) return bad('ファイル名が正しくありません');
  if (!mimeType) return bad('PDF・PNG・JPEGのみアップロードできます');
  if (sizeBytes <= 0) return bad('ファイルサイズが不正です');
  return { ok: true, value: { fileName, mimeType, sizeBytes } };
}

/** POST scanBulkRegister：直接上げたファイルを書類に登録（createScanDocument の引数。パスの確かめは createScanDocument がする） */
export function parseScanRegister(
  raw: unknown
): Parsed<{ path: string; fileName: string; mimeType: ScanUploadMime; sizeBytes: number; contentHash: string | null }> {
  const meta = parseScanUploadMeta(raw);
  if (!meta.ok) return meta;
  const b = raw as Record<string, unknown>;
  const path = typeof b.path === 'string' ? b.path : '';
  if (!path || path.length > 512 || path.includes('..')) return bad('不正なファイルパスです');
  if (b.contentHash != null && !(typeof b.contentHash === 'string' && SHA256_RE.test(b.contentHash))) return bad();
  return { ok: true, value: { ...meta.value, path, contentHash: (b.contentHash as string | null | undefined) ?? null } };
}

/** 確かめの画面の選択肢（Web の ConfirmCard と同じ並び・同じ名前。lib/receipt-read.ts） */
export function scanBulkOptions() {
  const opt = (p: PaymentMethod) => ({ value: p, label: PAYMENT_LABELS[p] });
  return {
    receiptPayments: SCAN_RECEIPT_PAYMENTS.map(opt),
    billPayments: SCAN_BILL_PAYMENTS.map(opt),
    categories: SCAN_BILL_CATEGORIES.map((c) => ({ value: c, label: BILL_CATEGORY_SHORT[c] })),
  };
}
