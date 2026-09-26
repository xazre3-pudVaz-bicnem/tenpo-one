/**
 * 営業時間の「営業日の時刻」表記（2026-09-27 Ronnie「閉店は同じ営業日なら 24時・25時 … 朝6時まで入れられるように」）。
 *
 * - 画面では 24:00〜30:00（= 翌朝 6:00）まで選べる。深夜営業の店は閉店 29:00 のように書く
 * - DB（business_hours.open_time / close_time / last_entry_time）は time 型なので、24:00 以上は 24 を引いて保存する
 *   （25:00 → 01:00）。読むときは「開店より前の時刻＝翌日」として 24 を足して表示に戻す
 * - 台帳（app/app/reservations）と予約枠（get_booking_availability）も「閉店が開店より前なら翌日」で扱う
 * ここは純粋な関数だけ（DB・React 非依存・テスト対象）。
 */

/** 画面で選べる最後の時刻（翌朝 6:00） */
export const BUSINESS_DAY_MAX_MINUTES = 30 * 60;
/** 選択肢の刻み（分） */
export const BUSINESS_HOURS_STEP = 15;

/** 'HH:MM'（HH は 00〜30）→ 分。壊れた値は null */
export function hmToMin(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 0 || mm > 59 || h < 0 || h > 30) return null;
  const total = h * 60 + mm;
  return total <= BUSINESS_DAY_MAX_MINUTES ? total : null;
}

/** 分 → 'HH:MM'（24 以上もそのまま '25:00'） */
export function minToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 画面の選択肢（00:00 〜 30:00、15分刻み） */
export function businessHourOptions(fromMin = 0, toMin = BUSINESS_DAY_MAX_MINUTES): string[] {
  const out: string[] = [];
  for (let m = fromMin; m <= toMin; m += BUSINESS_HOURS_STEP) out.push(minToHm(m));
  return out;
}

/** 画面の値（'25:00'）→ DB の time（'01:00'）。24:00 は '00:00' */
export function toDbTime(v: string | null | undefined): string | null {
  const min = hmToMin(v);
  if (min == null) return null;
  return minToHm(min % (24 * 60));
}

/**
 * DB の time（'01:00'）→ 画面の値。開店（'HH:MM'）より前（同じも含む）なら翌日として +24h（'25:00'）。
 * 開店が無ければそのまま。
 */
export function toBusinessDayTime(dbTime: string | null | undefined, openTime: string | null | undefined): string | null {
  if (!dbTime) return null;
  const t = hmToMin(dbTime.slice(0, 5));
  if (t == null) return null;
  const o = hmToMin(openTime?.slice(0, 5) ?? null);
  if (o != null && t <= o) return minToHm(t + 24 * 60);
  return minToHm(t);
}

/** 「開店〜閉店（最終入店）」の表示用。閉店・最終入店は営業日の表記（25:00 など） */
export function businessHoursLabel(open: string | null | undefined, close: string | null | undefined, lastEntry?: string | null): string {
  if (!open || !close) return '';
  const o = open.slice(0, 5);
  const c = toBusinessDayTime(close, o) ?? close.slice(0, 5);
  const l = lastEntry ? (toBusinessDayTime(lastEntry, o) ?? lastEntry.slice(0, 5)) : null;
  return `${o}〜${c}${l ? `（最終入店 ${l}）` : ''}`;
}

/** 開店・閉店・最終入店（画面の値）の整合性。問題があれば日本語の理由、無ければ null */
export function businessDayProblem(open: string | null, close: string | null, lastEntry: string | null): string | null {
  const o = hmToMin(open);
  const c = hmToMin(close);
  if (o == null || c == null) return '開店・閉店時刻を入力してください';
  if (o >= 24 * 60) return '開店は 23:45 までにしてください';
  if (c <= o) return '閉店は開店より後にしてください（深夜は 24:00〜30:00 で入れます）';
  if (lastEntry) {
    const l = hmToMin(lastEntry);
    if (l == null) return '最終入店の時刻が正しくありません';
    if (l < o || l > c) return '最終入店は開店〜閉店の間にしてください';
  }
  return null;
}
