'use server';

import { pairDisplayDeviceWithCode, type PairDisplayResult } from '@/lib/display-ops-server';

/**
 * QRを読み取った端末を、この店舗のディスプレイ（キッチンディスプレイ／呼び出しモニター）として登録し、
 * そのままログイン状態にする。確かめること（形式・期限・1回限り・同じ回線・機能 ON）は
 * lib/display-ops-server.ts の pairDisplayDeviceWithCode（iPad アプリのネイティブの登録と同じ）。
 */
export async function pairDisplayDevice(code: string): Promise<PairDisplayResult> {
  try {
    return await pairDisplayDeviceWithCode(code);
  } catch (e) {
    console.error('[display] pair failed', e instanceof Error ? e.message : e);
    return { error: '端末の登録に失敗しました。もう一度お試しください' };
  }
}
