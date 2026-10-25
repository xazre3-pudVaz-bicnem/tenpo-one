/**
 * テーブルQR（お客様の QR 注文）の ON/OFF — コントロールセンター（運営コンソール /admin）から店舗ごとに決める。
 * 2026-10-25 14:38 Ronnie「table qr code on off sabai control centre bata deu hai」
 *
 *   企業: feature_flags（organization_id, flag_key = 'qr_order', enabled = false）で企業ぜんぶ OFF（今まで通り。/admin/feature-flags）
 *   店舗: store_feature_flags（store_id, flag_key = 'qr_order', enabled = false）でその店舗だけ OFF（migration 00103 の表）
 *   どちらも「行が無い＝ON」（今 QR 注文を使っている店舗は何もしなくても ON のまま）。
 *   注文の作成は DB でも止める（00032 のトリガー。店舗の OFF は migration 00104 から）。
 *
 * 純粋な関数だけ（テスト対象）。DB は lib/qr-order-flag-server.ts。
 */

export const QR_ORDER_FLAG = 'qr_order';

export type QrOrderFlagReason = 'on' | 'company_off' | 'store_off';

export interface QrOrderFlagState {
  on: boolean;
  reason: QrOrderFlagReason;
}

/**
 * orgEnabled: 企業の行の enabled（行が無ければ null）
 * storeEnabled: 店舗の行の enabled（行が無い・表が無い（migration 00103 の前）なら null）
 */
export function resolveQrOrderFlag(input: { orgEnabled: boolean | null; storeEnabled: boolean | null }): QrOrderFlagState {
  if (input.orgEnabled === false) return { on: false, reason: 'company_off' };
  if (input.storeEnabled === false) return { on: false, reason: 'store_off' };
  return { on: true, reason: 'on' };
}

/** お客様に出す文 */
export const QR_ORDER_OFF_MESSAGE = 'この店舗では QR 注文を受け付けていません';
export const QR_ORDER_OFF_HINT = 'ご注文はスタッフにお声がけください。';

/** 店舗の管理画面に出す文（運営が止めているとき） */
export const QR_ORDER_OFF_STORE_NOTE: Record<Exclude<QrOrderFlagReason, 'on'>, string> = {
  company_off: 'テーブルQR（お客様の QR 注文）は TENPO ONE 運営で停止しています（企業ぜんぶ）。再開は TENPO ONE 運営へご連絡ください',
  store_off: 'テーブルQR（お客様の QR 注文）は TENPO ONE 運営で停止しています（この店舗）。再開は TENPO ONE 運営へご連絡ください',
};

/** 運営コンソールに出す説明 */
export const QR_ORDER_ADMIN_NOTE: Record<QrOrderFlagReason, string> = {
  on: '受け付け中',
  company_off: '企業ぜんぶ OFF（機能フラグ qr_order）',
  store_off: 'この店舗は OFF',
};
