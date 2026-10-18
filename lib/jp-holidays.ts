/**
 * 日本の祝日（カレンダーで赤く出す。2026-10-19 Ronnie「レストランボードの日付選択のように」）。
 * 祝日法の決まり（固定日・ハッピーマンデー・春分秋分の計算式・振替休日・国民の休日）で計算する（1980〜2099年）。
 * 特別な年だけの祝日（即位の日など）は入れていない。
 */

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** その月の n 回目の月曜 */
function nthMonday(y: number, m: number, n: number): number {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const firstMonday = 1 + ((8 - first) % 7);
  return firstMonday + (n - 1) * 7;
}

function equinox(y: number, base: number): number {
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

const cache = new Map<number, Map<string, string>>();

/** その年の祝日（'YYYY-MM-DD' → 名前） */
export function japaneseHolidays(y: number): Map<string, string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const h = new Map<string, string>();
  h.set(ymd(y, 1, 1), '元日');
  h.set(ymd(y, 1, nthMonday(y, 1, 2)), '成人の日');
  h.set(ymd(y, 2, 11), '建国記念の日');
  if (y >= 2020) h.set(ymd(y, 2, 23), '天皇誕生日');
  h.set(ymd(y, 3, equinox(y, 20.8431)), '春分の日');
  h.set(ymd(y, 4, 29), '昭和の日');
  h.set(ymd(y, 5, 3), '憲法記念日');
  h.set(ymd(y, 5, 4), 'みどりの日');
  h.set(ymd(y, 5, 5), 'こどもの日');
  if (y !== 2020 && y !== 2021) h.set(ymd(y, 7, nthMonday(y, 7, 3)), '海の日');
  if (y >= 2016 && y !== 2020 && y !== 2021) h.set(ymd(y, 8, 11), '山の日');
  h.set(ymd(y, 9, nthMonday(y, 9, 3)), '敬老の日');
  h.set(ymd(y, 9, equinox(y, 23.2488)), '秋分の日');
  if (y !== 2020 && y !== 2021) h.set(ymd(y, 10, nthMonday(y, 10, 2)), y >= 2020 ? 'スポーツの日' : '体育の日');
  h.set(ymd(y, 11, 3), '文化の日');
  h.set(ymd(y, 11, 23), '勤労感謝の日');

  // 国民の休日：祝日と祝日にはさまれた平日（9月の敬老の日と秋分の日のあいだ など）
  const dates = [...h.keys()].sort();
  for (const d of dates) {
    const t = Date.parse(`${d}T00:00:00Z`);
    const next = new Date(t + 2 * 86400000).toISOString().slice(0, 10);
    const mid = new Date(t + 86400000);
    const midKey = mid.toISOString().slice(0, 10);
    if (h.has(next) && !h.has(midKey) && mid.getUTCDay() !== 0) h.set(midKey, '国民の休日');
  }
  // 振替休日：日曜の祝日のあと、最初の祝日でない日
  for (const d of [...h.keys()].sort()) {
    const t = Date.parse(`${d}T00:00:00Z`);
    if (new Date(t).getUTCDay() !== 0) continue;
    let k = t + 86400000;
    while (h.has(new Date(k).toISOString().slice(0, 10))) k += 86400000;
    h.set(new Date(k).toISOString().slice(0, 10), '振替休日');
  }
  cache.set(y, h);
  return h;
}

export function holidayName(date: string): string | null {
  const y = Number(date.slice(0, 4));
  if (!Number.isFinite(y)) return null;
  return japaneseHolidays(y).get(date) ?? null;
}
