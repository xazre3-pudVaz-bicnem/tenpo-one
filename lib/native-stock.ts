import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの在庫設定（本日の残り数）。Web の /app/inventory/menu-stock と同じ（2026-10-24）。
 * 読み込み GET ?part=stock、操作 POST { type: 'stockSave' | 'stockPrint' }。
 */
export type NativeStockAction =
  | { type: 'stockSave'; entries: { itemId: string; limit: number | null }[] }
  | { type: 'stockPrint'; lines: { name: string; remaining: number }[] };

export const NATIVE_STOCK_ACTION_TYPES = ['stockSave', 'stockPrint'] as const;
export function isNativeStockActionType(v: unknown): v is NativeStockAction['type'] {
  return typeof v === 'string' && (NATIVE_STOCK_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeStockAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });
const n = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99_999;

export function parseNativeStockAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  if (b.type === 'stockSave') {
    if (!Array.isArray(b.entries) || b.entries.length > 500) return bad('一度に保存できるのは500品までです');
    const entries: { itemId: string; limit: number | null }[] = [];
    for (const e of b.entries as Record<string, unknown>[]) {
      if (!isUuid(e?.itemId) || !(e.limit === null || n(e.limit))) return bad('商品の指定が正しくありません');
      entries.push({ itemId: e.itemId as string, limit: e.limit as number | null });
    }
    return { ok: true, action: { type: 'stockSave', entries } };
  }
  if (b.type === 'stockPrint') {
    if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 500) return bad('在庫管理している商品がありません');
    const lines: { name: string; remaining: number }[] = [];
    for (const l of b.lines as Record<string, unknown>[]) {
      if (typeof l?.name !== 'string' || !n(l.remaining)) return bad();
      lines.push({ name: l.name.slice(0, 80), remaining: l.remaining as number });
    }
    return { ok: true, action: { type: 'stockPrint', lines } };
  }
  return bad();
}
