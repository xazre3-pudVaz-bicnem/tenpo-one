'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MonitorSmartphone, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ClaimResult } from '@/app/app/pos/register-device-actions';

/**
 * レジとして使えない端末に出す画面（2026-09-23 契約のアクセス制限）。
 * - network: 契約で登録した回線の外から開いた
 * - register: まだレジとして登録していない端末（台数に空きがあれば登録できる）
 * - limit / revoked: 台数の上限・解除された端末
 */
export function RegisterGate({
  kind,
  storeId,
  storeName,
  limit,
  message,
  claimAction,
}: {
  kind: 'network' | 'register' | 'limit' | 'revoked';
  storeId: string;
  storeName: string;
  limit?: number;
  message: string;
  claimAction?: (storeId: string) => Promise<ClaimResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const claim = () => {
    if (!claimAction) return;
    setError(null);
    startTransition(async () => {
      const r = await claimAction(storeId);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="rounded-2xl border border-gray-200 bg-white px-6 py-8 shadow-sm">
        {kind === 'network' ? (
          <WifiOff className="mx-auto h-9 w-9 text-amber-500" aria-hidden />
        ) : (
          <MonitorSmartphone className="mx-auto h-9 w-9 text-primary" aria-hidden />
        )}
        <p className="mt-3 text-base font-bold text-navy">
          {kind === 'network' ? 'お店の回線からご利用ください' : kind === 'register' ? 'この端末をレジとして登録します' : 'この端末ではレジを使えません'}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{message}</p>
        <p className="mt-2 text-xs text-gray-400">
          {storeName}
          {typeof limit === 'number' ? `・レジ端末 ${limit}台まで` : ''}
        </p>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {kind === 'register' && claimAction && (
          <Button className="mt-5 w-full" onClick={claim} disabled={pending}>
            {pending ? '登録中…' : 'この端末をレジとして登録する'}
          </Button>
        )}
        {kind !== 'register' && (
          <Button variant="secondary" className="mt-5 w-full" onClick={() => router.refresh()} disabled={pending}>
            再読み込み
          </Button>
        )}
      </div>
    </div>
  );
}
