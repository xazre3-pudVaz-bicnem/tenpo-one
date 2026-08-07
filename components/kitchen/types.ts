/** KDS（キッチンディスプレイ）で使う型 */

export type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served';

export interface KdsItem {
  id: string;
  name: string;
  quantity: number;
  memo: string | null;
  kitchenStatus: KitchenStatus;
  createdAt: string;
}

export interface KdsOrderGroup {
  orderId: string;
  orderNo: number;
  tableName: string | null;
  orderSource: 'pos' | 'qr' | 'online';
  /** この注文グループの基準時刻（ISO）。未提供品目のうち最も古いものの注文時刻。
   * 全品提供済の場合（「提供済を表示」時）は全品目のうち最も古い注文時刻を使う。 */
  orderTime: string;
  items: KdsItem[];
}

/** 経過時間のしきい値（分）。ここを超えるとカードの警告色が変わる */
export const KDS_WARNING_MINUTES = 15;
export const KDS_DANGER_MINUTES = 25;

export const ORDER_SOURCE_LABELS: Record<KdsOrderGroup['orderSource'], string> = {
  pos: 'POS',
  qr: 'QR',
  online: 'オンライン',
};

export const KITCHEN_STATUS_LABELS: Record<KitchenStatus, string> = {
  pending: '未着手',
  preparing: '調理中',
  ready: '完成',
  served: '提供済',
};
