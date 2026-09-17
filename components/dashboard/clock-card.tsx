'use client';

/**
 * 時計カード（プロトタイプの .card.clock）。royal 地・白文字。
 * 描画中に現在時刻を読まないよう、時刻は外部ストア（1秒ごと）から useSyncExternalStore で受け取る。
 * 地名・天気はサーバー側の Suspense スロット（weather-slot.tsx）で後から差し込む。
 */
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

let clockNow = 0;
function subscribeClock(onChange: () => void) {
  const tick = () => {
    clockNow = Date.now();
    onChange();
  };
  const first = setTimeout(tick, 0);
  const timer = setInterval(tick, 1000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
const getClock = () => clockNow;
const getServerClock = () => 0;

const fmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function tokyoHms(ms: number): { h: number; m: number; s: number } {
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { h: get('hour') % 24, m: get('minute'), s: get('second') };
}

// 文字盤の目盛り（60本。5分ごとは太く長く）
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const a = (i * 6 * Math.PI) / 180;
  const major = i % 5 === 0;
  const r1 = major ? 78 : 84;
  const r2 = 90;
  return {
    i,
    major,
    x1: (100 + r1 * Math.sin(a)).toFixed(2),
    y1: (100 - r1 * Math.cos(a)).toFixed(2),
    x2: (100 + r2 * Math.sin(a)).toFixed(2),
    y2: (100 - r2 * Math.cos(a)).toFixed(2),
  };
});

const pad = (n: number) => String(n).padStart(2, '0');

export function ClockCard({
  place,
  weather,
  className,
}: {
  /** 地名（英語・大文字） */
  place: React.ReactNode;
  /** 天気（取得できなければ null） */
  weather: React.ReactNode;
  className?: string;
}) {
  const now = useSyncExternalStore(subscribeClock, getClock, getServerClock);
  const ready = now > 0;
  const { h, m, s } = ready ? tokyoHms(now) : { h: 0, m: 0, s: 0 };
  const hourDeg = ((h % 12) + m / 60) * 30;
  const minDeg = (m + s / 60) * 6;
  const secDeg = s * 6;

  return (
    <article
      aria-label="時計と天気"
      className={cn(
        'ui-card flex min-w-0 flex-col justify-center gap-[18px] border border-royal bg-royal px-[22px] pt-[18px] pb-5 text-white',
        className
      )}
    >
      <div className="flex min-h-4 items-center justify-between font-[family-name:var(--font-num)] text-[12.5px] leading-none font-semibold tracking-[0.14em] text-white uppercase">
        {place}
      </div>

      <div className="mx-auto aspect-square w-[min(100%,200px)] max-w-full">
        <svg viewBox="0 0 200 200" aria-hidden="true" className="h-full w-full">
          <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="2" />
          <g stroke="#fff" strokeLinecap="round">
            {TICKS.map((t) => (
              <line
                key={t.i}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                strokeWidth={t.major ? 2.5 : 1}
                opacity={t.major ? 0.95 : 0.45}
              />
            ))}
          </g>
          {ready && (
            <>
              <line x1="100" y1="100" x2="100" y2="54" stroke="#fff" strokeWidth="5" strokeLinecap="round" transform={`rotate(${hourDeg} 100 100)`} />
              <line x1="100" y1="100" x2="100" y2="32" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" transform={`rotate(${minDeg} 100 100)`} />
              <line x1="100" y1="112" x2="100" y2="26" stroke="var(--color-gold)" strokeWidth="1.5" strokeLinecap="round" transform={`rotate(${secDeg} 100 100)`} />
            </>
          )}
          <circle cx="100" cy="100" r="4" fill="var(--color-gold)" />
        </svg>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div
          className="font-[family-name:var(--font-num)] text-[46px] leading-none font-extrabold tracking-[-0.01em] text-white tabular-nums"
          role="timer"
          aria-live="off"
        >
          {ready ? `${pad(h)}:${pad(m)}` : '--:--'}
          <small className="ml-1 text-lg font-semibold text-[#D9CCF3]">{ready ? pad(s) : '--'}</small>
        </div>
        {weather}
      </div>
    </article>
  );
}
