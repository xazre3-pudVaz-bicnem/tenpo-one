import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの「原価管理」（Web の /app/costing・/app/costing/[menuItemId] と同じ）の入力の読み取り（テスト対象）。
 * 読み込みは GET /api/app/v1/pos?part=costing|costingImpact|costingWaste|costingItem、
 * 操作は POST { type: 'costingLineAdd' | 'costingLineUpdate' | 'costingLineDelete', … }（lib/native-modules/costing.ts）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 */

export type NativeCostingAction =
  | { type: 'costingLineAdd'; menuItemId: string; inventoryItemId: string; quantity: number; note: string | null }
  | { type: 'costingLineUpdate'; lineId: string; menuItemId: string; inventoryItemId: string; quantity: number; note: string | null }
  | { type: 'costingLineDelete'; lineId: string; menuItemId: string };

export const NATIVE_COSTING_ACTION_TYPES = ['costingLineAdd', 'costingLineUpdate', 'costingLineDelete'] as const;

export function isNativeCostingActionType(v: unknown): v is NativeCostingAction['type'] {
  return typeof v === 'string' && (NATIVE_COSTING_ACTION_TYPES as readonly string[]).includes(v);
}

/** 使用量の上限（ありえない桁を弾く） */
const MAX_QUANTITY = 1_000_000;
/** メモの長さの上限 */
const MAX_NOTE = 500;

/** メモ：前後の空白を除き、空なら null（Web のフォームと同じ） */
function readNote(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, MAX_NOTE) : null;
}

/** 使用量：数字か数字の文字（全角・カンマも受ける）。読めなければ NaN */
function readQuantity(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.normalize('NFKC').replace(/,/g, '').trim();
    return t === '' ? NaN : Number(t);
  }
  return NaN;
}

export function parseNativeCostingAction(raw: unknown): { ok: true; action: NativeCostingAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '内容が正しくありません' };
  const b = raw as Record<string, unknown>;
  if (!isNativeCostingActionType(b.type)) return { ok: false, error: '内容が正しくありません' };
  if (!isUuid(b.menuItemId)) return { ok: false, error: '商品が見つかりません' };
  const menuItemId = b.menuItemId;

  if (b.type === 'costingLineDelete') {
    if (!isUuid(b.lineId)) return { ok: false, error: 'レシピの行が見つかりません' };
    return { ok: true, action: { type: 'costingLineDelete', lineId: b.lineId, menuItemId } };
  }

  // 追加・更新：Web の RecipeLineForm と同じ確認・同じことば
  if (b.inventoryItemId == null || b.inventoryItemId === '') return { ok: false, error: '食材を選択してください' };
  if (!isUuid(b.inventoryItemId)) return { ok: false, error: '食材が見つかりません' };
  const quantity = readQuantity(b.quantity);
  if (!(quantity > 0) || !Number.isFinite(quantity)) return { ok: false, error: '使用量は0より大きい値で入力してください' };
  if (quantity > MAX_QUANTITY) return { ok: false, error: '使用量が大きすぎます' };
  const note = readNote(b.note);

  if (b.type === 'costingLineUpdate') {
    if (!isUuid(b.lineId)) return { ok: false, error: 'レシピの行が見つかりません' };
    return { ok: true, action: { type: 'costingLineUpdate', lineId: b.lineId, menuItemId, inventoryItemId: b.inventoryItemId, quantity, note } };
  }
  return { ok: true, action: { type: 'costingLineAdd', menuItemId, inventoryItemId: b.inventoryItemId, quantity, note } };
}

/** 'YYYY-MM-DD' の実在する日付か */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** GET の絞り込み（Web の ?category= ?q= ?ingredient= ?from= ?to= と同じ名前）。正しくない値は無いものとして扱う */
export interface NativeCostingQuery {
  category: string | null;
  q: string | null;
  ingredient: string | null;
  from: string | undefined;
  to: string | undefined;
  /** レシピ編集の商品（part=costingItem&id=） */
  id: string | null;
}

export function parseNativeCostingQuery(params: URLSearchParams): NativeCostingQuery {
  const category = params.get('category');
  const q = (params.get('q') ?? '').trim().slice(0, 100);
  const ingredient = params.get('ingredient');
  const from = params.get('from');
  const to = params.get('to');
  const id = params.get('id');
  return {
    category: isUuid(category) ? category : null,
    q: q || null,
    ingredient: isUuid(ingredient) ? ingredient : null,
    from: isIsoDate(from) ? from : undefined,
    to: isIsoDate(to) ? to : undefined,
    id: isUuid(id) ? id : null,
  };
}
