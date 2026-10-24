import { isUuid } from '@/lib/native-pos';
import { CLERK_ROLES, type ClerkRole } from '@/lib/clerk-roles';

/**
 * iPad アプリのネイティブの「設定の中の画面」（2026-10-24 Ronnie「設定の中も全部ネイティブ。テーブルQRなど何でも」）。
 * Web の各設定画面と同じ Server Action を /api/app/v1/pos の POST から呼ぶ。読み込みは GET ?part=<画面>。
 *   soldout … 品切れ（/app/pos/sold-out。lib/sold-out-loader + app/app/pos/sold-out-actions）
 */
export type NativeSettingsPageAction =
  /** 品切れ：商品を売切／販売再開 */
  | { type: 'soldOutSet'; itemId: string; soldOut: boolean }
  /** POS担当者（/app/settings/clerks。app/app/settings/clerks/actions.ts） */
  | { type: 'clerkAdd'; name: string; role: ClerkRole }
  | { type: 'clerkRename'; id: string; name: string }
  | { type: 'clerkStatus'; id: string; status: 'active' | 'hidden' }
  | { type: 'clerkRole'; id: string; role: ClerkRole }
  | { type: 'clerkDelete'; id: string };

export type NativeSettingsPageActionType = NativeSettingsPageAction['type'];
export const NATIVE_SETTINGS_PAGE_ACTION_TYPES: readonly NativeSettingsPageActionType[] = [
  'soldOutSet',
  'clerkAdd',
  'clerkRename',
  'clerkStatus',
  'clerkRole',
  'clerkDelete',
];

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
  const role = (v: unknown): ClerkRole | null => (typeof v === 'string' && (CLERK_ROLES as readonly string[]).includes(v) ? (v as ClerkRole) : null);
  const name = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= 80 ? v : null);
  if (b.type === 'clerkAdd') {
    const n = name(b.name);
    const r = role(b.role ?? 'staff');
    if (!n) return bad('担当者名を入力してください');
    if (!r) return bad('役職が正しくありません');
    return { ok: true, action: { type: 'clerkAdd', name: n, role: r } };
  }
  if (b.type === 'clerkRename') {
    const n = name(b.name);
    if (!isUuid(b.id)) return bad('担当者が見つかりません');
    if (!n) return bad('担当者名を入力してください');
    return { ok: true, action: { type: 'clerkRename', id: b.id, name: n } };
  }
  if (b.type === 'clerkStatus') {
    if (!isUuid(b.id) || (b.status !== 'active' && b.status !== 'hidden')) return bad('担当者が見つかりません');
    return { ok: true, action: { type: 'clerkStatus', id: b.id, status: b.status } };
  }
  if (b.type === 'clerkRole') {
    const r = role(b.role);
    if (!isUuid(b.id)) return bad('担当者が見つかりません');
    if (!r) return bad('役職が正しくありません');
    return { ok: true, action: { type: 'clerkRole', id: b.id, role: r } };
  }
  if (b.type === 'clerkDelete') {
    if (!isUuid(b.id)) return bad('担当者が見つかりません');
    return { ok: true, action: { type: 'clerkDelete', id: b.id } };
  }
  return bad();
}

/** POS担当者の画面の読み込み（GET ?part=clerks） */
export interface NativeClerksPayload {
  store: { id: string; name: string };
  /** レジ端末：オーナーの担当者は削除・役職の変更ができない */
  lockOwner: boolean;
  /** 店長以上（追加・変更・削除）。無ければ見るだけ */
  canEdit: boolean;
  roles: { id: ClerkRole; label: string; en: string }[];
  rows: { id: string; name: string; status: 'active' | 'hidden'; role: ClerkRole }[];
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
