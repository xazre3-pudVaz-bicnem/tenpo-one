/**
 * 時計カードに差し込む地名・天気（サーバーコンポーネント）。
 * ClockCard の中で <Suspense> に包んで使い、天気の取得待ちでページ全体を止めない。
 * 同じリクエスト内の取得は React.cache で1回にまとめる。
 */
import { cache } from 'react';
import { getStoreWeather, placeJaFromAddress, type StoreWeather, type WeatherIcon } from '@/lib/weather';
import { blueGradientText, REGI_BLUE, thinDigits } from './regi-font';

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
        <span className="text-[11.5px] text-ink-3">{w.weather.label}</span>
      </div>
    </div>
  );
}

// 白いカードの上に描く（2026-10-18 時計カードを白に）
const SUN = '#e9a23b';
const CLOUD_FILL = '#ffffff';
const CLOUD_LINE = '#a89e92';

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
          <path d={CLOUD_PATH} fill={CLOUD_FILL} stroke={CLOUD_LINE} strokeWidth="2" strokeLinejoin="round" />
        </>
      )}
      {icon !== 'sun' && icon !== 'partly' && (
        <path d={BIG_CLOUD_PATH} fill={CLOUD_FILL} stroke={CLOUD_LINE} strokeWidth="2" strokeLinejoin="round" />
      )}
      {(icon === 'rain' || icon === 'drizzle') && (
        <g stroke="#3b82c4" strokeWidth="2" strokeLinecap="round">
          <line x1="14" y1="33" x2="12" y2="38" />
          {icon === 'rain' && <line x1="20" y1="33" x2="18" y2="38" />}
          <line x1="26" y1="33" x2="24" y2="38" />
        </g>
      )}
      {icon === 'snow' && (
        <g fill="#8fb3d9">
          <circle cx="13" cy="35" r="1.6" />
          <circle cx="20" cy="37" r="1.6" />
          <circle cx="27" cy="35" r="1.6" />
        </g>
      )}
      {icon === 'fog' && (
        <g stroke={CLOUD_LINE} strokeWidth="2" strokeLinecap="round" opacity="0.8">
          <line x1="9" y1="34" x2="31" y2="34" />
          <line x1="13" y1="38" x2="27" y2="38" />
        </g>
      )}
      {icon === 'thunder' && <path d="M21 30l-4 6h4l-2 4 6-7h-4l2-3z" fill={SUN} />}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// レジ（iPad）ホーム：気温 → 天気アイコン → 地名 を1行で（2026-10-19 Ronnie の新しいレイアウト）。
// 文字とアイコンは オーダー・会計 と同じ濃い青。地名は店舗の住所から（GPS は使わない）。
// ---------------------------------------------------------------------------

export async function RegiWeather({ address }: { address: string | null }) {
  const w = await loadWeather(address);
  return (
    <RegiWeatherView
      temperature={w?.temperature ?? null}
      icon={w?.weather?.icon ?? null}
      night={w?.isDay === false}
      place={placeJaFromAddress(address)}
    />
  );
}

/** 表示だけ（気温 → 天気アイコン → 地名。全部 下にそろえて1行） */
export function RegiWeatherView({
  temperature,
  icon,
  night,
  place,
}: {
  temperature: number | null;
  icon: WeatherIcon | null;
  night: boolean;
  place: string | null;
}) {
  if (temperature == null && !place) return null;
  return (
    <div className={`${thinDigits.className} flex items-baseline gap-2.5`} style={{ color: REGI_BLUE }}>
      {temperature != null && (
        <span className="text-[44px] leading-none font-extralight lg:text-[60px] tracking-[-0.02em] [font-variant-numeric:tabular-nums]" style={blueGradientText}>
          {temperature}°
        </span>
      )}
      {temperature != null && icon && (
        <span className="self-end pb-2">
          <RegiWeatherGlyph icon={icon} night={night} />
        </span>
      )}
      {place && (
        <span className="ml-1.5 inline-flex items-center gap-1 text-[13px] font-medium whitespace-nowrap opacity-85 lg:text-[15px]">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21 3L3 10.5l7.5 2.9L13.4 21z" />
          </svg>
          {place}
        </span>
      )}
    </div>
  );
}

const RG = REGI_BLUE;
const RG_CLOUD = 'M12 25h17a7 7 0 0 0 .6-14A9.5 9.5 0 0 0 11.3 12 6.5 6.5 0 0 0 12 25z';

/** レジのホーム用の天気アイコン（1色・濃い青）。晴れの夜は月 */
export function RegiWeatherGlyph({ icon, night }: { icon: WeatherIcon; night: boolean }) {
  const moon = <path d="M25.5 6.5a13 13 0 1 0 8 21.5A12 12 0 0 1 25.5 6.5z" fill={RG} />;
  const sun = (
    <g>
      <circle cx="20" cy="20" r="8" fill={RG} />
      <g stroke={RG} strokeWidth="2.6" strokeLinecap="round">
        <path d="M20 3.5v4M20 32.5v4M3.5 20h4M32.5 20h4M8.3 8.3l2.8 2.8M28.9 28.9l2.8 2.8M8.3 31.7l2.8-2.8M28.9 11.1l2.8-2.8" />
      </g>
    </g>
  );
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="block shrink-0">
      {icon === 'sun' && (night ? moon : sun)}
      {icon === 'partly' && (
        <>
          <g transform="translate(14 -2) scale(0.55)">{night ? moon : sun}</g>
          <path d="M12 33h17a7 7 0 0 0 .6-14A9.5 9.5 0 0 0 11.3 20 6.5 6.5 0 0 0 12 33z" fill={RG} />
        </>
      )}
      {icon !== 'sun' && icon !== 'partly' && <path d={RG_CLOUD} fill={RG} />}
      {(icon === 'rain' || icon === 'drizzle') && (
        <g stroke={RG} strokeWidth="2.6" strokeLinecap="round">
          <path d="M14 29l-2 5M28 29l-2 5" />
          {icon === 'rain' && <path d="M21 29l-2 5" />}
        </g>
      )}
      {icon === 'snow' && (
        <g fill={RG}>
          <circle cx="13" cy="31" r="1.8" />
          <circle cx="20" cy="34" r="1.8" />
          <circle cx="27" cy="31" r="1.8" />
        </g>
      )}
      {icon === 'fog' && (
        <g stroke={RG} strokeWidth="2.4" strokeLinecap="round">
          <path d="M9 30h22M13 35h14" />
        </g>
      )}
      {icon === 'thunder' && <path d="M21 25l-5 8h4l-2 6 7-9h-4l2-5z" fill={RG} />}
    </svg>
  );
}
