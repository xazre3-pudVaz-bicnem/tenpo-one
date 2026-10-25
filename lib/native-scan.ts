import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの「スキャン」（レシート撮影。Web の /app/scan と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=scan&type&tx、保存は POST { type: 'scanUpload', … }。
 * Web はブラウザから Storage へ直接上げてから createScanDocument を呼ぶ。アプリは写真（JPEG）を本文で送り、
 * サーバーが同じ場所（documents バケットの 組織/店舗/年/月/…）へ上げてから同じ Server Action を呼ぶ。
 * ScanSnap のまとめて取り込み（NativeScanBulkView。2026-10-25）も同じ scanUpload で上げる：
 * PDF も可・中身の SHA-256（contentHash）を書類に入れる・その日のフォルダ（dayFolder＝…/年/月/日/。Web の ScanBulkImport と同じ）。
 */

/** 1枚の上限。Vercel の本文の上限（4.5MB）より小さく、Base64 で 4/3 倍になる分を見込む */
export const NATIVE_SCAN_MAX_BYTES = 3_000_000;

export type NativeScanAction = {
  type: 'scanUpload';
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  dataBase64: string;
  txId: string | null;
  /** ファイルの中身の SHA-256（まとめて取り込み。同じファイルの取り込み防止。documents.content_hash）。撮影は null */
  contentHash: string | null;
  /** その日のフォルダ（…/年/月/日/。日付は JST）に入れる（まとめて取り込み）。撮影は false（…/年/月/） */
  dayFolder: boolean;
};

export function isNativeScanActionType(v: unknown): v is NativeScanAction['type'] {
  return v === 'scanUpload';
}

const MIMES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function parseNativeScanAction(raw: unknown): { ok: true; action: NativeScanAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if (b.type !== 'scanUpload') return { ok: false, error: '内容が正しくありません' };
  if (!MIMES.includes(b.mimeType as (typeof MIMES)[number])) return { ok: false, error: 'PDF・PNG・JPEGのみアップロードできます' };
  if (typeof b.dataBase64 !== 'string' || b.dataBase64.length === 0 || !/^[A-Za-z0-9+/=\r\n]+$/.test(b.dataBase64)) return { ok: false, error: '写真が正しくありません' };
  if (Math.floor((b.dataBase64.length * 3) / 4) > NATIVE_SCAN_MAX_BYTES + 4) return { ok: false, error: '写真が大きすぎます（3MBまで）' };
  const fileName = typeof b.fileName === 'string' ? b.fileName.replace(/[\\/]/g, '_').slice(0, 120) : '';
  if (!fileName) return { ok: false, error: 'ファイル名が正しくありません' };
  if (b.txId != null && !isUuid(b.txId)) return { ok: false, error: '出金が正しくありません' };
  if (b.contentHash != null && !(typeof b.contentHash === 'string' && SHA256_RE.test(b.contentHash))) return { ok: false, error: '内容が正しくありません' };
  return {
    ok: true,
    action: {
      type: 'scanUpload',
      fileName,
      mimeType: b.mimeType as NativeScanAction['mimeType'],
      dataBase64: b.dataBase64,
      txId: (b.txId as string | null | undefined) ?? null,
      contentHash: (b.contentHash as string | null | undefined) ?? null,
      dayFolder: b.dayFolder === true,
    },
  };
}

function extOf(mimeType: NativeScanAction['mimeType']): string {
  return mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
}

/** 保存先のパス（Web の ScanCapture と同じ形：組織/店舗|hq/年/月/uuid.拡張子） */
export function nativeScanPath(organizationId: string, storeId: string | null, mimeType: NativeScanAction['mimeType'], uuid: string, now = new Date()): string {
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${organizationId}/${storeId ?? 'hq'}/${yyyy}/${mm}/${uuid}.${extOf(mimeType)}`;
}

/**
 * まとめて取り込みの保存先（Web の ScanBulkImport と同じ形：組織/店舗|hq/年/月/日/uuid.拡張子）。
 * day は JST の 'YYYY-MM-DD'（その日のフォルダ。何回に分けて取り込んでも同じ日なら同じフォルダ）
 */
export function nativeScanDayPath(organizationId: string, storeId: string | null, mimeType: NativeScanAction['mimeType'], uuid: string, day: string): string {
  const [y, m, d] = day.split('-');
  return `${organizationId}/${storeId ?? 'hq'}/${y}/${m}/${d}/${uuid}.${extOf(mimeType)}`;
}
