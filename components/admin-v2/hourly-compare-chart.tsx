import type { HourlyCompare } from '@/lib/home-v2';

/** 目盛りのきりのいい上限（1・2・5 の倍数） */
function niceMax(v: number): number {
  if (v <= 0) return 10_000;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function manLabel(v: number): string {
  if (v === 0) return '0';
  if (v >= 10_000) return `${(v / 10_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万`;
  return `${Math.round(v / 1000)}千`;
}

/**
 * 時間帯別の売上（棒＝本日・点線＝前週の同じ曜日）。サーバーで描く SVG（新しい管理画面のホーム）。
 * nowHour：いまの時（その時の棒は途中なので薄く）
 */
export function HourlyCompareChart({ data, nowHour }: { data: HourlyCompare; nowHour: number }) {
  const W = 760;
  const H = 244;
  const x0 = 48;
  const x1 = 748;
  const y0 = 16;
  const y1 = 216;
  const n = Math.max(1, data.hours.length);
  const slot = (x1 - x0) / n;
  const bw = Math.min(28, slot * 0.55);
  const max = niceMax(Math.max(...data.today, ...data.lastWeek, 0));
  const y = (v: number) => y1 - (v / max) * (y1 - y0);
  const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];
  const nowIdx = data.hours.indexOf(nowHour);
  const points = data.hours.map((_, i) => `${(x0 + slot * i + slot / 2).toFixed(1)},${y(data.lastWeek[i]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="時間帯別の売上（本日と前週の同じ曜日）" className="block h-auto">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke="#efeaf6" strokeWidth={1} />
          <text x={x0 - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#6b6180">
            {manLabel(t)}
          </text>
        </g>
      ))}
      {data.hours.map((h, i) => {
        const cx = x0 + slot * i + slot / 2;
        const v = data.today[i];
        return (
          <g key={h}>
            {v > 0 && (
              <rect
                x={cx - bw / 2}
                y={y(v)}
                width={bw}
                height={Math.max(0, y1 - y(v))}
                rx={4}
                fill={i === nowIdx ? '#c4a8f5' : '#7b3fe4'}
              />
            )}
            <text x={cx} y={y1 + 18} textAnchor="middle" fontSize={11} fill="#6b6180">
              {h}時
            </text>
          </g>
        );
      })}
      <polyline points={points} fill="none" stroke="#d4891c" strokeWidth={2.5} strokeLinejoin="round" strokeDasharray="6 4" />
      {nowIdx >= 0 && (
        <line
          x1={x0 + slot * nowIdx + slot / 2}
          x2={x0 + slot * nowIdx + slot / 2}
          y1={y0}
          y2={y1}
          stroke="#15121a"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      )}
    </svg>
  );
}
