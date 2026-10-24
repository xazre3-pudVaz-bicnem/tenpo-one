import { isUuid } from '@/lib/native-pos';
import { ITEM_KIND_OPTIONS, MANUAL_MOVEMENT_OPTIONS, type ItemKind, type ManualMovementType } from '@/components/inventory/labels';

/**
 * iPad アプリのネイティブの「在庫」（Web の /app/inventory と同じ。2026-10-24）。
 * 読み込みは GET /api/app/v1/pos?part=inventory&tab=…（ほかに inventoryCount・inventoryHistory・inventoryPurchases）、
 * 操作は POST { type: 'inv…', … }。中身は Web と同じ Server Action（app/app/inventory/actions.ts）を呼ぶだけ。
 */

export type NativeInventoryAction =
  | {
      type: 'invItemCreate';
      name: string;
      itemKind: ItemKind;
      category: string | null;
      unit: string;
      initialQuantity: number;
      reorderPoint: number | null;
      minQuantity: number | null;
      optimalQuantity: number | null;
      avgCost: number | null;
      purchaseUnit: string | null;
      purchaseToStockFactor: number;
    }
  | {
      type: 'invItemUpdate';
      id: string;
      name: string;
      itemKind: ItemKind;
      category: string | null;
      unit: string;
      reorderPoint: number | null;
      minQuantity: number | null;
      optimalQuantity: number | null;
      purchaseUnit: string | null;
      purchaseToStockFactor: number;
    }
  | { type: 'invMovement'; itemId: string; movementType: ManualMovementType; quantity: number; reason: string | null; unitCost: number | null }
  | { type: 'invCountStart' }
  | { type: 'invCountSave'; countId: string; entries: { id: string; countedQuantity: number }[]; finalize: boolean }
  | { type: 'invTransferDirect'; fromItemId: string; toStoreId: string; quantity: number; reason: string | null }
  | { type: 'invTransferRequest'; toStoreId: string; note: string | null; lines: { inventoryItemId: string; quantity: number }[] }
  | { type: 'invTransferShip'; id: string }
  | { type: 'invTransferReceive'; id: string }
  | { type: 'invTransferCancel'; id: string; reason: string };

const TYPES = [
  'invItemCreate',
  'invItemUpdate',
  'invMovement',
  'invCountStart',
  'invCountSave',
  'invTransferDirect',
  'invTransferRequest',
  'invTransferShip',
  'invTransferReceive',
  'invTransferCancel',
] as const;

export function isNativeInventoryActionType(v: unknown): v is NativeInventoryAction['type'] {
  return TYPES.includes(v as (typeof TYPES)[number]);
}

/** 品目・入出庫・棚卸は inventory.write、店舗間移動は vendors.manage（Web の Server Action と同じ） */
export function nativeInventoryPermission(type: NativeInventoryAction['type']): 'inventory.write' | 'vendors.manage' {
  return type.startsWith('invTransfer') ? 'vendors.manage' : 'inventory.write';
}

const MAX_QTY = 1_000_000_000;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optText = (v: unknown, max: number) => {
  const t = text(v, max);
  return t ? t : null;
};
/** 0 以上の数（空・null は null）。おかしな値は undefined */
const optNum = (v: unknown): number | null | undefined => {
  if (v == null || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_QTY) return undefined;
  return v;
};

type R = { ok: true; action: NativeInventoryAction } | { ok: false; error: string };

function itemFields(b: Record<string, unknown>) {
  const name = text(b.name, 120);
  if (!name) return { error: '名前を入力してください' } as const;
  if (!ITEM_KIND_OPTIONS.includes(b.itemKind as ItemKind)) return { error: '種別が正しくありません' } as const;
  const reorderPoint = optNum(b.reorderPoint);
  const minQuantity = optNum(b.minQuantity);
  const optimalQuantity = optNum(b.optimalQuantity);
  if (reorderPoint === undefined || minQuantity === undefined || optimalQuantity === undefined) {
    return { error: '数量を正しく入力してください' } as const;
  }
  const factor = b.purchaseToStockFactor;
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0 || factor > MAX_QTY) {
    return { error: '変換係数は正の数で入力してください' } as const;
  }
  return {
    fields: {
      name,
      itemKind: b.itemKind as ItemKind,
      category: optText(b.category, 60),
      unit: text(b.unit, 20) || '個',
      reorderPoint,
      minQuantity,
      optimalQuantity,
      purchaseUnit: optText(b.purchaseUnit, 20),
      purchaseToStockFactor: factor,
    },
  } as const;
}

export function parseNativeInventoryAction(raw: unknown): R {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'invItemCreate': {
      const f = itemFields(b);
      if ('error' in f) return { ok: false, error: f.error as string };
      const initialQuantity = optNum(b.initialQuantity);
      const avgCost = optNum(b.avgCost);
      if (initialQuantity === undefined || avgCost === undefined) return { ok: false, error: '数量を正しく入力してください' };
      return { ok: true, action: { type: 'invItemCreate', ...f.fields, initialQuantity: initialQuantity ?? 0, avgCost } };
    }
    case 'invItemUpdate': {
      if (!isUuid(b.id)) return { ok: false, error: '品目が見つかりません' };
      const f = itemFields(b);
      if ('error' in f) return { ok: false, error: f.error as string };
      return { ok: true, action: { type: 'invItemUpdate', id: b.id as string, ...f.fields } };
    }
    case 'invMovement': {
      if (!isUuid(b.itemId)) return { ok: false, error: '品目が見つかりません' };
      if (!MANUAL_MOVEMENT_OPTIONS.includes(b.movementType as ManualMovementType)) return { ok: false, error: '種別が正しくありません' };
      const q = b.quantity;
      if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q > MAX_QTY) return { ok: false, error: '数量を正しく入力してください' };
      const unitCost = optNum(b.unitCost);
      if (unitCost === undefined) return { ok: false, error: '単価を正しく入力してください' };
      if (b.movementType === 'in' && unitCost == null) return { ok: false, error: '単価を正しく入力してください' };
      return {
        ok: true,
        action: { type: 'invMovement', itemId: b.itemId as string, movementType: b.movementType as ManualMovementType, quantity: q, reason: optText(b.reason, 500), unitCost },
      };
    }
    case 'invCountStart':
      return { ok: true, action: { type: 'invCountStart' } };
    case 'invCountSave': {
      if (!isUuid(b.countId)) return { ok: false, error: '棚卸が見つかりません' };
      if (!Array.isArray(b.entries) || b.entries.length > 5000) return { ok: false, error: '実数が正しくありません' };
      const entries: { id: string; countedQuantity: number }[] = [];
      for (const e of b.entries) {
        const r = e as Record<string, unknown>;
        if (!r || !isUuid(r.id)) return { ok: false, error: '実数が正しくありません' };
        const n = r.countedQuantity;
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_QTY) return { ok: false, error: '実数が正しくありません' };
        entries.push({ id: r.id as string, countedQuantity: n });
      }
      return { ok: true, action: { type: 'invCountSave', countId: b.countId as string, entries, finalize: b.finalize === true } };
    }
    case 'invTransferDirect': {
      if (!isUuid(b.fromItemId)) return { ok: false, error: '移動元の品目が見つかりません' };
      if (!isUuid(b.toStoreId)) return { ok: false, error: '移動先店舗を選択してください' };
      const q = b.quantity;
      if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q > MAX_QTY) return { ok: false, error: '数量は正の値で入力してください' };
      return { ok: true, action: { type: 'invTransferDirect', fromItemId: b.fromItemId as string, toStoreId: b.toStoreId as string, quantity: q, reason: optText(b.reason, 500) } };
    }
    case 'invTransferRequest': {
      if (!isUuid(b.toStoreId)) return { ok: false, error: '移動先店舗を選択してください' };
      if (!Array.isArray(b.lines) || b.lines.length > 200) return { ok: false, error: '品目を1件以上選択してください' };
      const lines: { inventoryItemId: string; quantity: number }[] = [];
      for (const l of b.lines) {
        const r = l as Record<string, unknown>;
        if (!r || !isUuid(r.inventoryItemId)) return { ok: false, error: '品目が正しくありません' };
        const q = r.quantity;
        if (typeof q !== 'number' || !Number.isFinite(q) || q < 0 || q > MAX_QTY) return { ok: false, error: '数量を正しく入力してください' };
        lines.push({ inventoryItemId: r.inventoryItemId as string, quantity: q });
      }
      return { ok: true, action: { type: 'invTransferRequest', toStoreId: b.toStoreId as string, note: optText(b.note, 500), lines } };
    }
    case 'invTransferShip':
    case 'invTransferReceive':
      if (!isUuid(b.id)) return { ok: false, error: '移動が見つかりません' };
      return { ok: true, action: { type: b.type, id: b.id as string } };
    case 'invTransferCancel': {
      if (!isUuid(b.id)) return { ok: false, error: '移動が見つかりません' };
      const reason = text(b.reason, 500);
      if (!reason) return { ok: false, error: '理由を入力してください' };
      return { ok: true, action: { type: 'invTransferCancel', id: b.id as string, reason } };
    }
    default:
      return { ok: false, error: '内容が正しくありません' };
  }
}
