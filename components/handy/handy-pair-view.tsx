'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CircleAlert, Smartphone } from 'lucide-react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
/** # 以降のペアリングコード（48桁の16進）。形式が違えば空 */
const getCode = () => {
  const code = window.location.hash.slice(1);
  return /^[0-9a-f]{48}$/i.test(code) ? code : '';
};
const getServerCode = () => '';

/**
 * QRを読み取った端末の設定画面。
 * 「この端末を登録」を押したときだけ登録する（読み取っただけでは登録しない）。
 */
export function HandyPairView({
  pairAction,
}: {
  pairAction: (code: string) => Promise<{ error?: string; storeName?: string }>;
}) {
  const router = useRouter();
  const code = useSyncExternalStore(subscribe, getCode, getServerCode);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const handlePair = () => {
    setError(null);
    startTransition(async () => {
      const result = await pairAction(code);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(result.storeName ?? '');
      router.replace('/handy');
    });
  };

  return (
    <div className="min-h-screen bg-[#f6f3fb] px-5 py-8">
      <div className="mx-auto max-w-sm">
        <div className="rounded-2xl bg-[#15121a] px-5 py-6 text-center text-white">
          <Smartphone className="mx-auto h-8 w-8" aria-hidden />
          <p className="mt-2 text-lg font-bold">ハンディの設定</p>
          <p className="mt-1 text-xs text-white/70">TENPO ONE</p>
        </div>

        {!code && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            QRコードを読み取れませんでした。レジの「設定 → ハンディ端末」で表示したQRコードを、もう一度読み取ってください。
          </div>
        )}

        {code && !done && (
          <div className="mt-5 rounded-2xl bg-white px-5 py-6 shadow-sm">
            <p className="text-sm text-[#2a2138]">
              この端末をハンディとして登録します。登録すると、次回からはQRコードなしで開けます。
            </p>
            <p className="mt-2 text-xs text-[#7a7090]">
              お店のWi-Fiに接続した状態で行ってください。スマホの回線では登録できません。
            </p>
            {error && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={handlePair}
              disabled={pending}
              className="mt-5 h-14 w-full rounded-xl bg-[#7b3fe4] text-base font-bold text-white disabled:opacity-60"
            >
              {pending ? '登録しています…' : 'この端末を登録'}
            </button>
          </div>
        )}

        {done !== null && (
          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-white px-5 py-6 text-sm font-semibold text-[#2a2138] shadow-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
            {done ? `${done} のハンディとして登録しました` : '登録しました'}
          </div>
        )}
      </div>
    </div>
  );
}
