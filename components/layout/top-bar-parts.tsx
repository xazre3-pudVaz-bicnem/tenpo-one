'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { screenTitleFor } from '@/lib/nav';

/** 上部バー中央の画面タイトル（日本語＋英語） */
export function ScreenTitle() {
  const pathname = usePathname();
  const t = screenTitleFor(pathname);
  if (!t) return null;
  return (
    <div className="min-w-0 truncate text-center text-[17px] font-bold tracking-[0.12em] text-white">
      {t.label}
      <span className="ml-1.5 hidden align-middle font-[family-name:var(--font-num)] text-[11px] font-semibold tracking-[0.06em] text-[#D9CCF3] sm:inline">
        {t.en}
      </span>
    </div>
  );
}

/** ホーム以外の画面で左上に出す「ホーム」戻りボタン */
export function BackHome() {
  const pathname = usePathname();
  if (pathname === '/app/dashboard') return null;
  return (
    <Link
      href="/app/dashboard"
      className="hidden shrink-0 items-center gap-0.5 rounded-lg bg-white/12 py-1.5 pr-3 pl-1.5 text-[13px] font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/20 md:inline-flex"
    >
      <ChevronLeft className="h-[18px] w-[18px]" />
      ホーム
    </Link>
  );
}

// 描画中に Date.now() を呼ばないよう、時刻は外部ストアとして1秒ごとに更新する
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

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 日付と時刻（Asia/Tokyo） */
export function LiveClock() {
  const now = useSyncExternalStore(subscribeClock, getClock, getServerClock);
  if (!now) return <span className="w-[230px]" aria-hidden="true" />;
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday') || WEEKDAYS[new Date(now).getDay()];
  return (
    <span className="flex items-center gap-4 text-base font-bold whitespace-nowrap text-white tabular-nums">
      <span>
        {get('year')}/{get('month')}/{get('day')}（{weekday}）
      </span>
      <span>
        {get('hour')}:{get('minute')}:{get('second')}
      </span>
    </span>
  );
}
