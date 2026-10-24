import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { loadKdsBoard } from '@/lib/kds-server';
import { setItemKitchenStatus, markOrderServed, updateKdsSettings } from '@/app/app/kitchen/actions';
import { STATION_LABELS, type KdsSettings, type KitchenStatus } from '@/components/kitchen/types';
import type { NativeModuleGet, NativeModulePost } from '@/lib/native-modules/registry';

/**
 * キッチン（KDS）の iPad ネイティブ（GET part=kitchen ／ POST kdsItemStatus・kdsOrderServed・kdsSettings）。
 * 中身・操作は Web の /app/kitchen と同じ（lib/kds-server.ts・app/app/kitchen/actions.ts）。2026-10-24 Ronnie「全部ネイティブ」
 */

const NEXT: Record<KitchenStatus, KitchenStatus | null> = { pending: 'preparing', preparing: 'ready', ready: 'served', served: null };
const UUID = /^[0-9a-f-]{36}$/i;

export const kitchenGet: NativeModuleGet = async ({ ctx, store }) => {
  if (ctx.disabledFeatures?.has('kds')) return { status: 403, body: { ok: false, error: 'キッチン（KDS）は使えません' } };
  const board = await loadKdsBoard(await createClient(), store);
  return {
    body: {
      ok: true,
      store,
      ...board,
      stations: STATION_LABELS,
      canManageSettings: can(ctx.role, 'store.settings'),
    },
  };
};

/** 品目の状態を 1 つ進める（未着手→調理中→完成→提供済） */
export const kdsItemStatusPost: NativeModulePost = async ({ raw }) => {
  const itemId = typeof raw.itemId === 'string' ? raw.itemId : '';
  const next = raw.next as KitchenStatus;
  if (!UUID.test(itemId) || !(next in NEXT)) return { status: 400, body: { ok: false, error: '内容が正しくありません' } };
  await setItemKitchenStatus(itemId, next);
  return { body: { ok: true } };
};

/** 注文のまだ出していない品をまとめて提供済に（ステーションで絞っているときはその品だけ） */
export const kdsOrderServedPost: NativeModulePost = async ({ raw }) => {
  const orderId = typeof raw.orderId === 'string' ? raw.orderId : '';
  const itemIds = Array.isArray(raw.itemIds) ? raw.itemIds.filter((v): v is string => typeof v === 'string' && UUID.test(v)) : undefined;
  if (!UUID.test(orderId)) return { status: 400, body: { ok: false, error: '内容が正しくありません' } };
  await markOrderServed(orderId, itemIds && itemIds.length > 0 ? itemIds : undefined);
  return { body: { ok: true } };
};

/** 表示の設定（警告の分・品目ごとにまとめる・音） */
export const kdsSettingsPost: NativeModulePost = async ({ ctx, store, raw }) => {
  if (!can(ctx.role, 'store.settings')) return { status: 403, body: { ok: false, error: '設定を変える権限がありません' } };
  const s = raw.settings as Partial<KdsSettings> | undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);
  const settings: KdsSettings = {
    warn1: num(s?.warn1),
    warn2: num(s?.warn2),
    warn3: num(s?.warn3),
    aggregate: s?.aggregate === true,
    sound: s?.sound === true,
  };
  if (!(settings.warn1 > 0 && settings.warn1 < settings.warn2 && settings.warn2 < settings.warn3)) {
    return { status: 400, body: { ok: false, error: '警告の分は 段階1 < 段階2 < 段階3 にしてください' } };
  }
  await updateKdsSettings(store.id, settings);
  return { body: { ok: true } };
};
