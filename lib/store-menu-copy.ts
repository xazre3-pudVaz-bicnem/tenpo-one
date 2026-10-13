/**
 * 店舗のメニューを別の店舗にコピーする（運営管理。2026-10-14 Ronnie「FULLMOoN 五反田を追加。メニューとレジの設定は肉ギャング渋谷と同じ」）。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。DB の読み書きは app/admin/organizations/actions.ts の copyStoreMenu。
 *
 * コピーするもの：その店舗だけのカテゴリ・商品（サイズ・トッピング・選択肢を含む）と、
 *   メニューに関わるレジの設定（ページ・プラン・ランチ・時間帯の値段・テイクアウト・コースの段・数量限定・会計のボタン・来店経路・厨房伝票）
 * コピーしないもの：全店共通（store_id なし）のカテゴリ・商品（もう出ている）、テーブル・フロア・プリンター・スタッフ・売上・
 *   レシートの店名・住所、お店の回線・Wi-Fi、通知の登録、予算・月の経費、品切れの状態
 */

/** store_settings.settings のうち、コピーするキー（メニューとレジの操作に関わるもの） */
export const MENU_SETTINGS_KEYS = [
  'menuBook',
  'dynamicPricing',
  'takeoutMenu',
  'courseSteps',
  'menuStock',
  'checkout',
  'visitSources',
  'kitchenTicket',
] as const;

/** store_settings の列のうち、コピーするもの（レジの計算・コースの使い方） */
export const STORE_SETTINGS_COLUMNS_TO_COPY = [
  'rounding',
  'service_charge_rate',
  'course_enabled',
  'seat_only_enabled',
  'default_stay_minutes',
] as const;

/**
 * 値の中の ID（文字列・オブジェクトのキー）を、コピー先の新しい ID に置き換える。
 * 対応表に無い文字列（全店共通のカテゴリなど）はそのまま。
 */
export function remapIds(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, map));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[map.get(k) ?? k] = remapIds(v, map);
    }
    return out;
  }
  return value;
}

/**
 * コピー先の settings を作る：コピー先のほかの設定（テーブル・回線など）はそのまま、
 * メニューのキーだけコピー元から（ID を置き換えて）入れる。
 */
export function copyMenuSettings(
  source: unknown,
  target: unknown,
  map: ReadonlyMap<string, string>
): Record<string, unknown> {
  const src = source && typeof source === 'object' && !Array.isArray(source) ? (source as Record<string, unknown>) : {};
  const out: Record<string, unknown> =
    target && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const key of MENU_SETTINGS_KEYS) {
    if (key in src && src[key] !== undefined) out[key] = remapIds(src[key], map);
  }
  return out;
}

/** 行をコピー先の店舗用に：id・作成日時などを外し、店舗・ID を差し替える */
export function cloneRow<T extends Record<string, unknown>>(
  row: T,
  patch: Record<string, unknown>,
  drop: readonly string[] = ['created_at', 'updated_at']
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const k of drop) delete out[k];
  return { ...out, ...patch };
}
