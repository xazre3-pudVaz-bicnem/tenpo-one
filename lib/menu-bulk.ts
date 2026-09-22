/**
 * 設定 > メニュー一括編集（2026-09-23 dinii の「メニュー一括編集」と同じく、表で何件もまとめて直す）。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

export const BULK_ITEM_TYPES = ['food', 'drink', 'course', 'option'] as const;
export type BulkItemType = (typeof BULK_ITEM_TYPES)[number];

export interface BulkRow {
  id: string;
  name: string;
  nameEn: string;
  categoryId: string | null;
  itemType: string;
  price: number;
  takeoutPrice: number | null;
  status: 'active' | 'hidden';
  isSoldOut: boolean;
}

/** 保存する差分（変わった項目だけ） */
export interface BulkPatch {
  id: string;
  name?: string;
  nameEn?: string;
  categoryId?: string | null;
  itemType?: string;
  price?: number;
  takeoutPrice?: number | null;
  status?: 'active' | 'hidden';
  isSoldOut?: boolean;
}

const FIELDS = ['name', 'nameEn', 'categoryId', 'itemType', 'price', 'takeoutPrice', 'status', 'isSoldOut'] as const;

/** 最初の状態と今の状態から、変わった行・項目だけの差分を作る */
export function diffBulkRows(initial: readonly BulkRow[], current: readonly BulkRow[]): BulkPatch[] {
  const before = new Map(initial.map((r) => [r.id, r]));
  const patches: BulkPatch[] = [];
  for (const row of current) {
    const b = before.get(row.id);
    if (!b) continue;
    const patch: BulkPatch = { id: row.id };
    let changed = false;
    for (const f of FIELDS) {
      const now = f === 'name' || f === 'nameEn' ? (row[f] as string).trim() : row[f];
      const was = f === 'name' || f === 'nameEn' ? (b[f] as string).trim() : b[f];
      if (now !== was) {
        (patch as unknown as Record<string, unknown>)[f] = now;
        changed = true;
      }
    }
    if (changed) patches.push(patch);
  }
  return patches;
}

const MAX_PRICE = 10_000_000;

function isPrice(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_PRICE;
}

/** 1行の差分が正しいか。正しくなければ理由（日本語）、正しければ null */
export function bulkPatchProblem(p: BulkPatch): string | null {
  if (p.name !== undefined && !p.name.trim()) return '商品名が空です';
  if (p.name !== undefined && p.name.trim().length > 200) return '商品名が長すぎます';
  if (p.nameEn !== undefined && p.nameEn.length > 200) return '英語名が長すぎます';
  if (p.itemType !== undefined && !(BULK_ITEM_TYPES as readonly string[]).includes(p.itemType)) return '種別が正しくありません';
  if (p.price !== undefined && !isPrice(p.price)) return '価格は0円以上の整数で入力してください';
  if (p.takeoutPrice !== undefined && p.takeoutPrice !== null && !isPrice(p.takeoutPrice)) {
    return 'テイクアウト価格は0円以上の整数で入力してください';
  }
  if (p.status !== undefined && p.status !== 'active' && p.status !== 'hidden') return '表示の指定が正しくありません';
  if (p.isSoldOut !== undefined && typeof p.isSoldOut !== 'boolean') return '売切の指定が正しくありません';
  return null;
}

/** 選んだ行にまとめてかける操作 */
export type BulkOp =
  | { kind: 'category'; categoryId: string | null }
  | { kind: 'itemType'; itemType: BulkItemType }
  | { kind: 'priceAdd'; yen: number }
  | { kind: 'pricePercent'; percent: number; roundTo10: boolean }
  | { kind: 'priceSet'; yen: number }
  | { kind: 'status'; status: 'active' | 'hidden' }
  | { kind: 'soldOut'; soldOut: boolean };

/** 価格を％で変える（例: +10 で 1割増し）。roundTo10 なら10円単位に四捨五入。0円未満にはしない */
export function adjustPriceByPercent(price: number, percent: number, roundTo10: boolean): number {
  const raw = (price * (100 + percent)) / 100;
  const rounded = roundTo10 ? Math.round(raw / 10) * 10 : Math.round(raw);
  return Math.max(0, Math.min(MAX_PRICE, rounded));
}

export function applyBulkOp(rows: readonly BulkRow[], selected: ReadonlySet<string>, op: BulkOp): BulkRow[] {
  return rows.map((r) => {
    if (!selected.has(r.id)) return r;
    switch (op.kind) {
      case 'category':
        return { ...r, categoryId: op.categoryId };
      case 'itemType':
        return { ...r, itemType: op.itemType };
      case 'priceAdd':
        return { ...r, price: Math.max(0, Math.min(MAX_PRICE, r.price + Math.round(op.yen))) };
      case 'pricePercent':
        return { ...r, price: adjustPriceByPercent(r.price, op.percent, op.roundTo10) };
      case 'priceSet':
        return { ...r, price: Math.max(0, Math.min(MAX_PRICE, Math.round(op.yen))) };
      case 'status':
        return { ...r, status: op.status };
      case 'soldOut':
        return { ...r, isSoldOut: op.soldOut };
    }
  });
}

/** 表の絞り込み */
export function filterBulkRows(
  rows: readonly BulkRow[],
  f: { categoryId: string; itemType: string; search: string }
): BulkRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.categoryId === 'uncategorized' ? r.categoryId !== null : f.categoryId !== 'all' && r.categoryId !== f.categoryId) {
      return false;
    }
    if (f.itemType !== 'all' && r.itemType !== f.itemType) return false;
    if (q && !`${r.name} ${r.nameEn}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
