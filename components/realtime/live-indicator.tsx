'use client';

/**
 * Realtime購読が有効な画面のヘッダーに添える、小さな「更新中」インジケーター。
 * lastEventAt は useStoreRealtimeRefresh の戻り値をそのまま渡す想定。
 */
export function LiveIndicator({ lastEventAt }: { lastEventAt: number | null }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      リアルタイム更新中
      {lastEventAt != null && (
        <span className="tabular-nums text-gray-400">
          （最終更新 {new Date(lastEventAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}）
        </span>
      )}
    </span>
  );
}
