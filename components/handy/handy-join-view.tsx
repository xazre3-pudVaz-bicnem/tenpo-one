'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, Loader2, Smartphone, Wifi, WifiOff } from 'lucide-react';
import type { HeartbeatResult, JoinResult } from '@/app/handy-join/actions';

/**
 * iPhone用ハンディの入口（お店の固定QRから開く）。
 * QR の値（# 以降）を読んだら、ボタンを押さなくてもすぐにログインしてハンディを開く。
 */
export function HandyJoinView({
  joinAction,
  heartbeatAction,
  loggedOut,
}: {
  joinAction: (token: string) => Promise<JoinResult>;
  heartbeatAction: () => Promise<HeartbeatResult>;
  loggedOut: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'error' | 'no-code' | 'logged-out'>('loading');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    if (/^[0-9a-f]{48}$/i.test(token)) {
      // 読み取った値はすぐ URL から消す（画面共有・履歴に残さない）
      window.history.replaceState(null, '', window.location.pathname);
      joinAction(token)
        .then((r) => {
          if (r.ok) router.replace('/handy');
          else {
            setError(r.error);
            setState('error');
          }
        })
        .catch(() => {
          setError('通信できませんでした。お店のWi-Fiにつながっているか確認して、もう一度QRコードを読み取ってください');
          setState('error');
        });
      return;
    }
    if (loggedOut) {
      // Wi-Fi の外に出て戻された。ここで確実に解除・ログアウトしておく
      heartbeatAction()
        .catch(() => undefined)
        .finally(() => setState('logged-out'));
      return;
    }
    void Promise.resolve().then(() => setState('no-code'));
  }, [joinAction, heartbeatAction, loggedOut, router]);

  return (
    <div className="min-h-dvh bg-[#F6F3FB] px-5 py-8">
      <div className="mx-auto max-w-sm">
        <div className="rounded-2xl bg-[#241436] px-5 py-6 text-center text-white">
          <Smartphone className="mx-auto h-8 w-8" aria-hidden />
          <p className="mt-2 text-lg font-bold">ハンディ</p>
          <p className="mt-1 text-xs text-white/70">TENPO ONE</p>
        </div>

        {state === 'loading' && (
          <div className="mt-6 flex flex-col items-center gap-3 text-sm text-[#5A4F6E]">
            <Loader2 className="h-7 w-7 animate-spin text-[#7B3FE4]" aria-hidden />
            ハンディを開いています…
          </div>
        )}

        {state === 'error' && (
          <div className="mt-5 rounded-2xl bg-white px-5 py-5 shadow-sm">
            <p className="flex items-start gap-2 text-sm text-red-700">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
            <p className="mt-3 flex items-center gap-2 text-xs text-[#7A7090]">
              <Wifi className="h-4 w-4" aria-hidden />
              iPhone の「設定 → Wi-Fi」でお店のWi-Fiにつないでから、カメラでQRコードを読み取ってください。
            </p>
          </div>
        )}

        {state === 'logged-out' && (
          <div className="mt-5 rounded-2xl bg-white px-5 py-5 shadow-sm">
            <p className="flex items-start gap-2 text-sm font-semibold text-[#2A2138]">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              お店のWi-Fiから離れたため、ログアウトしました
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[#7A7090]">
              お店に戻ったら、お店のWi-Fiにつないで、貼ってあるQRコードをカメラで読み取るとまた開けます。
            </p>
          </div>
        )}

        {state === 'no-code' && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            お店に貼ってあるハンディのQRコードを、iPhone のカメラで読み取ってください（お店のWi-Fiにつないだ状態で）。
          </div>
        )}
      </div>
    </div>
  );
}
