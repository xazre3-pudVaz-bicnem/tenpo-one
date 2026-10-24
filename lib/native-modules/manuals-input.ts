/**
 * マニュアル（/app/manuals）の iPad ネイティブの入力の確かめ（純粋な関数。テストは tests/native-reports-tasks-manuals.test.ts）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 *
 * Web はブラウザから Storage（documents バケット）へ直接上げてから createManual を呼ぶ。アプリはファイル（写真は JPEG・PDF はそのまま）を
 * 本文の Base64 で送り、サーバーが同じ場所（組織/manuals/uuid.拡張子）へ上げてから同じ Server Action を呼ぶ（スキャンと同じ形）。
 */
import { MANUAL_CATEGORIES, type ManualCategory } from '@/app/app/manuals/labels';

/** 1ファイルの上限（Vercel の本文の上限 4.5MB に Base64 の 4/3 倍が入るように。スキャンの NATIVE_SCAN_MAX_BYTES と同じ 3MB） */
export const NATIVE_MANUAL_MAX_BYTES = 3_000_000;

export const NATIVE_MANUAL_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type NativeManualMime = (typeof NATIVE_MANUAL_MIMES)[number];

const MAX_TITLE = 200;
const MAX_NOTE = 2_000;
const MAX_URL = 2_000;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = <T>(error = '内容が正しくありません'): Parsed<T> => ({ ok: false, error });

export interface NativeManualCreate {
  title: string;
  category: ManualCategory;
  /** store = 今の店舗のみ、all = 全店共通（本社管理者だけ） */
  target: 'store' | 'all';
  note: string | null;
  source: { kind: 'url'; url: string } | { kind: 'file'; fileName: string; mimeType: NativeManualMime; dataBase64: string };
}

/** POST manualCreate { title, category, target, mode: 'file'|'url', url?, note?, fileName?, mimeType?, dataBase64? } */
export function parseManualCreate(raw: Record<string, unknown>): Parsed<NativeManualCreate> {
  if (typeof raw.title !== 'string' || !raw.title.trim()) return bad('タイトルを入力してください');
  if (raw.title.length > MAX_TITLE) return bad(`タイトルは${MAX_TITLE}文字までです`);
  if (!(MANUAL_CATEGORIES as readonly string[]).includes(raw.category as string)) return bad('カテゴリが正しくありません');
  if (raw.target !== 'store' && raw.target !== 'all') return bad('対象が正しくありません');
  if (raw.note != null && typeof raw.note !== 'string') return bad('メモが正しくありません');
  if (typeof raw.note === 'string' && raw.note.length > MAX_NOTE) return bad('メモが長すぎます');
  const base = {
    title: raw.title,
    category: raw.category as ManualCategory,
    target: raw.target as 'store' | 'all',
    note: typeof raw.note === 'string' && raw.note !== '' ? raw.note : null,
  };

  if (raw.mode === 'url') {
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (!url) return bad('URLを入力してください');
    if (url.length > MAX_URL || !/^https?:\/\/[^\s]+$/i.test(url)) return bad('URLは https:// から入力してください');
    return { ok: true, value: { ...base, source: { kind: 'url', url } } };
  }
  if (raw.mode !== 'file') return bad();

  if (!(NATIVE_MANUAL_MIMES as readonly string[]).includes(raw.mimeType as string)) return bad('対応形式は PDF・PNG・JPEG・WebP です');
  const b64 = raw.dataBase64;
  if (typeof b64 !== 'string' || b64.length === 0 || !/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) return bad('ファイルを選択してください');
  if (Math.floor((b64.length * 3) / 4) > NATIVE_MANUAL_MAX_BYTES + 4) return bad('ファイルが大きすぎます（iPad からは3MBまで）');
  const mimeType = raw.mimeType as NativeManualMime;
  const fileName = typeof raw.fileName === 'string' ? manualFileName(raw.fileName, mimeType) : '';
  if (!fileName) return bad('ファイル名が正しくありません');
  return { ok: true, value: { ...base, source: { kind: 'file', fileName, mimeType, dataBase64: b64 } } };
}

/** 形式ごとの拡張子（保存先のパス・ファイル名の終わり） */
export function manualExt(mimeType: NativeManualMime): string {
  return mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
}

/**
 * 送られてきたファイル名を整える（/ と \ は _ に・長すぎるものは後ろを残す）。拡張子が形式と合わなければ足す
 * （Web と同じ validateUploadMeta は拡張子も見る。iPad の写真は .HEIC や名前なしのことがあるので）
 */
export function manualFileName(name: string, mimeType: NativeManualMime): string {
  const clean = name.replace(/[\\/]/g, '_').trim();
  if (!clean) return '';
  const ext = clean.includes('.') ? (clean.split('.').pop() ?? '').toLowerCase() : '';
  const okExts = mimeType === 'image/jpeg' ? ['jpg', 'jpeg'] : [manualExt(mimeType)];
  const withExt = okExts.includes(ext) ? clean : `${clean}.${manualExt(mimeType)}`;
  return withExt.slice(-120);
}

/** 保存先のパス（Web の ManualForm と同じ形：組織/manuals/uuid.拡張子） */
export function manualUploadPath(organizationId: string, uuid: string, mimeType: NativeManualMime): string {
  return `${organizationId}/manuals/${uuid}.${manualExt(mimeType)}`;
}

/** 添付ファイルの見せ方（パスの拡張子から。iPad は PDF を PDFKit、画像をそのまま出す） */
export function manualFileKind(path: string): 'pdf' | 'image' | 'other' {
  const ext = (path.split('?')[0].split('.').pop() ?? '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext)) return 'image';
  return 'other';
}
