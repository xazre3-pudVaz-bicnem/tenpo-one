'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface UseStoreRealtimeRefreshOptions {
  /** 対象店舗ID。空文字/undefinedの間は購読しない */
  storeId: string;
  /** 購読するテーブル名（例: ['orders', 'order_items']） */
  tables: string[];
  /** 変更受信からrouter.refresh()実行までの防抖時間（ms） */
  debounceMs?: number;
  /** Realtimeが機能しない場合に備えた、常時併走させるポーリング間隔（ms） */
  fallbackMs?: number;
}

export interface UseStoreRealtimeRefreshResult {
  /** 直近にRealtime変更イベントを受信した時刻（UI表示用。未受信ならnull） */
  lastEventAt: number | null;
}

/**
 * 店舗単位でSupabase Realtime（postgres_changes）を購読し、対象テーブルに変更があれば
 * router.refresh()でサーバーコンポーネントを再取得する共有フック。
 *
 * 【設計意図】
 * migration 00014 で publication supabase_realtime に対象テーブルを追加済みで、
 * RLSにより購読者は自身がアクセス可能な行（＝自店舗の行）のみ受信する。
 * そのうえで filter: `store_id=eq.${storeId}` を指定し、無関係な変更で無駄な
 * refreshが走らないようにする。
 *
 * Realtimeのチャンネル切断・再接続を厳密に検知して出し分けるロジックは複雑になり、
 * かえって「更新されない」バグの温床になりやすい。そのため本フックでは
 * 切断検知は行わず、fallbackMs間隔のポーリング（router.refresh）を常に並走させる
 * シンプルな二重化構成にしている。Realtimeが機能していれば、変更検知後
 * debounceMs（既定800ms）で先にrefreshが走るため体感的には即時反映となり、
 * 万一Realtimeが切断・遅延していてもfallbackMs（既定30秒）以内には必ず反映される。
 */
export function useStoreRealtimeRefresh({
  storeId,
  tables,
  debounceMs = 800,
  fallbackMs = 30000,
}: UseStoreRealtimeRefreshOptions): UseStoreRealtimeRefreshResult {
  const router = useRouter();
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  // tables配列は呼び出し側でインラインリテラルを渡すことが多く参照が毎レンダー変わるため、
  // 内容（結合文字列）で依存値を安定化させる。
  const tablesKey = tables.join(',');

  useEffect(() => {
    if (!storeId || !tablesKey) return;

    const supabase = createClient();
    const tableList = tablesKey.split(',');
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      setLastEventAt(Date.now());
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        router.refresh();
      }, debounceMs);
    };

    let channel = supabase.channel(`store-${storeId}-${tableList.join()}`);
    for (const table of tableList) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `store_id=eq.${storeId}` },
        () => scheduleRefresh()
      );
    }
    channel.subscribe();

    // フォールバック・ポーリング: Realtimeの接続状態を問わず常に併走させる（設計意図は上記コメント参照）
    const fallbackInterval = setInterval(() => {
      router.refresh();
    }, fallbackMs);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(fallbackInterval);
      supabase.removeChannel(channel);
    };
  }, [storeId, tablesKey, debounceMs, fallbackMs, router]);

  return { lastEventAt };
}
