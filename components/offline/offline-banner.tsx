'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { WifiOff } from 'lucide-react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

/** SSR/初回描画ではオンライン扱いとし、ハイドレーション不整合を避ける */
function getServerSnapshot(): boolean {
  return true;
}

/**
 * オフライン検知バナー（PWA/オフライン対応）。
 * navigator.onLine + online/offlineイベントを useSyncExternalStore で監視し、オフライン時のみ画面上部に固定表示する。
 * 復帰時は router.refresh() で最新データを再取得する。
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const router = useRouter();
  const wasOnlineRef = useRef(online);

  useEffect(() => {
    if (online && !wasOnlineRef.current) {
      router.refresh();
    }
    wasOnlineRef.current = online;
  }, [online, router]);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-danger px-4 py-2 text-center text-xs font-medium text-white sm:text-sm"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      オフラインです。会計などの操作は接続回復後に行ってください。
    </div>
  );
}
