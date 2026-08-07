'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Maximize2, LayoutGrid, Rows3, Volume2 } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/state';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';
import { LiveIndicator } from '@/components/realtime/live-indicator';
import { OrderCard } from './order-card';
import { AggregateBoard } from './aggregate-board';
import { KdsSettingsPopover } from './kds-settings-popover';
import { unlockAudio, playBeep } from './sound';
import {
  STATION_FILTER_LABELS,
  STATION_FILTER_OPTIONS,
  aggregateKdsItems,
  type KdsOrderGroup,
  type KdsSettings,
  type KitchenStatus,
  type StationFilter,
} from './types';

/** URLの?stationパラメータからステーションタブを読み取る（不正値は「すべて」扱い） */
function parseStation(value: string | null): StationFilter {
  return (STATION_FILTER_OPTIONS as string[]).includes(value ?? '') ? (value as StationFilter) : 'all';
}

export function KdsBoard({
  storeId,
  groups,
  now,
  unservedCount,
  avgElapsedMinutes,
  kdsSettings,
  canManageSettings,
  setItemStatusAction,
  markOrderServedAction,
  updateKdsSettingsAction,
}: {
  storeId: string;
  groups: KdsOrderGroup[];
  now: number;
  unservedCount: number;
  avgElapsedMinutes: number;
  kdsSettings: KdsSettings;
  canManageSettings: boolean;
  setItemStatusAction: (orderItemId: string, nextStatus: KitchenStatus) => Promise<void>;
  markOrderServedAction: (orderId: string, onlyItemIds?: string[]) => Promise<void>;
  updateKdsSettingsAction: (storeId: string, settings: KdsSettings) => Promise<void>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showServed, setShowServed] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const prevPendingIdsRef = useRef<Set<string> | null>(null);

  // POS/QR双方の注文が同じ order_items を更新するため、orders/order_items の変更を
  // Supabase Realtimeで購読し、変更検知時にrouter.refresh()する（切断時は30秒ごとのフォールバックへ）。
  const { lastEventAt } = useStoreRealtimeRefresh({
    storeId,
    tables: ['order_items', 'orders'],
    fallbackMs: 30000,
  });

  // タブの選択状態はURLパラメータ（?station=）で保持する。10秒ごとの router.refresh() は
  // URLを変更しないため、この値は自動更新をまたいで維持される。
  const station = parseStation(searchParams.get('station'));

  const setStation = useCallback(
    (next: StationFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'all') params.delete('station');
      else params.set('station', next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const stationCounts = useMemo(() => {
    const counts: Record<StationFilter, number> = { all: 0, kitchen: 0, drink: 0, dessert: 0 };
    for (const g of groups) {
      for (const i of g.items) {
        if (!showServed && i.kitchenStatus === 'served') continue;
        counts.all += 1;
        counts[i.station] += 1;
      }
    }
    return counts;
  }, [groups, showServed]);

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => (showServed || i.kitchenStatus !== 'served') && (station === 'all' || i.station === station)),
    }))
    .filter((g) => g.items.length > 0);

  const aggregatedRows = useMemo(() => aggregateKdsItems(visibleGroups), [visibleGroups]);

  // 新規「未着手」品目を前回描画との差分で検知し、有効時のみビープを鳴らす。
  // 初回マウント時は基準集合を記録するだけで鳴らさない（既存の未着手を「新規」と誤検知しないため）。
  useEffect(() => {
    const currentPendingIds = new Set(
      groups.flatMap((g) => g.items.filter((i) => i.kitchenStatus === 'pending').map((i) => i.id))
    );
    if (prevPendingIdsRef.current) {
      const hasNew = [...currentPendingIds].some((id) => !prevPendingIdsRef.current!.has(id));
      if (hasNew && kdsSettings.sound && audioUnlocked) playBeep();
    }
    prevPendingIdsRef.current = currentPendingIds;
  }, [groups, kdsSettings.sound, audioUnlocked]);

  const handleUnlockAudio = () => {
    unlockAudio();
    setAudioUnlocked(true);
    playBeep();
  };

  const requestFullscreen = () => {
    document.documentElement.requestFullscreen().catch(() => {
      // 全画面化がブロックされた場合は何もしない（ブラウザ設定・権限による）
    });
  };

  const handleToggleAggregate = () => {
    void updateKdsSettingsAction(storeId, { ...kdsSettings, aggregate: !kdsSettings.aggregate });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1">
          {STATION_FILTER_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStation(s)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
                station === s ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100'
              )}
            >
              {STATION_FILTER_LABELS[s]}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  station === s ? 'bg-white/20' : 'bg-gray-100 text-gray-500'
                )}
              >
                {stationCounts[s]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveIndicator lastEventAt={lastEventAt} />
          {kdsSettings.sound && !audioUnlocked && (
            <Button variant="secondary" size="sm" onClick={handleUnlockAudio}>
              <Volume2 className="h-4 w-4" />
              音を有効化
            </Button>
          )}
          {canManageSettings && (
            <>
              <Button variant="secondary" size="sm" onClick={handleToggleAggregate}>
                {kdsSettings.aggregate ? <Rows3 className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
                {kdsSettings.aggregate ? '注文カード表示' : '品目集約表示'}
              </Button>
              <KdsSettingsPopover storeId={storeId} initial={kdsSettings} updateKdsSettingsAction={updateKdsSettingsAction} />
            </>
          )}
          <Button variant="secondary" size="sm" onClick={requestFullscreen}>
            <Maximize2 className="h-4 w-4" />
            全画面（解除はEsc）
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="未提供品目" value={`${unservedCount}件`} tone={unservedCount > 0 ? 'primary' : 'default'} />
        <StatCard
          label="平均経過時間"
          value={`${avgElapsedMinutes}分`}
          tone={avgElapsedMinutes >= kdsSettings.warn3 ? 'danger' : avgElapsedMinutes >= kdsSettings.warn2 ? 'warning' : 'default'}
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

      {kdsSettings.aggregate ? (
        <AggregateBoard rows={aggregatedRows} />
      ) : visibleGroups.length === 0 ? (
        <EmptyState title="現在調理待ちの注文はありません" description="新しい注文が入るとここに表示されます" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleGroups.map((g) => (
            <OrderCard
              key={g.orderId}
              group={g}
              now={now}
              showServed={showServed}
              kdsSettings={kdsSettings}
              setItemStatusAction={setItemStatusAction}
              markOrderServedAction={markOrderServedAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
