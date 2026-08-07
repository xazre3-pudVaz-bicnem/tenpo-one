'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/state';
import { OrderCard } from './order-card';
import type { KdsOrderGroup, KitchenStatus } from './types';

/**
 * KDSの自動更新間隔（ミリ秒）。現状はポーリング（router.refresh）で実装している。
 * POS/QR双方の注文が同じ order_items を更新するため、将来的には
 * Supabase Realtime で order_items の変更を subscribe し、変更検知時にのみ
 * router.refresh() を呼ぶ形へ置き換える余地がある。
 */
const AUTO_REFRESH_MS = 10000;

export function KdsBoard({
  groups,
  now,
  unservedCount,
  avgElapsedMinutes,
  setItemStatusAction,
  markOrderServedAction,
}: {
  groups: KdsOrderGroup[];
  now: number;
  unservedCount: number;
  avgElapsedMinutes: number;
  setItemStatusAction: (orderItemId: string, nextStatus: KitchenStatus) => Promise<void>;
  markOrderServedAction: (orderId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [showServed, setShowServed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const visibleGroups = groups.filter((g) => showServed || g.items.some((i) => i.kitchenStatus !== 'served'));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="未提供品目" value={`${unservedCount}件`} tone={unservedCount > 0 ? 'primary' : 'default'} />
        <StatCard
          label="平均経過時間"
          value={`${avgElapsedMinutes}分`}
          tone={avgElapsedMinutes >= 25 ? 'danger' : avgElapsedMinutes >= 15 ? 'warning' : 'default'}
        />
        <label className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm font-medium text-gray-700 sm:col-span-1">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            checked={showServed}
            onChange={(e) => setShowServed(e.target.checked)}
          />
          提供済を表示（直近1時間）
        </label>
      </div>

      {visibleGroups.length === 0 ? (
        <EmptyState title="現在調理待ちの注文はありません" description="新しい注文が入るとここに表示されます" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleGroups.map((g) => (
            <OrderCard
              key={g.orderId}
              group={g}
              now={now}
              showServed={showServed}
              setItemStatusAction={setItemStatusAction}
              markOrderServedAction={markOrderServedAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
