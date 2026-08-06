'use client';

import { useTransition } from 'react';
import { Store } from 'lucide-react';
import { switchStore } from '@/app/app/actions';
import type { StoreRef } from '@/lib/auth';

/**
 * 店舗切替セレクター。本社ロールには「全店舗」を表示し、常時ヘッダーに置く。
 */
export function StoreSwitcher({
  stores,
  currentStoreId,
  allowAll,
}: {
  stores: StoreRef[];
  currentStoreId: string | null;
  allowAll: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (stores.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <Store className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <select
        aria-label="店舗切替"
        className="h-9 max-w-[180px] rounded-lg border border-gray-300 bg-white px-2 text-sm font-medium text-navy focus:border-primary focus:outline-2 focus:outline-primary/30 sm:max-w-[220px]"
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
    </div>
  );
}
