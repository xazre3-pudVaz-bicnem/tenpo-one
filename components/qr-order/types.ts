/**
 * QRオーダー（/order/[storeSlug]/[tableToken]）で使う型。
 * RPC get_qr_menu / create_qr_order / get_qr_order_status の戻り値と一致させる。
 */

export interface QrMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  is_sold_out: boolean;
}

export interface QrMenuCategory {
  id: string;
  name: string;
  color: string | null;
  items: QrMenuItem[];
}

export interface QrMenuData {
  store_name: string;
  table_name: string;
  categories: QrMenuCategory[];
}

export type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served';

export interface QrOrderStatusItem {
  name: string;
  quantity: number;
  kitchen_status: KitchenStatus;
  ordered_at: string; // 'HH:MM'（JST）
}

export interface QrOrderStatus {
  table_name: string;
  items: QrOrderStatusItem[];
  total: number;
}

/** カート内の1行。同一商品でもメモが異なれば別行として扱う */
export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  memo: string;
}

export const KITCHEN_STATUS_LABELS: Record<KitchenStatus, string> = {
  pending: '未着手',
  preparing: '調理中',
  ready: '完成',
  served: '提供済',
};

const QR_ERROR_MESSAGES: Record<string, string> = {
  TABLE_NOT_FOUND: 'テーブル情報を確認できませんでした。QRコードを読み取り直してください。',
  EMPTY_ORDER: 'カートに商品がありません。',
  TOO_MANY_ITEMS: '一度に注文できる品数の上限を超えています。数回に分けてご注文ください。',
  RATE_LIMITED: '短時間にご注文が集中しました。少し時間をおいてから再度お試しください。',
  INVALID_QUANTITY: '数量の指定が正しくありません。',
  ITEM_UNAVAILABLE: '一部の商品が販売終了・品切れになりました。内容をご確認のうえ再度お試しください。',
};

/** RPC のエラーメッセージ（Postgres RAISE EXCEPTION の文言）を日本語表示に変換する */
export function qrOrderErrorMessage(raw: string | null | undefined): string {
  if (!raw) return '通信エラーが発生しました。時間をおいて再度お試しください。';
  const code = raw.split(':')[0].trim();
  return QR_ERROR_MESSAGES[code] ?? '注文の送信に失敗しました。時間をおいて再度お試しください。';
}
