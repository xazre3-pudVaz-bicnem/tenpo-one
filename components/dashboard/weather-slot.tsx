/**
 * 時計カードに差し込む地名・天気（サーバーコンポーネント）。
 * ClockCard の中で <Suspense> に包んで使い、天気の取得待ちでページ全体を止めない。
 * 同じリクエスト内の取得は React.cache で1回にまとめる。
 */
import { cache } from 'react';
import { getStoreWeather, type StoreWeather, type WeatherIcon } from '@/lib/weather';

const WEATHER_DEADLINE_MS = 6000;

const loadWeather = cache(async (address: string | null): Promise<StoreWeather | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), WEATHER_DEADLINE_MS);
  });
  try {
    return await Promise.race([getStoreWeather(address), deadline]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
});

export async function StorePlace({ address }: { address: string | null }) {
  const w = await loadWeather(address);
  return <span className="truncate">{w?.placeEn ?? 'TOKYO'}</span>;
}

export async function StoreWeatherInfo({ address }: { address: string | null }) {
  const w = await loadWeather(address);
  if (!w || w.temperature == null || !w.weather) return null;
  return (
    <div className="flex items-center gap-2.5">
      <WeatherGlyph icon={w.weather.icon} />
      <div className="flex flex-col leading-tight">
        <b className="text-[13px] font-bold tabular-nums">{w.temperature}°C</b>
        <span className="text-[11.5px] text-[#f0d2e2]">{w.weather.label}</span>
      </div>
    </div>
  );
}

const SUN = '#e9b866';
const CLOUD_FILL = '#6b3094';

function Sun({ cx = 15, cy = 15, r = 7 }: { cx?: number; cy?: number; r?: number }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={SUN} />
      <g stroke={SUN} strokeWidth="2" strokeLinecap="round">
        {rays.map((deg) => {
          const a = (deg * Math.PI) / 180;
          return (
            <line
              key={deg}
              x1={(cx + (r + 3.5) * Math.cos(a)).toFixed(2)}
              y1={(cy + (r + 3.5) * Math.sin(a)).toFixed(2)}
              x2={(cx + (r + 6) * Math.cos(a)).toFixed(2)}
              y2={(cy + (r + 6) * Math.sin(a)).toFixed(2)}
            />
          );
        })}
      </g>
    </g>
  );
}

const CLOUD_PATH = 'M17 34h13.5a5.5 5.5 0 0 0 .6-10.97A8 8 0 0 0 15.6 21.5 6.3 6.3 0 0 0 17 34z';
const BIG_CLOUD_PATH = 'M11 30h19a6.5 6.5 0 0 0 .7-12.96A9.5 9.5 0 0 0 12.4 15.5 7.3 7.3 0 0 0 11 30z';

/** 天気アイコン（プロトタイプの晴れ時々くもりの描き方に合わせた簡易SVG） */
export function WeatherGlyph({ icon }: { icon: WeatherIcon }) {
  return (
    <svg width="38" height="38" viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
      {icon === 'sun' && <Sun cx={20} cy={20} r={8} />}
      {icon === 'partly' && (
        <>
          <Sun />
          <path d={CLOUD_PATH} fill={CLOUD_FILL} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        </>
      )}
      {icon !== 'sun' && icon !== 'partly' && (
        <path d={BIG_CLOUD_PATH} fill={CLOUD_FILL} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      )}
      {(icon === 'rain' || icon === 'drizzle') && (
        <g stroke="#9FD0FF" strokeWidth="2" strokeLinecap="round">
          <line x1="14" y1="33" x2="12" y2="38" />
          {icon === 'rain' && <line x1="20" y1="33" x2="18" y2="38" />}
          <line x1="26" y1="33" x2="24" y2="38" />
        </g>
      )}
      {icon === 'snow' && (
        <g fill="#fff">
          <circle cx="13" cy="35" r="1.6" />
          <circle cx="20" cy="37" r="1.6" />
          <circle cx="27" cy="35" r="1.6" />
        </g>
      )}
      {icon === 'fog' && (
        <g stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.8">
          <line x1="9" y1="34" x2="31" y2="34" />
          <line x1="13" y1="38" x2="27" y2="38" />
        </g>
      )}
      {icon === 'thunder' && <path d="M21 30l-4 6h4l-2 4 6-7h-4l2-3z" fill={SUN} />}
    </svg>
  );
}
