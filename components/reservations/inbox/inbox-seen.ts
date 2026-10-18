'use client';

import { useSyncExternalStore } from 'react';

/**
 * メッセージ（お知らせ）を「どこまで読んだか」。端末ごと（localStorage）。
 *   seen     … 最後に見たお知らせの時刻（タブの数字＝これより新しいお知らせの数）
 *   prevSeen … いま開いているメッセージの画面で「新着」の印を付ける境目（開く直前の seen）
 * 読めない端末（プライベートモードなど）でも画面は出る（何も覚えないだけ）。
 */

const EVENT = 'tenpo-inbox-seen';
const key = (storeId: string, kind: 'seen' | 'prev') => `tenpo-inbox-${kind}:${storeId}`;

function read(storeId: string, kind: 'seen' | 'prev'): string | null {
  try {
    return window.localStorage.getItem(key(storeId, kind));
  } catch {
    return null;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(EVENT, callback);
  };
}

/** まだ一度も開いていない端末は「この24時間」を未読にする */
const FIRST_WINDOW_MS = 24 * 3600 * 1000;

export function useInboxSeen(storeId: string, kind: 'seen' | 'prev' = 'seen'): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => read(storeId, kind),
    // サーバーでは分からない（undefined の間は数字・印を出さない）
    () => undefined
  );
}

/** 未読の数 */
export function unreadCount(times: string[], seen: string | null | undefined, now: number): number {
  if (seen === undefined) return 0;
  const border = seen ?? new Date(now - FIRST_WINDOW_MS).toISOString();
  return times.filter((t) => t > border).length;
}

/** メッセージを開いたときに呼ぶ：いちばん新しいお知らせまで読んだことにする */
export function markInboxSeen(storeId: string, latest: string | null) {
  if (!latest) return;
  try {
    const seen = window.localStorage.getItem(key(storeId, 'seen'));
    if (seen && seen >= latest) return;
    window.localStorage.setItem(key(storeId, 'prev'), seen ?? new Date(Date.now() - FIRST_WINDOW_MS).toISOString());
    window.localStorage.setItem(key(storeId, 'seen'), latest);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // 覚えられない端末では何もしない
  }
}
