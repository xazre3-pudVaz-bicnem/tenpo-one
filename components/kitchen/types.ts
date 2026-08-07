/** KDS（キッチンディスプレイ）で使う型 */

export type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served';

/** menu_categories.station。品目が紐付かない（menu_item_id=null）場合は 'kitchen' 扱い */
export type Station = 'kitchen' | 'drink' | 'dessert';

export const STATION_LABELS: Record<Station, string> = {
  kitchen: 'キッチン',
  drink: 'ドリンク',
  dessert: 'デザート',
};

export type StationFilter = 'all' | Station;
export const STATION_FILTER_OPTIONS: StationFilter[] = ['all', 'kitchen', 'drink', 'dessert'];
export const STATION_FILTER_LABELS: Record<StationFilter, string> = {
  all: 'すべて',
  ...STATION_LABELS,
};

export interface KdsModifier {
  name: string;
  price: number;
}

export interface KdsItem {
  id: string;
  name: string;
  quantity: number;
  memo: string | null;
  modifiers: KdsModifier[];
  station: Station;
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

/** store_settings.kds_settings jsonb。警告しきい値（分）と表示モードを店舗単位で可変にする */
export interface KdsSettings {
  /** 0段階目→1段階目の境界（分） */
  warn1: number;
  /** 1段階目→2段階目の境界（分） */
  warn2: number;
  /** 2段階目→3段階目（最も危険）の境界（分） */
  warn3: number;
  /** 注文カード表示ではなく品目集約表示にするか */
  aggregate: boolean;
  /** 新規未着手品目の検知時にビープ音を鳴らすか */
  sound: boolean;
}

export const DEFAULT_KDS_SETTINGS: KdsSettings = { warn1: 10, warn2: 15, warn3: 25, aggregate: false, sound: false };

export type ElapsedTone = 'default' | 'info' | 'warning' | 'danger';

/** 経過時間としきい値設定から4段階の警告レベルを決める */
export function getElapsedTone(elapsedMinutes: number, settings: KdsSettings): ElapsedTone {
  if (elapsedMinutes >= settings.warn3) return 'danger';
  if (elapsedMinutes >= settings.warn2) return 'warning';
  if (elapsedMinutes >= settings.warn1) return 'info';
  return 'default';
}

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

/** 集約表示（「品目名 ×数量」）1行分。未提供品目のみを station×品目名×オプションでグループ化する */
export interface AggregatedKdsItem {
  key: string;
  name: string;
  modifiers: KdsModifier[];
  quantity: number;
  station: Station;
  oldestCreatedAt: string;
  itemIds: string[];
  pendingCount: number;
  preparingCount: number;
  readyCount: number;
}

export function aggregateKdsItems(groups: KdsOrderGroup[]): AggregatedKdsItem[] {
  const map = new Map<string, AggregatedKdsItem>();
  for (const g of groups) {
    for (const it of g.items) {
      if (it.kitchenStatus === 'served') continue;
      const modSignature = [...it.modifiers].map((m) => m.name).sort().join('+');
      const key = `${it.station}::${it.name}::${modSignature}`;
      let row = map.get(key);
      if (!row) {
        row = {
          key, name: it.name, modifiers: it.modifiers, quantity: 0, station: it.station,
          oldestCreatedAt: it.createdAt, itemIds: [], pendingCount: 0, preparingCount: 0, readyCount: 0,
        };
        map.set(key, row);
      }
      row.quantity += it.quantity;
      row.itemIds.push(it.id);
      if (new Date(it.createdAt).getTime() < new Date(row.oldestCreatedAt).getTime()) row.oldestCreatedAt = it.createdAt;
      if (it.kitchenStatus === 'pending') row.pendingCount += it.quantity;
      else if (it.kitchenStatus === 'preparing') row.preparingCount += it.quantity;
      else if (it.kitchenStatus === 'ready') row.readyCount += it.quantity;
    }
  }
  return [...map.values()].sort(
    (a, b) => new Date(a.oldestCreatedAt).getTime() - new Date(b.oldestCreatedAt).getTime()
  );
}
