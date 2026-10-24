import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの「テーブルQRコード」（Web の 設定 > テーブル > QR印刷 と、各卓の「QRコード」ダイアログ。2026-10-24
 * Ronnie「QR印刷・再発行をネイティブに」）。
 * 読み込みは GET /api/app/v1/pos?part=tableQr、操作は POST { type: 'tableQrRegenerate' | 'tableQrStop', tableId }。
 * 印刷物（名刺 10面／A6 4面の A4 PDF）は iPad の中で描く（ios/Shared/NativeTableQrView.swift）。サーバーは卓と URL を返すだけ。
 */
export type NativeTableQrAction =
  /** トークンを再発行する（今までの QR は使えなくなる。止めていた卓はこれで再開） */
  | { type: 'tableQrRegenerate'; tableId: string }
  /** QR注文を止める（qr_token を null に。再開は再発行） */
  | { type: 'tableQrStop'; tableId: string };
export type NativeTableQrActionType = NativeTableQrAction['type'];
export const NATIVE_TABLE_QR_ACTION_TYPES: readonly NativeTableQrActionType[] = ['tableQrRegenerate', 'tableQrStop'];

export function isNativeTableQrActionType(v: unknown): v is NativeTableQrActionType {
  return typeof v === 'string' && (NATIVE_TABLE_QR_ACTION_TYPES as readonly string[]).includes(v);
}

export function parseNativeTableQrAction(raw: unknown): { ok: true; action: NativeTableQrAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if ((b.type === 'tableQrRegenerate' || b.type === 'tableQrStop') && isUuid(b.tableId)) {
    return { ok: true, action: { type: b.type, tableId: b.tableId } };
  }
  return { ok: false, error: '内容が正しくありません' };
}

export interface NativeTableQrTable {
  id: string;
  name: string;
  /** お客様の注文ページの URL（QR の中身）。QR を止めている卓は null */
  url: string | null;
}

export interface NativeTableQrPayload {
  store: { id: string; name: string };
  tables: NativeTableQrTable[];
  /**
   * 再発行・停止ができるか。レジ端末のアカウント（register_device）からは Web と同じく不可
   * （lib/admin-only-settings.ts の ADMIN_ONLY_SETTINGS_NOTE）
   */
  canEdit: boolean;
  /** できないときに出す言葉 */
  editNote: string | null;
}
