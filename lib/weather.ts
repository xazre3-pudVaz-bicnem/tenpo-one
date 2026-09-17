/**
 * ホーム画面の時計カード用: 店舗所在地の英語表記と現在の天気（Open-Meteo・APIキー不要）。
 *
 * - 住所の解析・WMO天気コードの変換は純関数（tests/weather.test.ts）。
 * - 取得はサーバー側のみ。fetch は 30分キャッシュ（next.revalidate=1800）。
 * - Open-Meteo Geocoding は日本語の地名を language=ja でしか引けないため、
 *   日本語で検索 → 見つかった地点IDを language=en で引き直して英語名を得る。
 * - 失敗しても例外は投げない（天気は出さない／地名は TOKYO にフォールバック）。
 */

// ---------------------------------------------------------------------------
// 住所の解析（純関数）
// ---------------------------------------------------------------------------

export interface ParsedAddress {
  /** 都道府県（例: 東京都） */
  prefecture: string | null;
  /** 市・町・村（東京23区は null。例: 横浜市 / 軽井沢町） */
  city: string | null;
  /** 区（東京23区・政令指定都市の区。例: 新宿区 / 中区） */
  ward: string | null;
  /** 町名（丁目・番地を除いた部分。例: 高田馬場 / 西新宿） */
  town: string | null;
}

const PREF_RE = /^(東京都|北海道|京都府|大阪府|[^\s\d都道府県]{2,3}県)/;
const KANJI_NUM = '一二三四五六七八九十〇';

/** 全角英数・記号を半角に寄せ、空白を除く */
function normalize(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－―‐ー−]/g, '-')
    .replace(/^〒?\s*\d{3}-?\d{4}\s*/, '')
    .trim();
}

/** 住所文字列を都道府県・市区町村・町名に分解する。解析できない部分は null。 */
export function parseJapaneseAddress(address: string | null | undefined): ParsedAddress {
  const result: ParsedAddress = { prefecture: null, city: null, ward: null, town: null };
  if (!address) return result;
  let rest = normalize(address);

  const pref = rest.match(PREF_RE);
  if (pref) {
    result.prefecture = pref[1];
    rest = rest.slice(pref[1].length);
  }

  // 郡（例: 北佐久郡軽井沢町）は読み飛ばす
  const gun = rest.match(/^([^\s\d]{1,4}郡)(?=[^\s\d]{1,5}[町村])/);
  if (gun) rest = rest.slice(gun[1].length);

  const isTokyoWard = result.prefecture === '東京都' && /^[^\s\d]{1,4}?区/.test(rest) && !/^[^\s\d]{1,5}?市/.test(rest);
  if (!isTokyoWard) {
    // 市（「市川市」「四日市市」のように市が続く名前にも対応）
    const city = rest.match(/^([^\s\d]{1,5}?市)(市)?/);
    if (city) {
      result.city = city[1] + (city[2] ?? '');
      rest = rest.slice(result.city.length);
    } else {
      const townCity = rest.match(/^([^\s\d]{1,5}?[町村])/);
      if (townCity && gun) {
        result.city = townCity[1];
        rest = rest.slice(townCity[1].length);
      }
    }
  }

  const ward = rest.match(/^([^\s\d]{1,4}?区)/);
  if (ward && (isTokyoWard || result.city)) {
    result.ward = ward[1];
    rest = rest.slice(ward[1].length);
  }

  // 町名: 数字・丁目・番地の手前まで
  const townMatch = rest.replace(/^大字/, '').match(/^([^\s\d\-,、（(]+)/);
  if (townMatch) {
    const town = townMatch[1]
      .replace(new RegExp(`[${KANJI_NUM}]+丁目.*$`), '')
      .replace(/(丁目|番地|番|号).*$/, '')
      .replace(new RegExp(`[${KANJI_NUM}]+$`), '')
      .replace(/字.*$/, '');
    if (town.length >= 2) result.town = town;
  }
  return result;
}

/** 行政区分の接尾辞（市・区・町・村・都・府・県）を外す */
export function stripAdminSuffix(name: string): string {
  if (name === '北海道') return name;
  return name.length > 2 ? name.replace(/(市|区|町|村|都|府|県)$/, '') : name;
}

export interface GeocodeCandidate {
  /** 検索語（日本語） */
  query: string;
  /** 検索結果の admin1（都道府県）がこれと一致するものだけ採用 */
  prefecture: string | null;
  /** 検索結果の admin2/admin3 のいずれかがこの名前（接尾辞の有無は問わない）を含むものだけ採用 */
  parent: string | null;
}

/** 住所から、細かい地名 → 粗い地名の順に検索候補を作る（重複は除く） */
export function geocodeCandidates(parsed: ParsedAddress): GeocodeCandidate[] {
  const list: GeocodeCandidate[] = [];
  const add = (query: string | null, parent: string | null) => {
    if (!query) return;
    if (list.some((c) => c.query === query)) return;
    list.push({ query, prefecture: parsed.prefecture, parent });
  };
  const parent = parsed.ward ?? parsed.city;
  if (parsed.town && parent) add(parsed.town, parent);
  if (parsed.ward) {
    add(stripAdminSuffix(parsed.ward), parsed.city);
    add(parsed.ward, parsed.city);
  }
  if (parsed.city) {
    add(parsed.city, null);
    add(stripAdminSuffix(parsed.city), null);
  }
  if (parsed.prefecture) add(parsed.prefecture, null);
  return list;
}

export interface GeoResultLike {
  id: number;
  name: string;
  admin1?: string;
  admin2?: string;
  admin3?: string;
  admin4?: string;
}

/** 候補の条件（都道府県・上位の市区）に合う検索結果を選ぶ */
export function pickGeoResult<T extends GeoResultLike>(results: T[], cand: GeocodeCandidate): T | null {
  const same = (a: string | undefined, b: string) => !!a && (a === b || stripAdminSuffix(a) === stripAdminSuffix(b));
  for (const r of results) {
    if (cand.prefecture && r.admin1 && !same(r.admin1, cand.prefecture)) continue;
    if (cand.parent && ![r.admin2, r.admin3, r.admin4].some((a) => same(a, cand.parent!))) continue;
    return r;
  }
  return null;
}

/** 英語の地名表記（例: "Takadanobaba, Tokyo" → "TAKADANOBABA, TOKYO"。同名の重複は省く） */
export function formatPlaceEn(name: string | null | undefined, admin1: string | null | undefined): string {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+(Prefecture|-ken|Ken)$/i, '').trim();
  const parts = [clean(name), clean(admin1)].filter(Boolean);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  return (unique.join(', ') || 'Tokyo').toUpperCase();
}

// ---------------------------------------------------------------------------
// WMO 天気コード（純関数）
// ---------------------------------------------------------------------------

export type WeatherIcon = 'sun' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

export interface WeatherLabel {
  label: string;
  icon: WeatherIcon;
}

/** Open-Meteo の weather_code（WMO 4677）を日本語ラベルとアイコン種別に変換する */
export function describeWeatherCode(code: number | null | undefined): WeatherLabel | null {
  if (code == null || !Number.isFinite(code)) return null;
  switch (code) {
    case 0:
      return { label: '快晴', icon: 'sun' };
    case 1:
      return { label: '晴れ', icon: 'sun' };
    case 2:
      return { label: '晴れ時々くもり', icon: 'partly' };
    case 3:
      return { label: 'くもり', icon: 'cloud' };
    case 45:
    case 48:
      return { label: '霧', icon: 'fog' };
    case 51:
    case 53:
    case 55:
      return { label: '霧雨', icon: 'drizzle' };
    case 56:
    case 57:
      return { label: '着氷性の霧雨', icon: 'drizzle' };
    case 61:
      return { label: '小雨', icon: 'rain' };
    case 63:
      return { label: '雨', icon: 'rain' };
    case 65:
      return { label: '強い雨', icon: 'rain' };
    case 66:
    case 67:
      return { label: '着氷性の雨', icon: 'rain' };
    case 71:
      return { label: '小雪', icon: 'snow' };
    case 73:
      return { label: '雪', icon: 'snow' };
    case 75:
      return { label: '大雪', icon: 'snow' };
    case 77:
      return { label: '霧雪', icon: 'snow' };
    case 80:
    case 81:
      return { label: 'にわか雨', icon: 'rain' };
    case 82:
      return { label: '激しいにわか雨', icon: 'rain' };
    case 85:
    case 86:
      return { label: 'にわか雪', icon: 'snow' };
    case 95:
      return { label: '雷雨', icon: 'thunder' };
    case 96:
    case 99:
      return { label: '雹を伴う雷雨', icon: 'thunder' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 取得（サーバー側）
// ---------------------------------------------------------------------------

export interface StoreWeather {
  /** 英語の地名（大文字） */
  placeEn: string;
  /** 現在の気温（℃・整数）。取得できなければ null */
  temperature: number | null;
  weather: WeatherLabel | null;
}

const TOKYO = { latitude: 35.6895, longitude: 139.69171, placeEn: 'TOKYO' };
const REVALIDATE = 1800;
const TIMEOUT_MS = 4000;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface GeoResult extends GeoResultLike {
  latitude: number;
  longitude: number;
}

async function geocode(address: string | null | undefined): Promise<{ latitude: number; longitude: number; placeEn: string }> {
  const candidates = geocodeCandidates(parseJapaneseAddress(address)).slice(0, 4);
  for (const cand of candidates) {
    const search = await getJson<{ results?: GeoResult[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cand.query)}&language=ja&count=10&countryCode=JP`
    );
    const hit = pickGeoResult(search?.results ?? [], cand);
    if (!hit) continue;
    const en = await getJson<GeoResult>(`https://geocoding-api.open-meteo.com/v1/get?id=${hit.id}&language=en`);
    return {
      latitude: hit.latitude,
      longitude: hit.longitude,
      placeEn: en ? formatPlaceEn(en.name, en.admin1) : TOKYO.placeEn,
    };
  }
  return TOKYO;
}

/** 店舗住所から英語の地名と現在の天気を取得する。どこで失敗しても例外は投げない。 */
export async function getStoreWeather(address: string | null | undefined): Promise<StoreWeather> {
  const place = await geocode(address);
  const forecast = await getJson<{ current?: { temperature_2m?: number; weather_code?: number } }>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&timezone=Asia%2FTokyo`
  );
  const temp = forecast?.current?.temperature_2m;
  return {
    placeEn: place.placeEn,
    temperature: typeof temp === 'number' && Number.isFinite(temp) ? Math.round(temp) : null,
    weather: describeWeatherCode(forecast?.current?.weather_code),
  };
}
