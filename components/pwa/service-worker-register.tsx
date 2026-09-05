'use client';

import { useEffect } from 'react';

/**
 * Service Worker の登録。
 * 本番ビルドでのみ登録する（開発中は古いアセットが配信されるのを避けるため）。
 * 登録失敗はアプリの動作に影響しないため握りつぶす。
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* 登録失敗時は通常のWebアプリとして動作する */
      });
    };
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
