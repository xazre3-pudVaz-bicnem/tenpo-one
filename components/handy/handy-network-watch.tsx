'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WifiOff } from 'lucide-react';
import type { HeartbeatResult } from '@/app/handy-join/actions';

const INTERVAL_MS = 30_000;

/**
 * ハンディ端末の Wi-Fi 見守り（iPhone用ハンディ）。
 * 30秒ごと・画面に戻ったときにサーバーへ確認し、お店のWi-Fiの外ならあと何分でログアウトかを出す。
 * 3分たつとサーバー側で端末を解除し、ここでログアウト画面へ移る。
 */
export function HandyNetworkWatch({ heartbeatAction }: { heartbeatAction: () => Promise<HeartbeatResult> }) {
  const router = useRouter();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const r = await heartbeatAction();
        if (stopped) return;
        if (r.kind === 'logout') {
          stopped = true;
          router.replace('/handy-join?out=1');
        } else if (r.kind === 'outside') setRemainingMs(r.remainingMs);
        else setRemainingMs(null);
      } catch {
        // 通信できない（Wi-Fi が切れて電波もない等）。次の確認でサーバーが判定する
      }
    };
    void check();
    const timer = window.setInterval(check, INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [heartbeatAction, router]);

  if (remainingMs === null) return null;
  const min = Math.max(1, Math.ceil(remainingMs / 60_000));
  return (
    <div role="alert" className="fixed inset-x-2 top-2 z-[70] flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-sm font-bold text-white shadow-lg">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      お店のWi-Fiにつながっていません。あと約{min}分でログアウトします
    </div>
  );
}
