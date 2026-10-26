'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isIpadDesktopMode } from '@/lib/admin-v2';
import { setAdminV2 } from '@/app/app/admin-v2-actions';

/**
 * 新しい管理画面は最初から ON（lib/admin-v2.ts adminV2On）。iPad の Safari は Mac を名乗るのでサーバーでは見分けられない。
 * 画面にタッチがあれば（iPad）その場で OFF にして描き直す（2026-10-10 Ronnie「iPad は絶対に変えない」）。
 */
export function AdminV2TouchGuard() {
  const router = useRouter();
  useEffect(() => {
    if (!isIpadDesktopMode(navigator.userAgent, navigator.maxTouchPoints)) return;
    void setAdminV2(false).then(() => router.refresh());
  }, [router]);
  return null;
}
