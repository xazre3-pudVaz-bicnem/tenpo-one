'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/state';
import { Button } from '@/components/ui/button';

/** POSページ専用のエラー境界。注文の読込に失敗した場合にErrorState+再試行を表示する */
export default function PosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本番ではエラー監視サービスへ送る想定（現状はコンソールのみ）
    console.error('[app/pos] failed to load:', error);
  }, [error]);

  return (
    <div className="p-4 lg:p-6">
      <ErrorState
        message="通信状態を確認して再度お試しください。"
        retry={
          <Button onClick={() => reset()} variant="primary">
            再試行する
          </Button>
        }
      />
    </div>
  );
}
