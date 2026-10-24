'use client';

/**
 * レジ（iPad）ホームの時刻：日付（1行）＋ 時:分（細い数字・「:」が点滅）＋ 秒。
 * 色は オーダー・会計 と同じ濃い青（2026-10-19 Ronnie）。
 * 最初の描画はサーバーの時刻（props）で行い、ハイドレーションのずれを出さない。そのあと1秒ごとに進める。
 */
import { useEffect, useState } from 'react';
import { blueGradientText, REGI_BLUE, thinDigits } from './regi-font';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function partsJst(ms: number) {
  // JST（UTC+9）で年月日・時分秒を出す（端末のタイムゾーンに左右されない）
  const d = new Date(ms + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`,
    hh: p(d.getUTCHours()),
    mm: p(d.getUTCMinutes()),
    ss: p(d.getUTCSeconds()),
  };
}

export function RegiClock({ initialMs }: { initialMs: number }) {
  const [now, setNow] = useState(initialMs);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const t = partsJst(now);
  return (
    <div className={`${thinDigits.className} flex items-baseline gap-3.5`} style={{ color: REGI_BLUE }}>
      <span className="text-[13px] font-medium whitespace-nowrap opacity-85 lg:text-[15px]">{t.date}</span>
      <span className="relative text-[44px] leading-none lg:text-[60px] font-extralight tracking-[-0.02em] [font-variant-numeric:tabular-nums]">
        <span style={blueGradientText}>{t.hh}</span>
        <span className="regi-colon inline-block px-px" style={blueGradientText}>
          :
        </span>
        <span style={blueGradientText}>{t.mm}</span>
        <span className="absolute bottom-[4px] left-full ml-1.5 text-[16px] font-light opacity-75 lg:bottom-[5px] lg:text-[20px]">{t.ss}</span>
      </span>
    </div>
  );
}
