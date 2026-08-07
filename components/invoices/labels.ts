/** 請求書・書類・仕入・在庫モジュール共通の表示ラベル定義 */
import type { BadgeTone } from '@/components/ui/badge';

export type InvoiceStatus =
  | 'open' | 'review' | 'pending_approval' | 'approved' | 'scheduled' | 'paid' | 'rejected';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  open: '未処理',
  review: '確認待ち',
  pending_approval: '承認待ち',
  approved: '承認済み',
  scheduled: '支払予定',
  paid: '支払済み',
  rejected: '差戻し',
};

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, BadgeTone> = {
  open: 'gray',
  review: 'warning',
  pending_approval: 'navy',
  approved: 'primary',
  scheduled: 'primary',
  paid: 'success',
  rejected: 'danger',
};

export const INVOICE_STATUS_OPTIONS: InvoiceStatus[] = [
  'open', 'review', 'pending_approval', 'approved', 'scheduled', 'paid', 'rejected',
];

/** 未払（支払完了・差戻し以外）とみなすステータス。期限超過・未払合計の判定に使う */
export const UNPAID_INVOICE_STATUSES: InvoiceStatus[] = [
  'open', 'review', 'pending_approval', 'approved', 'scheduled',
];

export type DocType =
  | 'invoice' | 'receipt' | 'register_receipt' | 'delivery_note'
  | 'purchase_order' | 'quotation' | 'contract' | 'other';

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  invoice: '請求書',
  receipt: '領収書',
  register_receipt: 'レジ控え',
  delivery_note: '納品書',
  purchase_order: '発注書',
  quotation: '見積書',
  contract: '契約書',
  other: 'その他',
};

/** 仕分け時に選択できる種別（レジ控えはPOSからの自動発生想定のため除外） */
export const TRIAGE_DOC_TYPE_OPTIONS: DocType[] = [
  'invoice', 'receipt', 'delivery_note', 'purchase_order', 'quotation', 'contract', 'other',
];

export type PaymentMethod = 'bank_transfer' | 'cash' | 'credit' | 'direct_debit' | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: '銀行振込',
  cash: '現金',
  credit: 'クレジット',
  direct_debit: '口座振替',
  other: 'その他',
};

export const PAYMENT_METHOD_OPTIONS: PaymentMethod[] = [
  'bank_transfer', 'cash', 'credit', 'direct_debit', 'other',
];

export const ACCEPTED_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
export const ACCEPTED_FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
export const ACCEPTED_FILE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/** 拡張子偽装（二重拡張子等）対策のため明示的に拒否するもの */
export const DANGEROUS_EXTENSIONS = [
  'exe', 'js', 'mjs', 'cjs', 'html', 'htm', 'php', 'sh', 'bat', 'cmd', 'vbs', 'msi', 'ps1', 'jar', 'com', 'scr', 'app',
];

export function extFromFile(file: { name: string; type: string }): string {
  const fromName = file.name.split('.').pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  return map[file.type] ?? 'bin';
}

/** クライアント側の一次検証（UXのための即時フィードバック用） */
export function validateAttachedFile(file: { name: string; type: string; size: number }): string | null {
  if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
    return 'PDF・PNG・JPEG・WebPのみアップロードできます';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'ファイルサイズは20MBまでです';
  }
  return null;
}

/**
 * サーバー側でのアップロードメタ再検証（クライアント検証はバイパスされうるため必須）。
 * MIME・拡張子・サイズ・危険拡張子（二重拡張子含む）をチェックする。
 */
export function validateUploadMeta(input: { fileName: string; mimeType: string; sizeBytes: number }): string | null {
  const parts = input.fileName.toLowerCase().split('.');
  const ext = parts.length > 1 ? parts[parts.length - 1] : '';
  if (!ext || DANGEROUS_EXTENSIONS.some((d) => parts.includes(d))) {
    return 'このファイル形式はアップロードできません';
  }
  if (!ACCEPTED_FILE_EXTENSIONS.includes(ext)) {
    return '許可されていない拡張子です（PDF・PNG・JPEG・WebPのみ）';
  }
  if (!ACCEPTED_FILE_TYPES.includes(input.mimeType)) {
    return 'PDF・PNG・JPEG・WebPのみアップロードできます';
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return 'ファイルサイズが不正です';
  }
  if (input.sizeBytes > MAX_FILE_SIZE) {
    return 'ファイルサイズは20MBまでです';
  }
  return null;
}

export type OcrStatus = 'none' | 'pending' | 'done' | 'failed';

export const OCR_STATUS_LABELS: Record<OcrStatus, string> = {
  none: '未実行',
  pending: '解析中',
  done: '読取済（モック）',
  failed: '失敗',
};

export const OCR_STATUS_TONES: Record<OcrStatus, BadgeTone> = {
  none: 'gray',
  pending: 'warning',
  done: 'success',
  failed: 'danger',
};
