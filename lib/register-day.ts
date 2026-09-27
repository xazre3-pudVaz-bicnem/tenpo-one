/**
 * レジの1営業日の流れ（2026-09-28 Ronnie）。純粋関数・テスト対象。DB は supabase/migrations/00087_register_day_continuity.sql。
 *
 *   ① ログイン：前の営業日のレジが閉まっていれば開局。閉まっていなければ開局は出さず、前の営業日のまま続ける
 *   ② 開局：レジの中の現金を数える。前回のレジクローズで残した額（翌準備金）と比べ、違えば ± と理由
 *   ③ 営業（売上・入出金）
 *   ④ レジ精算：現金を数える → 翌準備金（レジに残す）と 預入金（銀行・預り金）に分ける。足りなければ 準備金不足（マイナス）
 *   ⑤ 営業日完了（レジ精算のあとだけ）→ ログアウト → 翌日の開局
 */

/**
 * この流れを始める営業日＝レジ精算が必ず要る最初の営業日（2026-09-28 Ronnie）。
 *   「9/27 のレジを 9/28 に続けない」→「今日（9/28）からはレジ精算をしないと、次の日にレジが開かない。閉めて帰る」
 * これより前の営業日のレジは：次の日に続けない・自動で営業日完了にしない。時計がこの日より前なら：ログアウトを止めない・知らせを出さない。
 * 開局の比較は、前回のレジクローズで翌準備金が記録されたとき（＝この日の締めのあと）から効く。
 * DB（migration 00087）の app_business_date / open_register_session にも同じ日付を入れてある
 */
export const REGISTER_DAY_FLOW_FROM = '2026-09-28';

/** その営業日（'YYYY-MM-DD'）でこの流れが効くか */
export function registerDayFlowActive(date: string | null | undefined): boolean {
  return !!date && date >= REGISTER_DAY_FLOW_FROM;
}

/** 店舗設定 store_settings.settings.registerReport.nextFloat（翌準備金の目標・円）。無ければ null＝その日の釣銭準備金 */
export function nextFloatSettingFrom(settings: unknown): number | null {
  const rr = (settings as { registerReport?: { nextFloat?: unknown } } | null)?.registerReport;
  const v = rr?.nextFloat;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return null;
}

export interface ClosePlan {
  /** 翌準備金（レジに残す額） */
  nextFloat: number;
  /** 預入金（銀行・預り金。レジから出す額） */
  deposit: number;
  /** 準備金不足（目標に足りない額。0 なら足りている） */
  shortage: number;
  /** 目標（設定、無ければ その日の釣銭準備金） */
  target: number;
}

/**
 * レジ精算で数えた現金の分け方。
 * 例：開局 ¥100,000 → 買い物 −¥90,000 → 現金売上 ＋¥150,000 → 数えて ¥160,000
 *     → 翌準備金 ¥100,000・預入金 ¥60,000。現金売上が ¥50,000 なら ¥60,000 → 翌準備金 ¥60,000・預入金 ¥0・不足 ¥40,000
 * DB（close_register_session）と同じ計算。
 */
export function closePlan(input: { counted: number; openingFloat: number; nextFloatSetting: number | null }): ClosePlan {
  const target = input.nextFloatSetting ?? input.openingFloat;
  const counted = Math.max(0, Math.round(input.counted));
  const nextFloat = Math.min(counted, target);
  return { nextFloat, deposit: counted - nextFloat, shortage: Math.max(0, target - counted), target };
}

export interface OpeningCheck {
  /** 前回の翌準備金（比べる相手）。前回の記録が無ければ null＝比べない */
  expected: number | null;
  /** 数えた額 − 前回の翌準備金。比べないときは null */
  difference: number | null;
  /** 違うので理由が要る */
  needsReason: boolean;
}

/** 開局で数えた額と、前回のレジクローズで残した額（翌準備金）の比較。DB（open_register_session）と同じ */
export function openingCheck(counted: number, expected: number | null | undefined): OpeningCheck {
  if (expected == null) return { expected: null, difference: null, needsReason: false };
  const difference = counted - expected;
  return { expected, difference, needsReason: difference !== 0 };
}

/** 'YYYY-MM-DD' の日数差（b − a） */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * 時計の営業日（深夜営業の「営業日の区切り時刻」を引いた日付）。DB の app_business_date の時計部分と同じ
 * @param now いまの時刻
 * @param startHour store_settings.business_day_start_hour（0〜）
 */
export function clockBusinessDate(now: Date, startHour: number): string {
  const shifted = new Date(now.getTime() - Math.max(0, startHour) * 3_600_000);
  return shifted.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export interface OpenDayState {
  /** 売上が入る営業日 */
  businessDate: string;
  /** 前の営業日のまま続けている（開いたままのレジの営業日が今日の時計より前・前日まで） */
  continuing: boolean;
  /** 2日以上前から開きっぱなしのレジがある（売上は今日の日付に入る。早く締める） */
  stale: boolean;
  /** 開いたままのレジの一番古い営業日（無ければ null） */
  oldestOpen: string | null;
}

/**
 * 開いたままのレジの営業日と時計から、いまの営業日を決める（DB の app_business_date と同じ決め方）。
 * 前日までなら前の営業日を続ける。2日以上前のものは続けない（締め忘れで何日分も1日にまとまらないように）
 */
export function openDayState(openSessionDates: string[], clock: string): OpenDayState {
  const sorted = [...openSessionDates].sort();
  const oldestOpen = sorted[0] ?? null;
  const usable = sorted.filter((d) => {
    const n = dayDiff(d, clock);
    return n >= 0 && n <= 1 && registerDayFlowActive(d);
  });
  const businessDate = usable.length > 0 ? usable[usable.length - 1] : clock;
  return {
    businessDate,
    continuing: businessDate < clock,
    stale: sorted.some((d) => dayDiff(d, clock) >= 2),
    oldestOpen,
  };
}

/** レジ端末のログアウト：開いているレジがあればレジ精算が先（REGISTER_DAY_FLOW_FROM から） */
export function canSignOutRegister(input: { isRegisterDevice: boolean; openSessionCount: number; today: string }): boolean {
  if (!registerDayFlowActive(input.today)) return true;
  return !input.isRegisterDevice || input.openSessionCount === 0;
}

/** 'YYYY-MM-DD' → 'M/D' */
export function mdLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

/** 前の営業日を続けているときに警告を出し始める時刻（JST）。深夜の営業中は出さない（2026-09-28 提案どおり朝10時） */
export const CONTINUE_ALERT_HOUR = 10;

/**
 * 画面の上に出す「レジがまだ閉まっていません」の種類。
 *   stale      … 2日以上前から開きっぱなし（売上は今日の日付に入っている）
 *   continuing … 前の営業日を続けていて、朝10時を過ぎた
 */
export function dayBannerKind(
  state: Pick<OpenDayState, 'stale' | 'continuing'> & { clock: string },
  jstHour: number
): 'stale' | 'continuing' | null {
  if (!registerDayFlowActive(state.clock)) return null;
  if (state.stale) return 'stale';
  if (state.continuing && jstHour >= CONTINUE_ALERT_HOUR) return 'continuing';
  return null;
}

/** いまの時（JST・0〜23） */
export function jstHour(now: Date): number {
  return Number(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false })) % 24;
}
