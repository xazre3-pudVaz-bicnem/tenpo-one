'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * ディスプレイの画面で一時的なエラー（通信の途切れ等）が出たとき。
 * ログイン画面には飛ばさず、10 秒ごとに自動で読み直す（店のモニターは誰も操作しないため）。
 */
export default function DisplayError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    const timer = setTimeout(() => retry(), 10_000);
    return () => clearTimeout(timer);
  }, [error, retry]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#292725] px-6 text-center text-white">
      <Loader2 className="h-16 w-16 animate-spin text-white/80" aria-hidden />
      <h1 className="mt-6 text-[clamp(1.75rem,4.5vw,3rem)] font-bold">接続を確認しています…</h1>
      <p className="mt-4 text-white/70">このままお待ちください。自動で元の画面に戻ります（ログアウトはしていません）。</p>
      <button type="button" onClick={() => retry()} className="mt-8 rounded-xl bg-white/15 px-6 py-3 text-base font-bold">
        今すぐ読み直す
      </button>
    </div>
  );
}
