/** 仕入先・発注・在庫モジュール共通の表示ラベル定義 */
import type { BadgeTone } from '@/components/ui/badge';

export type ItemKind = 'ingredient' | 'supply' | 'product';

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  ingredient: '食材',
  supply: '備品・消耗品',
  product: '商品（販売連動）',
};

export const ITEM_KIND_OPTIONS: ItemKind[] = ['ingredient', 'supply', 'product'];

export type MovementType =
  | 'in' | 'out' | 'waste' | 'return' | 'transfer_in' | 'transfer_out' | 'count_adjust' | 'sale';

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  in: '入庫',
  out: '出庫',
  waste: '廃棄',
  return: '返品',
  transfer_in: '移動入庫',
  transfer_out: '移動出庫',
  count_adjust: '棚卸調整',
  sale: '販売',
};

/** 「入出庫」ダイアログで選択可能な種別 */
export type ManualMovementType = 'in' | 'out' | 'waste' | 'count_adjust';
export const MANUAL_MOVEMENT_OPTIONS: ManualMovementType[] = ['in', 'out', 'waste', 'count_adjust'];

/** 理由入力が必須の種別（out/waste/count_adjust）。クライアント・サーバーの双方で同じ判定を使う */
export function movementNeedsReason(type: ManualMovementType): boolean {
  return type === 'out' || type === 'waste' || type === 'count_adjust';
}

export const PO_STATUS_LABELS = {
  draft: '下書き',
  requested: '承認待ち',
  approved: '承認済み',
  ordered: '発注済み',
  partially_received: '一部入荷',
  received: '入荷済み',
  cancelled: '取消',
} as const;

export type PoStatus = keyof typeof PO_STATUS_LABELS;

export const PO_STATUS_TONES: Record<PoStatus, BadgeTone> = {
  draft: 'gray',
  requested: 'warning',
  approved: 'primary',
  ordered: 'primary',
  partially_received: 'warning',
  received: 'success',
  cancelled: 'danger',
};

export const PO_STATUS_OPTIONS: PoStatus[] = [
  'draft', 'requested', 'approved', 'ordered', 'partially_received', 'received', 'cancelled',
];

export type TransferStatus = 'requested' | 'shipped' | 'received' | 'cancelled';
export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  requested: '申請中',
  shipped: '発送済み',
  received: '受取済み',
  cancelled: '取消',
};
export const TRANSFER_STATUS_TONES: Record<TransferStatus, BadgeTone> = {
  requested: 'warning',
  shipped: 'primary',
  received: 'success',
  cancelled: 'gray',
};

export type CountStatus = 'draft' | 'completed';
export const COUNT_STATUS_LABELS: Record<CountStatus, string> = {
  draft: '入力中',
  completed: '確定済み',
};
export const COUNT_STATUS_TONES: Record<CountStatus, BadgeTone> = {
  draft: 'warning',
  completed: 'success',
};

export const VENDOR_STATUS_LABELS: Record<string, string> = {
  active: '取引中',
  inactive: '休止',
  deleted: '削除済み',
};

/** 発注明細の消費税率（%） */
export const TAX_RATE_OPTIONS = [10, 8] as const;
export type TaxRate = (typeof TAX_RATE_OPTIONS)[number];

/** 在庫の警告レベル。danger=最低在庫以下、warning=発注点以下、null=通常 */
export type StockWarningLevel = 'danger' | 'warning' | null;

export const STOCK_WARNING_LABELS: Record<'danger' | 'warning', string> = {
  danger: '在庫切れ間近',
  warning: '要発注',
};

export const STOCK_WARNING_TONES: Record<'danger' | 'warning', BadgeTone> = {
  danger: 'danger',
  warning: 'warning',
};

export function stockWarningLevel(row: {
  currentQuantity: number;
  minQuantity: number | null;
  reorderPoint: number | null;
}): StockWarningLevel {
  if (row.minQuantity != null && row.currentQuantity <= row.minQuantity) return 'danger';
  if (row.reorderPoint != null && row.currentQuantity <= row.reorderPoint) return 'warning';
  return null;
}
