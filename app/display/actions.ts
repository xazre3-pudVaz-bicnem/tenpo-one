'use server';

import { revalidatePath } from 'next/cache';
import type { KdsSettings, KitchenStatus } from '@/components/kitchen/types';
import { displayHeartbeatServer, resumeDisplayDeviceSession } from '@/lib/display-monitor-server';
import { advanceDisplayItem, markDisplayOrderServed } from '@/lib/display-ops-server';

/**
 * ディスプレイ（キッチン）で品目を次の段階へ（未着手→調理中→完成→提供済）。/app/kitchen と同じ動き。
 * 中身は lib/display-ops-server.ts（端末・店の品目・機能 ON・お店の回線を確かめてから。iPad アプリと同じ）
 */
export async function displayAdvanceItem(orderItemId: string, nextStatus: KitchenStatus): Promise<void> {
  await advanceDisplayItem(orderItemId, nextStatus);
  revalidatePath('/display');
}

/**
 * カード単位で未提供の品目をまとめて提供済に（/app/kitchen の「すべて提供済にする」と同じ）。
 * onlyItemIds は画面に出ている品目（持ち場で絞った分）だけ。
 */
export async function displayMarkServed(orderId: string, onlyItemIds?: string[]): Promise<void> {
  await markDisplayOrderServed(orderId, onlyItemIds);
  revalidatePath('/display');
}

/** ディスプレイからは KDS の表示設定を変えない（設定はレジ・管理画面の /app/kitchen から） */
export async function displayKdsSettingsLocked(storeId: string, settings: KdsSettings): Promise<void> {
  void storeId;
  void settings;
  throw new Error('この端末では変更できません。設定はレジの「キッチン」から変えてください');
}

/** セッションが切れた端末を、端末の鍵（Cookie）でつなぎ直す（ログアウトさせない） */
export async function resumeDisplaySession(): Promise<{ ok: boolean; error?: string }> {
  try {
    return await resumeDisplayDeviceSession();
  } catch (e) {
    console.error('[display] resume failed', e instanceof Error ? e.message : e);
    return { ok: false, error: '接続を確認しています。しばらくお待ちください' };
  }
}

/** 数分ごと：端末の鍵 Cookie の期限を延ばす・「使用中」を記録する */
export async function displayHeartbeat(): Promise<{ ok: boolean }> {
  try {
    return await displayHeartbeatServer();
  } catch {
    return { ok: false };
  }
}
