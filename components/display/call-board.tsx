'use client';

import { useEffect, useRef, useState } from 'react';
import { BellRing, Maximize2, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStoreRealtimeRefresh } from '@/components/realtime/use-store-refresh';
import { unlockAudio } from '@/components/kitchen/sound';
import { newlyReadyIds, type CallBoard, type CallBoardEntry } from '@/lib/display-monitor';
import { playChime } from './chime';

/** できあがってからこの時間は番号を光らせる */
const HIGHLIGHT_MS = 30_000;

/**
 * 呼び出しモニター（店のモニターに全画面で出す）。
 *   左「調理中」・右「できあがり」に、スタッフが見ている注文番号（#番号）を大きく出す。
 *   新しく「できあがり」に入った番号はチャイムを鳴らして光らせる。提供済・会計済みになった番号は自動で消える。
 * 更新は KDS と同じ（Supabase Realtime ＋ 15 秒ごとの読み直し）。
 */
export function CallBoardView({
  storeId,
  storeName,
  deviceName,
  board,
  now,
}: {
  storeId: string;
  storeName: string;
  deviceName: string;
  board: CallBoard;
  /** サーバーで描いた時刻（時計の初期値。ハイドレーションのずれを防ぐ） */
  now: number;
}) {
  useStoreRealtimeRefresh({ storeId, tables: ['order_items', 'orders'], fallbackMs: 15_000 });
  const [clock, setClock] = useState(now);
  const [soundOn, setSoundOn] = useState(false);
  const previousReady = useRef<Set<string> | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 新しくできあがった番号でチャイム（開いた直後の番号では鳴らさない）
  useEffect(() => {
    const fresh = newlyReadyIds(previousReady.current, board.ready);
    previousReady.current = new Set(board.ready.map((r) => r.orderId));
    if (fresh.length > 0 && soundOn) playChime();
  }, [board.ready, soundOn]);

  const enableSound = () => {
    unlockAudio();
    setSoundOn(true);
    playChime();
  };

  const requestFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const time = new Date(clock).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#1f1d1b] text-white">
      <header className="flex items-center justify-between gap-4 bg-[#292725] px-6 py-3">
        <div className="min-w-0">
          <p className="truncate text-xl font-bold">{storeName}</p>
          <p className="truncate text-xs text-white/50">{deviceName}・呼び出しモニター</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!soundOn && (
            <button
              type="button"
              onClick={enableSound}
              className="flex h-11 items-center gap-2 rounded-xl bg-[#bc5940] px-4 text-sm font-bold text-white"
            >
              <Volume2 className="h-5 w-5" aria-hidden />
              タップしてチャイムを鳴らす
            </button>
          )}
          <button
            type="button"
            onClick={requestFullscreen}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white"
            aria-label="全画面"
          >
            <Maximize2 className="h-5 w-5" aria-hidden />
          </button>
          <span className="font-manrope text-3xl font-extrabold tabular-nums">{time}</span>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-[2fr_3fr]">
        <section className="flex min-h-0 flex-col rounded-3xl bg-white/5 p-5">
          <h2 className="flex items-baseline justify-between border-b border-white/10 pb-3">
            <span className="text-[clamp(1.5rem,3vw,2.5rem)] font-extrabold text-white/80">調理中</span>
            <span className="text-sm font-bold text-white/40">{board.cooking.length}件</span>
          </h2>
          {board.cooking.length === 0 ? (
            <p className="mt-6 text-lg text-white/40">ありません</p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 content-start gap-3 lg:grid-cols-3">
              {board.cooking.map((e) => (
                <NumberTile key={e.orderId} entry={e} tone="cooking" />
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-h-0 flex-col rounded-3xl bg-[#15803d]/15 p-5 ring-2 ring-[#22c55e]/40">
          <h2 className="flex items-baseline justify-between border-b border-[#22c55e]/30 pb-3">
            <span className="flex items-center gap-3 text-[clamp(1.75rem,3.6vw,3rem)] font-extrabold text-[#4ade80]">
              <BellRing className="h-[0.9em] w-[0.9em]" aria-hidden />
              できあがり
            </span>
            <span className="text-base font-bold text-[#4ade80]/80">お受け取りください</span>
          </h2>
          {board.ready.length === 0 ? (
            <p className="mt-6 text-lg text-white/40">ありません</p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 content-start gap-4 lg:grid-cols-3">
              {board.ready.map((e) => (
                <NumberTile
                  key={e.orderId}
                  entry={e}
                  tone="ready"
                  fresh={clock - new Date(e.since).getTime() < HIGHLIGHT_MS}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function NumberTile({ entry, tone, fresh = false }: { entry: CallBoardEntry; tone: 'cooking' | 'ready'; fresh?: boolean }) {
  return (
    <li
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl px-3 py-4 text-center',
        tone === 'cooking' ? 'bg-white/10' : 'bg-[#16a34a] shadow-lg shadow-black/30',
        fresh && 'animate-pulse ring-4 ring-[#f6c77a]'
      )}
    >
      <span
        className={cn(
          'font-manrope font-extrabold leading-none tabular-nums',
          tone === 'cooking' ? 'text-[clamp(2rem,4.5vw,4rem)] text-white/85' : 'text-[clamp(2.75rem,6.5vw,6rem)] text-white'
        )}
      >
        {entry.orderNo}
      </span>
      {entry.tableName && (
        <span className={cn('mt-1 truncate text-sm font-bold', tone === 'cooking' ? 'text-white/50' : 'text-white/85')}>{entry.tableName}</span>
      )}
    </li>
  );
}
