/**
 * ダイナミックプライシング（2026-09-23 dinii と同じ機能。全店舗共通）。
 * 曜日・時間帯で商品の値段を自動で変える（ハッピーアワー 17〜19時 ドリンク 20%引き、深夜料金 +10% など）。
 *
 * 設定は store_settings.settings.dynamicPricing.rules（DB の列追加なし）。上から順に見て、最初に当てはまったルールを使う。
 * レジ・ハンディ（addItem）はこのファイル、お客様QR（create_qr_order）は SQL の public.dynamic_menu_price で同じ計算をする
 * （supabase/migrations/00069_dynamic_pricing.sql。ここを変えたら SQL も合わせる）。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

export type DynamicPriceKind = 'percent' | 'amount' | 'fixed';
export type DynamicPriceTarget = 'all' | 'categories' | 'items';

export interface DynamicPriceRule {
  id: string;
  name: string;
  enabled: boolean;
  /** 曜日（0=日〜6=土）。空は毎日 */
  days: number[];
  /** 'HH:MM'（日本時間）。start と end が同じなら終日。end が start より前なら日をまたぐ（22:00〜02:00） */
  start: string;
  end: string;
  /** all＝フード・ドリンク全部（コース・オプションは除く） / categories / items */
  target: DynamicPriceTarget;
  categoryIds: string[];
  itemIds: string[];
  /** percent: ±％（-20 で2割引き） / amount: ±円 / fixed: この金額にする */
  kind: DynamicPriceKind;
  value: number;
  /** 10円単位に四捨五入 */
  roundTo10: boolean;
}

export interface DynamicPricingSettings {
  rules: DynamicPriceRule[];
}

export interface PricedItem {
  id: string;
  categoryId: string | null;
  itemType: string;
  price: number;
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_PRICE = 10_000_000;
export const MAX_DYNAMIC_RULES = 50;

function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function strArr(v: unknown, max = 2000): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : [];
}

/** 1ルールを正しい形にそろえる。壊れていれば null */
export function normalizeDynamicRule(v: unknown): DynamicPriceRule | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id ? o.id.slice(0, 64) : null;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 60) : '';
  const start = typeof o.start === 'string' && HM.test(o.start) ? o.start : null;
  const end = typeof o.end === 'string' && HM.test(o.end) ? o.end : null;
  const kind = o.kind === 'percent' || o.kind === 'amount' || o.kind === 'fixed' ? o.kind : null;
  const target = o.target === 'all' || o.target === 'categories' || o.target === 'items' ? o.target : null;
  const value = typeof o.value === 'number' && Number.isInteger(o.value) ? o.value : null;
  if (!id || !name || !start || !end || !kind || !target || value === null) return null;
  if (kind === 'percent' && (value <= -100 || value > 1000)) return null;
  if (kind === 'amount' && Math.abs(value) > MAX_PRICE) return null;
  if (kind === 'fixed' && (value < 0 || value > MAX_PRICE)) return null;
  const days = Array.isArray(o.days)
    ? Array.from(new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))).sort()
    : [];
  return {
    id,
    name,
    enabled: o.enabled !== false,
    days,
    start,
    end,
    target,
    categoryIds: strArr(o.categoryIds),
    itemIds: strArr(o.itemIds),
    kind,
    value,
    roundTo10: o.roundTo10 === true,
  };
}

/** 保存前のチェック。問題があれば理由（日本語） */
export function dynamicRuleProblem(r: DynamicPriceRule): string | null {
  if (!r.name.trim()) return 'ルール名を入力してください';
  if (!HM.test(r.start) || !HM.test(r.end)) return '時間は HH:MM で入力してください';
  if (r.target === 'categories' && r.categoryIds.length === 0) return `「${r.name}」: カテゴリを1つ以上選んでください`;
  if (r.target === 'items' && r.itemIds.length === 0) return `「${r.name}」: 商品を1つ以上選んでください`;
  if (r.kind === 'percent' && (r.value <= -100 || r.value > 1000)) return `「${r.name}」: ％は -99〜1000 で入力してください`;
  if (r.kind === 'fixed' && r.value < 0) return `「${r.name}」: 金額は0円以上にしてください`;
  return null;
}

/** store_settings.settings から読む（壊れたルールは捨てる） */
export function dynamicPricingFrom(settings: unknown): DynamicPricingSettings {
  const raw =
    settings && typeof settings === 'object' ? (settings as Record<string, unknown>).dynamicPricing : undefined;
  const rules =
    raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).rules)
      ? ((raw as Record<string, unknown>).rules as unknown[])
      : [];
  return {
    rules: rules
      .map(normalizeDynamicRule)
      .filter((r): r is DynamicPriceRule => r !== null)
      .slice(0, MAX_DYNAMIC_RULES),
  };
}

/** 日本時間の曜日（0=日）と分 */
export function jstDayMinute(at: Date): { day: number; minute: number } {
  const d = new Date(at.getTime() + 9 * 60 * 60_000);
  return { day: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** その時刻がルールの曜日・時間帯に入っているか（日またぎは前日の曜日で判定） */
export function ruleActiveAt(r: Pick<DynamicPriceRule, 'days' | 'start' | 'end'>, at: Date): boolean {
  const { day, minute } = jstDayMinute(at);
  const s = hmToMin(r.start);
  const e = hmToMin(r.end);
  let dayOfRule = day;
  if (s === e) {
    // 終日
  } else if (s < e) {
    if (minute < s || minute >= e) return false;
  } else {
    // 日またぎ（22:00〜02:00）: 0:00〜終了前は前日のルール
    if (minute >= e && minute < s) return false;
    if (minute < e) dayOfRule = (day + 6) % 7;
  }
  return r.days.length === 0 || r.days.includes(dayOfRule);
}

export function ruleMatchesItem(r: DynamicPriceRule, item: Omit<PricedItem, 'price'>): boolean {
  if (r.target === 'all') return item.itemType === 'food' || item.itemType === 'drink';
  if (r.target === 'categories') return !!item.categoryId && r.categoryIds.includes(item.categoryId);
  return r.itemIds.includes(item.id);
}

/** 値段をルールで変える（0〜上限円に収める） */
export function adjustPrice(price: number, r: Pick<DynamicPriceRule, 'kind' | 'value' | 'roundTo10'>): number {
  let next: number;
  if (r.kind === 'fixed') next = r.value;
  else if (r.kind === 'amount') next = price + r.value;
  else {
    // 整数で計算して四捨五入（SQL の round と同じ結果にする）
    const n = price * (100 + r.value);
    next = r.roundTo10 ? Math.round(n / 1000) * 10 : Math.round(n / 100);
  }
  if (r.roundTo10 && r.kind !== 'percent') next = Math.round(next / 10) * 10;
  return Math.max(0, Math.min(MAX_PRICE, next));
}

/**
 * その時刻の値段。当てはまるルールが無ければ元の値段。
 * base は店内価格かテイクアウト価格（選択肢の追加料金は含めない）。
 */
export function dynamicUnitPrice(
  rules: readonly DynamicPriceRule[],
  item: Omit<PricedItem, 'price'>,
  base: number,
  at: Date
): { price: number; rule: DynamicPriceRule | null } {
  for (const r of rules) {
    if (!r.enabled) continue;
    if (!ruleMatchesItem(r, item)) continue;
    if (!ruleActiveAt(r, at)) continue;
    return { price: adjustPrice(base, r), rule: r };
  }
  return { price: base, rule: null };
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 一覧に出す短い説明（例: 月〜金 17:00〜19:00・ドリンク 20%引き） */
export function describeRule(r: DynamicPriceRule): string {
  const days = r.days.length === 0 || r.days.length === 7 ? '毎日' : r.days.map((d) => WEEKDAY_LABELS[d]).join('・');
  const time = r.start === r.end ? '終日' : `${r.start}〜${r.end}`;
  const how =
    r.kind === 'fixed'
      ? `${r.value.toLocaleString('ja-JP')}円にする`
      : r.kind === 'amount'
        ? `${r.value >= 0 ? '+' : ''}${r.value.toLocaleString('ja-JP')}円`
        : r.value < 0
          ? `${-r.value}%引き`
          : `+${r.value}%`;
  return `${days} ${time}・${how}${r.roundTo10 ? '（10円単位）' : ''}`;
}
