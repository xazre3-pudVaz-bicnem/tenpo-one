import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの「設定の中の画面」（2026-10-24 Ronnie「設定の中も全部ネイティブ。テーブルQRなど何でも」）。
 * Web の各設定画面と同じ Server Action を /api/app/v1/pos の POST から呼ぶ。読み込みは GET ?part=<画面>。
 *   soldout … 品切れ（/app/pos/sold-out。lib/sold-out-loader + app/app/pos/sold-out-actions）
 */
export type NativeSettingsPageAction =
  /** 品切れ：商品を売切／販売再開 */
  | { type: 'soldOutSet'; itemId: string; soldOut: boolean };

export type NativeSettingsPageActionType = NativeSettingsPageAction['type'];
export const NATIVE_SETTINGS_PAGE_ACTION_TYPES: readonly NativeSettingsPageActionType[] = ['soldOutSet'];

export function isNativeSettingsPageActionType(v: unknown): v is NativeSettingsPageActionType {
  return typeof v === 'string' && (NATIVE_SETTINGS_PAGE_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeSettingsPageAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

export function parseNativeSettingsPageAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  if (b.type === 'soldOutSet') {
    if (!isUuid(b.itemId) || typeof b.soldOut !== 'boolean') return bad('商品の指定が正しくありません');
    return { ok: true, action: { type: 'soldOutSet', itemId: b.itemId, soldOut: b.soldOut } };
  }
  return bad();
}

/** 品切れの画面の読み込み（GET ?part=soldout） */
export interface NativeSoldOutPayload {
  store: { id: string; name: string };
  /** 全店共通の商品も切り替えられる（店長以上） */
  canManageShared: boolean;
  categories: { id: string; name: string; sortOrder: number }[];
  items: {
    id: string;
    categoryId: string | null;
    name: string;
    nameKana: string | null;
    price: number;
    isSoldOut: boolean;
    sortOrder: number;
    shared: boolean;
  }[];
}
