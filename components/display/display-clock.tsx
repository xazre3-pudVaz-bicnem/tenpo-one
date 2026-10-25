'use client';

import { useEffect, useState } from 'react';

/** 画面の右上の時計（サーバーで描いた時刻から始めて毎秒進める） */
export function DisplayClock({ now, className }: { now: number; className?: string }) {
  const [clock, setClock] = useState(now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className={className}>
      {new Date(clock).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}
