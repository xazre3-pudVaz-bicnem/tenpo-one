'use client';

import { useCallback, useSyncExternalStore } from 'react';

const TICK_MS = 30_000;

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
}

/** 30秒刻みに丸めた現在時刻（ms）。描画中に Date.now() を直接呼ばないための時計。 */
function getSnapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

/**
 * 現在時刻（30秒刻み）。サーバー描画時とハイドレーション時は serverNowMs を使う。
 */
export function useNow(serverNowMs: number): number {
  const getServerSnapshot = useCallback(() => Math.floor(serverNowMs / TICK_MS) * TICK_MS, [serverNowMs]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** ms → JSTの時刻（0:00からの分） */
export function jstMinutesOfMs(ms: number): number {
  return Math.floor((ms / 60000 + 9 * 60) % 1440);
}
