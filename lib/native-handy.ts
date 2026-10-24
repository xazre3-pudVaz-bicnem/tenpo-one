import { isUuid } from '@/lib/native-pos';

/**
 * iPhone アプリのネイティブのハンディ（テーブル一覧）とオーナーのホーム（2026-10-24 Ronnie「iPhone のホームもネイティブに」）。
 *   GET ?part=handy      … 担当者・担当者の一覧・卓・呼び出し・フロア・ご予約リンク（Web の /handy と同じ組み立て）
 *   GET ?part=ownerHome  … 売上・達成率・来店・本日の予約・30日推移・店舗別（Web の /app/dashboard と同じ組み立て）
 *   POST { type: 'handyLogin' | 'handyLogout' | 'handyLock' | 'handyGroup' | 'handyCallDone' | 'switchStore' | 'signOut' }
 * ここは入力の確認だけ（DB・Next 非依存・テスト対象）。
 */
export type NativeHandyAction =
  | { type: 'handyLogin'; clerkId: string }
  | { type: 'handyLogout' }
  | { type: 'handyLock'; tableId: string; unavailable: boolean }
  | { type: 'handyGroup'; tableIds: string[] }
  | { type: 'handyCallDone'; callId: string }
  /** 店舗を切り替える（null＝全店舗。本社のアカウントだけ） */
  | { type: 'switchStore'; storeId: string | null }
  /** ログアウト（この端末だけ。Web の ≡ のログアウトと同じ scope:'local'） */
  | { type: 'signOut' };

export const NATIVE_HANDY_ACTION_TYPES = ['handyLogin', 'handyLogout', 'handyLock', 'handyGroup', 'handyCallDone', 'switchStore', 'signOut'] as const;
export function isNativeHandyActionType(v: unknown): v is NativeHandyAction['type'] {
  return typeof v === 'string' && (NATIVE_HANDY_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeHandyAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

export function parseNativeHandyAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'handyLogin':
      if (!isUuid(b.clerkId)) return bad('担当者を選んでください');
      return { ok: true, action: { type: 'handyLogin', clerkId: b.clerkId } };
    case 'handyLogout':
      return { ok: true, action: { type: 'handyLogout' } };
    case 'signOut':
      return { ok: true, action: { type: 'signOut' } };
    case 'handyLock':
      if (!isUuid(b.tableId) || typeof b.unavailable !== 'boolean') return bad('卓の指定が正しくありません');
      return { ok: true, action: { type: 'handyLock', tableId: b.tableId, unavailable: b.unavailable } };
    case 'handyGroup': {
      if (!Array.isArray(b.tableIds) || b.tableIds.length === 0 || b.tableIds.length > 50) return bad('まとめる卓を選んでください');
      const ids = [...new Set(b.tableIds.filter((v) => isUuid(v)))] as string[];
      if (ids.length !== b.tableIds.length) return bad('卓の指定が正しくありません');
      return { ok: true, action: { type: 'handyGroup', tableIds: ids } };
    }
    case 'handyCallDone':
      if (!isUuid(b.callId)) return bad('呼び出しの指定が正しくありません');
      return { ok: true, action: { type: 'handyCallDone', callId: b.callId } };
    case 'switchStore':
      if (b.storeId === null || b.storeId === 'all') return { ok: true, action: { type: 'switchStore', storeId: null } };
      if (!isUuid(b.storeId)) return bad('店舗の指定が正しくありません');
      return { ok: true, action: { type: 'switchStore', storeId: b.storeId } };
    default:
      return bad();
  }
}

/** 本日の予約の行（オーナーのホーム。Web の StoreDashboard の「本日の予約」と同じ） */
export interface OwnerHomeReservation {
  id: string;
  time: string;
  name: string;
  partySize: number;
  /** seated / pending / その他（確定）。Web のバッジと同じ3種 */
  status: 'seated' | 'pending' | 'confirmed';
  assigned: boolean;
  /** 全店舗のとき、どの店の予約か */
  storeName: string | null;
}

/**
 * 本日の予約のまとめ（Web の StoreDashboard と同じ数え方）：
 * 組数・人数・席未定（pending/confirmed で卓なし）・次のご予約（開始順で最初の pending/confirmed）・先頭 8 件
 */
export function summarizeOwnerReservations(
  rows: { id: string; time: string; name: string; partySize: number; status: string; assigned: boolean; storeName?: string | null }[]
): { count: number; covers: number; unassigned: number; next: OwnerHomeReservation | null; list: OwnerHomeReservation[] } {
  const view = (r: (typeof rows)[number]): OwnerHomeReservation => ({
    id: r.id,
    time: r.time,
    name: r.name,
    partySize: r.partySize,
    status: r.status === 'seated' ? 'seated' : r.status === 'pending' ? 'pending' : 'confirmed',
    assigned: r.assigned,
    storeName: r.storeName ?? null,
  });
  const count = rows.length;
  const covers = rows.reduce((a, r) => a + (r.partySize ?? 0), 0);
  const unassigned = rows.filter((r) => !r.assigned && (r.status === 'pending' || r.status === 'confirmed')).length;
  const next = rows.find((r) => r.status === 'pending' || r.status === 'confirmed');
  return { count, covers, unassigned, next: next ? view(next) : null, list: rows.slice(0, 8).map(view) };
}

/**
 * 30日推移の1日分（Web の StoreDashboard と同じ）：daily_closings.net_sales。
 * 旧データ（net_sales=0 のまま保存された行）だけ sales_total − refund_total で補う
 */
export function closingNetSales(c: { sales_total: number; net_sales: number; refund_total: number }): number {
  return c.net_sales > 0 || c.sales_total === 0 ? c.net_sales : c.sales_total - c.refund_total;
}
