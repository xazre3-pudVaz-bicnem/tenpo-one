'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ディスプレイ端末の画面の土台（/display）。
 *   - 画面を消さない（Screen Wake Lock。使えない端末は何もしない。画面に戻ったら取り直す）
 *   - 案内の画面（回線の外・機能 OFF など）は自分で読み直す（つながったら自動で元の画面へ）
 *   - 数分ごとの見守り（端末の鍵 Cookie の期限を延ばす・「使用中」を記録）
 *   - ネットが戻ったら読み直す
 * ログアウト・解除はここでは一切しない。
 */
export function DisplayShell({
  children,
  refreshMs,
  heartbeatAction,
}: {
  children: React.ReactNode;
  /** 案内の画面で読み直す間隔（KDS・呼び出しは自分で更新するので省略） */
  refreshMs?: number;
  heartbeatAction?: () => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    const request = async () => {
      try {
        if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
        const next = await navigator.wakeLock.request('screen');
        if (disposed) {
          void next.release().catch(() => undefined);
          return;
        }
        lock = next;
      } catch {
        // 省電力モードなどで断られたときは何もしない（次に画面へ戻ったときにもう一度）
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) void lock.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!refreshMs) return;
    const timer = setInterval(() => router.refresh(), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, router]);

  useEffect(() => {
    if (!heartbeatAction) return;
    const beat = () => {
      heartbeatAction().catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, 5 * 60_000);
    return () => clearInterval(timer);
  }, [heartbeatAction]);

  useEffect(() => {
    const onOnline = () => router.refresh();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [router]);

  return <>{children}</>;
}
