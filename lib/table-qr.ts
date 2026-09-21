import QRCode from 'qrcode';

/**
 * テーブルのお客様QR（/order/<店舗>/<トークン>）の作り方。
 * 2026-09-21 店舗報告「QRコードが読み取れない卓がある」を受けて、読み取りやすさ優先にした:
 *   - 周りの白（クワイエットゾーン）を QR の規格どおり 4マス（これまで 1マスで、切り取りや台紙の色で読めないことがある）
 *   - 誤り訂正は M（URL が長いので、H にすると目が細かくなって小さく印刷したときに読みにくい）
 */
export const TABLE_QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 4 } as const;

/** お客様の注文ページの URL */
export function tableOrderUrl(origin: string, storeSlug: string, qrToken: string): string {
  return `${origin.replace(/\/+$/, '')}/order/${storeSlug}/${qrToken}`;
}

/** 画面表示・印刷用の QR 画像（PNG の data URL） */
export function tableQrDataUrl(url: string, width = 480): Promise<string> {
  return QRCode.toDataURL(url, { ...TABLE_QR_OPTIONS, width });
}
