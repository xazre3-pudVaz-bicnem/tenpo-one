/**
 * 会計画面の「値引き」と「ポイント」の選択肢（店舗ごと）。
 *
 * 店舗要望（2026-09-24）:
 *   - 値引きは %値引き・￥値引き のほかに、グルメサイトのクーポン（「幹事様無料」など）も選べるようにする
 *   - ポイントは ホットペッパー・ぐるなび・食べログ などから選べるようにする
 *   - どちらも 設定（iPad からも）で足したり消したりできるようにする
 *
 * 保存先は store_settings.settings.checkout（DB 変更なし）。
 * 設定していない店舗は DEFAULT_*（下）で出す。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

/**
 * 値引きの決め方。
 *   percent … 決まった％（例：10%）
 *   amount  … 決まった金額（例：500円）
 *   manual  … 名前だけ決めておき、金額はレジで入れる（「幹事様無料」など人数で変わるもの）
 */
export type DiscountPresetKind = 'percent' | 'amount' | 'manual';

export const DISCOUNT_KIND_LABELS: Record<DiscountPresetKind, string> = {
  percent: '％で引く',
  amount: '決まった金額を引く',
  manual: '金額はレジで入れる',
};

export interface DiscountPreset {
  /** 保存用の記号（英数字とハイフン） */
  key: string;
  name: string;
  kind: DiscountPresetKind;
  /** percent なら 1〜100、amount なら円。manual は 0 */
  value: number;
}

export interface PointBrand {
  key: string;
  name: string;
}

export interface CheckoutPresets {
  discounts: DiscountPreset[];
  pointBrands: PointBrand[];
}

/** 記号の形（保存・URL で使うので英数字とハイフンだけ） */
export const PRESET_KEY_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const PRESET_NAME_MAX = 20;
/** 1店舗あたりの上限（レジのボタンが多くなりすぎないように） */
export const PRESET_MAX = 20;

/** 設定していない店舗に出すポイント（店舗要望で挙がった3つ） */
export const DEFAULT_POINT_BRANDS: readonly PointBrand[] = [
  { key: 'hotpepper', name: 'ホットペッパー' },
  { key: 'gurunavi', name: 'ぐるなび' },
  { key: 'tabelog', name: '食べログ' },
];

/** 設定していない店舗に出す値引き（金額はレジで入れる） */
export const DEFAULT_DISCOUNT_PRESETS: readonly DiscountPreset[] = [
  { key: 'kanji-free', name: '幹事様無料', kind: 'manual', value: 0 },
];

export function emptyCheckoutPresets(): CheckoutPresets {
  return { discounts: [], pointBrands: [] };
}

/** 画面に出す値引きの選択肢（設定が空なら既定） */
export function discountPresetsOf(presets: CheckoutPresets): DiscountPreset[] {
  return presets.discounts.length > 0 ? presets.discounts : DEFAULT_DISCOUNT_PRESETS.map((d) => ({ ...d }));
}

/** 画面に出すポイントの選択肢（設定が空なら既定） */
export function pointBrandsOf(presets: CheckoutPresets): PointBrand[] {
  return presets.pointBrands.length > 0 ? presets.pointBrands : DEFAULT_POINT_BRANDS.map((b) => ({ ...b }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizePresetName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return [...name].slice(0, PRESET_NAME_MAX).join('');
}

/** ％は 1〜100、金額は 1〜1,000,000。はみ出した分は端に寄せる */
export function normalizePresetValue(kind: DiscountPresetKind, value: unknown): number {
  if (kind === 'manual') return 0;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return kind === 'percent' ? 1 : 1;
  return kind === 'percent' ? Math.min(100, n) : Math.min(1_000_000, n);
}

/** store_settings.settings から読む（壊れた値・知らない値は捨てる） */
export function checkoutPresetsFrom(settings: unknown): CheckoutPresets {
  const out = emptyCheckoutPresets();
  const root = isRecord(settings) ? settings.checkout : null;
  if (!isRecord(root)) return out;

  if (Array.isArray(root.discounts)) {
    const seen = new Set<string>();
    for (const d of root.discounts) {
      if (!isRecord(d)) continue;
      const key = typeof d.key === 'string' ? d.key : '';
      const name = normalizePresetName(d.name);
      const kind = d.kind === 'percent' || d.kind === 'amount' || d.kind === 'manual' ? d.kind : null;
      if (!PRESET_KEY_RE.test(key) || !name || !kind || seen.has(key) || out.discounts.length >= PRESET_MAX) continue;
      seen.add(key);
      out.discounts.push({ key, name, kind, value: normalizePresetValue(kind, d.value) });
    }
  }

  if (Array.isArray(root.pointBrands)) {
    const seen = new Set<string>();
    for (const b of root.pointBrands) {
      if (!isRecord(b)) continue;
      const key = typeof b.key === 'string' ? b.key : '';
      const name = normalizePresetName(b.name);
      if (!PRESET_KEY_RE.test(key) || !name || seen.has(key) || out.pointBrands.length >= PRESET_MAX) continue;
      seen.add(key);
      out.pointBrands.push({ key, name });
    }
  }

  return out;
}

/** store_settings.settings.checkout に書く形（項目を足したらここにも足す） */
export function checkoutPresetsToJson(presets: CheckoutPresets): Record<string, unknown> {
  return { discounts: presets.discounts, pointBrands: presets.pointBrands };
}

/**
 * 値引きの選択肢を押したときに引く金額。
 * percent は合計から計算する（1円未満は切り捨て）。manual は 0（レジで入れる）。
 */
export function discountAmountOf(preset: DiscountPreset, orderTotal: number): number {
  if (preset.kind === 'amount') return Math.min(preset.value, Math.max(0, orderTotal));
  if (preset.kind === 'percent') return Math.min(Math.floor((Math.max(0, orderTotal) * preset.value) / 100), Math.max(0, orderTotal));
  return 0;
}

/** ％値引きの金額（レジで％を入れたとき） */
export function percentDiscountAmount(percent: number, orderTotal: number): number {
  const p = Math.max(0, Math.min(100, Math.floor(percent)));
  return Math.min(Math.floor((Math.max(0, orderTotal) * p) / 100), Math.max(0, orderTotal));
}

/** 追加する選択肢の記号を作る（item1, item2 …） */
export function nextPresetKey(used: readonly { key: string }[], prefix = 'item'): string {
  const keys = new Set(used.map((u) => u.key));
  for (let i = 1; i <= 99; i += 1) {
    const key = `${prefix}${i}`;
    if (!keys.has(key)) return key;
  }
  return `${prefix}${Date.now().toString(36)}`;
}
