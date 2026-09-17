'use client';

import { useTransition } from 'react';
import { ChevronDown, Store } from 'lucide-react';
import { switchStore } from '@/app/app/actions';
import type { StoreRef } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * 店舗切替セレクター。本社ロールには「全店舗」を表示する。
 * tone="dark" は上部バー（濃紫）用の丸い店舗ピル表示。
 */
export function StoreSwitcher({
  stores,
  currentStoreId,
  allowAll,
  tone = 'light',
}: {
  stores: StoreRef[];
  currentStoreId: string | null;
  allowAll: boolean;
  tone?: 'light' | 'dark';
}) {
  const [pending, startTransition] = useTransition();

  if (stores.length === 0) return null;

  const select = (
    <select
      aria-label="店舗切替"
      className={cn(
        'appearance-none truncate text-sm font-medium focus:outline-2',
        tone === 'dark'
          ? 'h-7 max-w-[240px] rounded-full border border-white/16 bg-white/10 pr-7 pl-3 text-[12.5px] text-iris-soft focus:outline-white/40'
          : 'h-9 max-w-[180px] rounded-lg border border-line bg-white pr-7 pl-2 text-ink focus:border-iris focus:outline-iris/30 sm:max-w-[220px]'
      )}
      value={currentStoreId ?? 'all'}
      disabled={pending}
      onChange={(e) => startTransition(() => switchStore(e.target.value))}
    >
      {allowAll && <option value="all">全店舗</option>}
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      {tone === 'light' && <Store className="h-4 w-4 shrink-0 text-iris" aria-hidden="true" />}
      <div className="relative min-w-0">
        {select}
        <ChevronDown
          className={cn(
            'pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2',
            tone === 'dark' ? 'text-iris-soft' : 'text-ink-3'
          )}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
