'use client';

import { useStoreRealtimeRefresh } from './use-store-refresh';

/**
 * サーバーコンポーネントのページに埋め込むだけで、指定テーブルの変更をRealtime購読し
 * router.refresh()する透明ラッパー。UIは描画しない（表示が必要な画面は
 * useStoreRealtimeRefresh を直接使い、LiveIndicatorなどと組み合わせること）。
 */
export function StoreRealtimeRefresh({
  storeId,
  tables,
  debounceMs,
  fallbackMs,
}: {
  storeId: string;
  tables: string[];
  debounceMs?: number;
  fallbackMs?: number;
}) {
  useStoreRealtimeRefresh({ storeId, tables, debounceMs, fallbackMs });
  return null;
}
