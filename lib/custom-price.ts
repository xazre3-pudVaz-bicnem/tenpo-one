/**
 * 「その他（価格入力）」— 各カテゴリの最後のボタン（2026-10-07 Ronnie
 * 「お客様が何か追加したとき、金額を自分で打てる Other ボタンを全カテゴリの最後に。ハンディと iPad だけ」）。
 *
 * 押すと金額（税込・1つあたり）と内容（任意。例：大盛り・持込料）を打って、カート→注文に入る。
 * 厨房伝票・税率・売上のカテゴリを普通の商品と同じにするため、カテゴリごとに非表示の商品「その他」を1つ持ち
 * （初めて使ったときにサーバーが作る。説明欄の印 CUSTOM_PRICE_MARKER で見分ける）、明細はその商品として入る。
 * 非表示なのでお客様QR・メニュー一覧には出ず、設定の一覧からも外す（消されると次に使ったとき作り直す）。
 * 明細の名前は打った内容（無ければ「その他」）。
 */

/** 補助の商品の名前・明細の既定の名前 */
export const CUSTOM_PRICE_ITEM_NAME = 'その他';
/** 補助の商品の説明欄に入れる印（これで見分ける。名前は店が変えられるので使わない） */
export const CUSTOM_PRICE_MARKER = '[tenpo-one:custom-price] 「その他（価格入力）」ボタン用。消さないでください';
/** 打てる金額の上限（レジの金額入力と同じ） */
export const CUSTOM_PRICE_MAX = 9_999_999;
/** 内容の文字数の上限（伝票・レシートの1行に入る長さ） */
export const CUSTOM_PRICE_MEMO_MAX = 40;
/** カートの行の商品 ID の頭（本物の商品 ID と混ざらない） */
export const CUSTOM_LINE_PREFIX = 'custom:';

/** 補助の「その他」商品か（説明欄の印で見分ける） */
export function isCustomPriceHelper(item: { description?: string | null }): boolean {
  return (item.description ?? '').startsWith('[tenpo-one:custom-price]');
}

/** 内容を整える（前後の空白を取り、長さを詰める） */
export function normalizeCustomMemo(memo: string | null | undefined): string {
  return (memo ?? '').replace(/\s+/g, ' ').trim().slice(0, CUSTOM_PRICE_MEMO_MAX);
}

/** 明細の名前（打った内容。無ければ「その他」） */
export function customItemName(memo: string | null | undefined): string {
  return normalizeCustomMemo(memo) || CUSTOM_PRICE_ITEM_NAME;
}

/** 金額・数量の問題（無ければ null） */
export function customPriceProblem(price: number, quantity: number): string | null {
  if (!Number.isInteger(price) || price < 0 || price > CUSTOM_PRICE_MAX) {
    return `金額は0〜${CUSTOM_PRICE_MAX.toLocaleString('ja-JP')}円の整数で入力してください`;
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return '数量は1〜99で指定してください';
  return null;
}

/** カートの行の商品 ID（入れるたびに別の行にする。同じ金額でも内容が違えばまとめない） */
export function customLineId(categoryId: string | null, seq: number): string {
  return `${CUSTOM_LINE_PREFIX}${categoryId ?? 'none'}:${seq}`;
}

export function isCustomLineId(menuItemId: string): boolean {
  return menuItemId.startsWith(CUSTOM_LINE_PREFIX);
}

/** 補助の商品の種別（ドリンクの持ち場のカテゴリはドリンク。テイクアウトの税率 8%/10% の判定に使う） */
export function customHelperItemType(station: string | null | undefined): 'food' | 'drink' {
  return station === 'drink' ? 'drink' : 'food';
}

/** 「その他」の金額と内容（カート→サーバー） */
export interface CustomPriceInput {
  /** そのカテゴリの最後のボタンから入れた（null＝カテゴリなし。テイクアウトの一覧など） */
  categoryId: string | null;
  /** 1つあたり・税込 */
  price: number;
  quantity: number;
  /** 内容（任意） */
  memo: string | null;
}
