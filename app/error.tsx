'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本番ではエラー監視サービスへ送る想定（現状はコンソールのみ）
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <AlertTriangle className="h-10 w-10 text-warning" />
      <h1 className="mt-4 text-lg font-semibold text-navy">エラーが発生しました</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        一時的な問題の可能性があります。再試行しても解決しない場合は管理者へお問い合わせください。
        {error.digest && <span className="mt-1 block text-xs text-gray-400">エラーID: {error.digest}</span>}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-deep"
      >
        再試行する
      </button>
    </div>
  );
}
