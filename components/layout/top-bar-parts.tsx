'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, House } from 'lucide-react';
import { screenTitleFor } from '@/lib/nav';

/** 上部バー中央の画面タイトル（日本語＋英語） */
export function ScreenTitle() {
  const pathname = usePathname();
  const t = screenTitleFor(pathname);
  if (!t) return null;
  return (
    // 画面名は右のアイコンに重ならないよう、狭いときは英語を出さず、足りなければ省略する
    <div className="min-w-0 max-w-full truncate text-center text-[17px] font-bold tracking-[0.12em] text-white">
      {t.label}
      <span className="ml-1.5 hidden align-middle font-[family-name:var(--font-num)] text-[11px] font-semibold tracking-[0.06em] text-[#D9CCF3] xl:inline">
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
    // 家のマーク付き・少し大きめの立体ボタン（2026-09-24 店舗要望）
    <Link
      href="/app/dashboard"
      className="tap3d-dark hidden h-11 shrink-0 items-center gap-1 rounded-xl bg-white/12 pr-4 pl-2 text-[15px] font-bold whitespace-nowrap text-white hover:bg-white/20 md:inline-flex"
    >
      <ChevronLeft className="h-[18px] w-[18px] shrink-0 text-white/70" />
      <House className="h-[19px] w-[19px] shrink-0" />
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
