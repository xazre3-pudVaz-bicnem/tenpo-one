/**
 * レジ精算レシートの「ランチ売上／ディナー売上」（2026-09-28 Ronnie）。
 * 区切りの時刻（既定 15:00）までにオーダーが始まった伝票をランチ、それより後をディナーとして
 * 売上・組・名様・単価を出す。区切りは 設定 > 営業時間・休業日 で店ごとに変えられる
 * （store_settings.settings.registerReport.lunchUntil）。純粋関数・テスト対象。
 */

export const DEFAULT_LUNCH_UNTIL = '15:00';

export interface DaypartSettings {
  /** 'HH:MM'。この時刻まで（含む）がランチ */
  lunchUntil: string;
}

export function isHHMM(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function daypartSettingsFrom(settings: unknown): DaypartSettings {
  const o = (settings && typeof settings === 'object' ? (settings as Record<string, unknown>).registerReport : null) as
    | Record<string, unknown>
    | null
    | undefined;
  return { lunchUntil: isHHMM(o?.lunchUntil) ? o.lunchUntil : DEFAULT_LUNCH_UNTIL };
}

export interface DaypartOrder {
  /** オーダーが始まった時刻（ISO）。無ければ createdAt を使う */
  openedAt: string | null;
  createdAt?: string | null;
  total: number;
  guests: number;
}

export interface DaypartTotals {
  sales: number;
  groups: number;
  guests: number;
  /** 単価＝売上÷名様（名様 0 なら 0） */
  avg: number;
}

export interface DaypartSplit {
  lunchUntil: string;
  /** 「15:01」のようにディナーの始まり（区切りの1分後） */
  dinnerFrom: string;
  lunch: DaypartTotals;
  dinner: DaypartTotals;
}

/** ISO 時刻 → JST の 'YYYY-MM-DD' と 'HH:MM' */
function jstParts(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
    time: d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

function plusOneMinute(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (h * 60 + m + 1) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * 伝票をランチ／ディナーに分ける。
 * - その営業日の日付で、区切りの時刻まで（含む）に始まった伝票 → ランチ
 * - それより後、または日付をまたいだ（深夜 01:00 など）伝票 → ディナー
 */
export function splitDaypart(orders: DaypartOrder[], businessDate: string, lunchUntil = DEFAULT_LUNCH_UNTIL): DaypartSplit {
  const empty = (): DaypartTotals => ({ sales: 0, groups: 0, guests: 0, avg: 0 });
  const lunch = empty();
  const dinner = empty();
  for (const o of orders) {
    const p = jstParts(o.openedAt ?? o.createdAt ?? '');
    const isLunch = !!p && p.date === businessDate.slice(0, 10) && p.time <= lunchUntil;
    const t = isLunch ? lunch : dinner;
    t.sales += o.total;
    t.groups += 1;
    t.guests += o.guests;
  }
  for (const t of [lunch, dinner]) t.avg = t.guests > 0 ? Math.round(t.sales / t.guests) : 0;
  return { lunchUntil, dinnerFrom: plusOneMinute(lunchUntil), lunch, dinner };
}

/**
 * お客様情報（レジ・ハンディ）で入れた 男性／女性 の人数は伝票メモに「男2・女1」の形で残る（lib/handy-visit.ts visitMemo）。
 * レジ精算の 客数の内訳 はそこから数える。無ければ null（「選択なし」扱い）
 */
export function guestGenderFromMemo(memo: string | null | undefined): { male: number; female: number } | null {
  if (!memo) return null;
  const m = /男(\d+)・女(\d+)/.exec(memo);
  if (!m) return null;
  return { male: Number(m[1]), female: Number(m[2]) };
}
