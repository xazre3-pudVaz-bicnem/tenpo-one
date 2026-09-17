'use client';

import { useSyncExternalStore } from 'react';

/**
 * 経過時間・残り時間の表示用の共有時計（30秒ごとに更新）。
 * 描画中に Date.now() を読まないよう useSyncExternalStore で購読する。
 * ハイドレーション時はサーバーで算出した基準時刻（serverNow）を使い、表示の不一致を防ぐ。
 */
const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let current = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(callback: () => void) {
  listeners.add(callback);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  if (current === 0) current = Date.now();
  return current;
}

export function useNow(serverNow: number): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverNow);
}
