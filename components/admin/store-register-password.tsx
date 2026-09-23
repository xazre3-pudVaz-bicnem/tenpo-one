'use client';

import { useState, useTransition } from 'react';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/**
 * レジ（iPad）のログイン情報（運営だけが見る）。
 * 企業番号は会社で1つ、レジ用パスワードは店舗ごと。
 * 「表示」で今のパスワードを出し、「作り直す」で新しいものを発行する。
 * 作り直すと、その店舗のレジは入り直しになる。
 */
export function StoreRegisterPassword({
  storeId,
  orgCode,
  compact = false,
  revealAction,
  reissueAction,
}: {
  storeId: string;
  orgCode?: string | null;
  compact?: boolean;
  revealAction: (input: { storeId: string }) => Promise<{ password?: string; updatedAt?: string | null; notSet?: boolean; error?: string }>;
  reissueAction: (input: { storeId: string }) => Promise<{ password?: string; error?: string }>;
}) {
  const { toast } = useToast();
  const [shown, setShown] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reveal = () => {
    if (shown) {
      setShown(null);
      return;
    }
    startTransition(async () => {
      const r = await revealAction({ storeId });
      if (r.error) toast(r.error, 'error');
      else if (r.notSet) toast('この店舗にはレジ用パスワードがまだありません。「作り直す」で発行してください', 'error');
      else setShown(r.password ?? null);
    });
  };

  const reissue = () => {
    startTransition(async () => {
      const r = await reissueAction({ storeId });
      if (r.error) toast(r.error, 'error');
      else {
        setShown(r.password ?? null);
        toast('レジ用パスワードを作り直しました。今のレジは入り直しになります');
      }
    });
  };

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-2'}>
      {orgCode !== undefined && (
        <span className="text-xs text-gray-500">
          企業番号 <span className="font-mono text-sm text-navy">{orgCode ?? '（未発行）'}</span>
        </span>
      )}
      <span className="rounded-lg bg-surface px-2 py-1 font-mono text-sm text-navy">{shown ?? '••••••••'}</span>
      <Button size="sm" variant="ghost" onClick={reveal} disabled={pending}>
        {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {shown ? '隠す' : '表示'}
      </Button>
      <Button size="sm" variant="secondary" onClick={reissue} disabled={pending}>
        <RefreshCw className="h-3.5 w-3.5" />
        作り直す
      </Button>
    </div>
  );
}
